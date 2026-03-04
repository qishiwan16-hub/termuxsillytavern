import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { lookup as lookupMime } from "mime-types";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { APP_PATHS, ensureAppDirs } from "./lib/env.js";
import { InstanceStore } from "./lib/instance-store.js";
import { VaultService } from "./lib/vault-service.js";
import { QueueService } from "./lib/queue-service.js";
import { buildFileTree } from "./lib/file-tree.js";
import { appendAuditLog } from "./lib/audit.js";
import { readMultipartToBuffer } from "./lib/upload.js";
import { extractZipToRoot, createZipFromPaths } from "./lib/zip-service.js";
import { readTextFile, writeTextFileWithBackup } from "./lib/file-service.js";
import { listBackups, restoreBackup } from "./lib/backup.js";
import { resolveInsideRoot, assertSafeRelativePath } from "./lib/path-safety.js";
import { isInstanceLikelyRunning } from "./lib/runtime.js";
import { GitService } from "./lib/git-service.js";
import { AuthService } from "./lib/auth-service.js";
import { ScanCacheService } from "./lib/scan-cache-service.js";
import { TrashService } from "./lib/trash-service.js";
import { ResourceCenterService } from "./lib/resource-center-service.js";
import { DashboardService } from "./lib/dashboard-service.js";
import { AppSettingsService } from "./lib/app-settings-service.js";
import { createMixedZip } from "./lib/mixed-zip-service.js";
import type { QueueJob, ResourceItem } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });
const instanceStore = new InstanceStore();
const vaultService = new VaultService();
const queueService = new QueueService();
const gitService = new GitService();
const authService = new AuthService();
const scanCacheService = new ScanCacheService();
const appSettingsService = new AppSettingsService();
const trashService = new TrashService();
const resourceCenterService = new ResourceCenterService(scanCacheService, vaultService);
const dashboardService = new DashboardService(scanCacheService);

const SaveFileSchema = z.object({
  relPath: z.string().min(1),
  content: z.string(),
  queueIfRunning: z.boolean().default(true),
  createBackup: z.boolean().default(true)
});

const AddInstanceSchema = z.object({
  name: z.string().min(1),
  rootPath: z.string().min(1)
});

const PatchInstanceSchema = z.object({
  name: z.string().optional(),
  rootPath: z.string().optional(),
  layoutType: z.enum(["modern", "legacy", "custom"]).optional()
});

const ResourceRefSchema = z.object({
  source: z.enum(["instance", "vault"]),
  id: z.string().optional(),
  instanceId: z.string().optional(),
  relPath: z.string().optional()
});

const BatchApplySchema = z.object({
  instanceId: z.string().min(1),
  targetRelDir: z.string().min(1),
  mode: z.literal("copy_once").default("copy_once"),
  items: z.array(ResourceRefSchema).min(1)
});

const BatchExportSchema = z.object({
  items: z.array(ResourceRefSchema).min(1)
});

const BatchDeleteSchema = z.object({
  items: z.array(ResourceRefSchema).min(1)
});

function splitTagInput(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((item) => String(item).split(",")).map((it) => it.trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((it) => it.trim())
      .filter(Boolean);
  }
  return [];
}

function readBearerToken(authorization?: string): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

async function detectExtensionRelDir(rootPath: string): Promise<string> {
  const candidates = [
    "data/default-user/extensions",
    "public/scripts/extensions/third-party",
    "extensions"
  ];
  for (const candidate of candidates) {
    const abs = path.join(rootPath, candidate);
    if (await fs.pathExists(abs)) {
      return candidate.replace(/\\/g, "/");
    }
  }
  return candidates[0];
}

function isProbablyJson(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".json");
}

function inferPreviewKindByPath(relPath: string, isDir: boolean): "text" | "json" | "image" | "none" {
  if (isDir) return "none";
  const lower = relPath.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lower)) return "image";
  if (lower.endsWith(".json")) return "json";
  if (/\.(txt|md|yaml|yml|ini|log|css|js|ts|html|xml|csv)$/.test(lower)) return "text";
  return "none";
}

function parseResourceItemReference(input: z.infer<typeof ResourceRefSchema>): {
  source: "instance" | "vault";
  id: string;
  instanceId?: string;
  relPath?: string;
} {
  if (input.source === "vault") {
    const id = input.id?.trim();
    if (!id) {
      throw new Error("Vault 资源缺少 id");
    }
    return { source: "vault", id };
  }
  const instanceId = input.instanceId?.trim();
  const relPath = input.relPath?.trim();
  if (!instanceId || !relPath) {
    throw new Error("实例资源缺少 instanceId 或 relPath");
  }
  return {
    source: "instance",
    id: `${instanceId}:${relPath}`,
    instanceId,
    relPath
  };
}

async function collectResourceForExport(ref: {
  source: "instance" | "vault";
  id: string;
  instanceId?: string;
  relPath?: string;
}): Promise<{ absPath: string; zipRelPath: string }> {
  if (ref.source === "vault") {
    const item = vaultService.get(ref.id);
    const absPath = await vaultService.resolveItemAbsolutePath(item.id);
    return {
      absPath,
      zipRelPath: `vault/${item.relPath}`.replace(/\\/g, "/")
    };
  }
  const instance = instanceStore.get(ref.instanceId ?? "");
  const safeRelPath = assertSafeRelativePath(ref.relPath ?? "");
  const absPath = await resolveInsideRoot(instance.rootPath, safeRelPath, false);
  return {
    absPath,
    zipRelPath: `instance/${instance.id}/${safeRelPath}`.replace(/\\/g, "/")
  };
}

async function loadResourceContent(item: ResourceItem): Promise<{
  readOnly: boolean;
  truncated: boolean;
  content: string;
}> {
  if (item.source === "instance") {
    const instance = instanceStore.get(item.instanceId ?? "");
    const file = await readTextFile(instance.rootPath, item.relPath);
    return {
      readOnly: file.readOnly,
      truncated: file.truncated,
      content: file.content
    };
  }
  const vaultItemId = item.id.replace(/^vault:/, "");
  const absPath = await vaultService.resolveItemAbsolutePath(vaultItemId);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) {
    throw new Error("目录不支持文本读取");
  }
  if (stat.size > 5 * 1024 * 1024) {
    return {
      readOnly: true,
      truncated: true,
      content: ""
    };
  }
  const content = await fs.readFile(absPath, "utf8").catch(() => "");
  return {
    readOnly: false,
    truncated: false,
    content
  };
}

async function executeWriteJob(job: QueueJob): Promise<void> {
  const instanceId = String(job.payload.instanceId ?? "");
  const relPath = String(job.payload.relPath ?? "");
  const content = String(job.payload.content ?? "");
  const createBackup = Boolean(job.payload.createBackup ?? true);
  const instance = instanceStore.get(instanceId);
  await writeTextFileWithBackup({
    instanceId,
    rootPath: instance.rootPath,
    relPath,
    content,
    createBackupBeforeWrite: createBackup
  });
  await scanCacheService.invalidateInstance(instanceId);
  await appendAuditLog("queue.write.done", { instanceId, relPath, jobId: job.id });
}

async function queueShouldBlock(job: QueueJob): Promise<QueueJob["reason"] | null> {
  if (job.type !== "write") {
    return null;
  }
  const instanceId = String(job.payload.instanceId ?? "");
  const instance = instanceStore.get(instanceId);
  const running = await isInstanceLikelyRunning(instance.rootPath);
  return running ? "st-running" : null;
}

async function processQueue(): Promise<void> {
  await queueService.process(queueShouldBlock, async (job) => {
    if (job.type === "write") {
      await executeWriteJob(job);
      return;
    }
    throw new Error(`Unsupported queue job type: ${job.type}`);
  });
}

async function setup(): Promise<void> {
  await ensureAppDirs();
  await instanceStore.init();
  await vaultService.init();
  await queueService.init();
  await authService.init();
  await scanCacheService.init();
  await appSettingsService.init();
  await trashService.init(appSettingsService.get().trashRetentionDays);
  await instanceStore.refreshRunningState();
  await trashService.cleanupExpired();

  await app.register(multipart, {
    limits: {
      fileSize: 400 * 1024 * 1024
    }
  });

  const publicApiPaths = new Set([
    "/api/health",
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/auth/logout"
  ]);

  app.addHook("onRequest", async (req, reply) => {
    const pathname = req.url.split("?")[0] ?? "";
    if (!pathname.startsWith("/api/")) {
      return;
    }
    if (publicApiPaths.has(pathname)) {
      return;
    }
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
    const tokenHeader =
      typeof req.headers["x-st-token"] === "string" ? req.headers["x-st-token"] : undefined;
    const token = readBearerToken(authHeader) ?? tokenHeader;
    if (!authService.isRequestAuthorized(token)) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "未授权访问，请先登录"
      });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    time: new Date().toISOString(),
    dataRoot: APP_PATHS.dataRoot
  }));

  app.get("/api/auth/status", async () => {
    const status = authService.status();
    return {
      ...status
    };
  });

  app.post("/api/auth/setup", async (req, reply) => {
    const status = authService.status();
    if (status.passwordConfigured) {
      return reply.code(400).send({ error: "已配置访问密码，请使用登录接口" });
    }
    const body = z.object({ password: z.string().min(6) }).parse(req.body);
    await authService.setupPassword(body.password);
    const token = await authService.login(body.password);
    await appendAuditLog("auth.setup", {});
    return reply.code(201).send({
      enabled: true,
      token
    });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const status = authService.status();
    if (!status.enabled) {
      return reply.send({ enabled: false, token: null });
    }
    const body = z.object({ password: z.string().min(1) }).parse(req.body);
    try {
      const token = await authService.login(body.password);
      await appendAuditLog("auth.login", {});
      return reply.send({ enabled: true, token });
    } catch (error) {
      return reply.code(401).send({
        error: error instanceof Error ? error.message : "登录失败"
      });
    }
  });

  app.post("/api/auth/logout", async (req) => {
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
    const tokenHeader =
      typeof req.headers["x-st-token"] === "string" ? req.headers["x-st-token"] : undefined;
    const token = readBearerToken(authHeader) ?? tokenHeader;
    authService.logout(token);
    await appendAuditLog("auth.logout", {});
    return { ok: true };
  });

  app.post("/api/auth/change-password", async (req) => {
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6)
      })
      .parse(req.body);
    await authService.changePassword(body.currentPassword, body.newPassword);
    await appendAuditLog("auth.change-password", {});
    return { ok: true };
  });

  app.post("/api/auth/set-enabled", async (req, reply) => {
    const body = z
      .object({
        enabled: z.boolean(),
        password: z.string().optional()
      })
      .parse(req.body);

    if (body.enabled) {
      const status = authService.status();
      if (!status.passwordConfigured) {
        return reply.code(400).send({ error: "尚未设置密码，无法启用认证" });
      }

      const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
      const tokenHeader =
        typeof req.headers["x-st-token"] === "string" ? req.headers["x-st-token"] : undefined;
      const currentToken = readBearerToken(authHeader) ?? tokenHeader;

      let token = currentToken;
      if (!authService.isRequestAuthorized(currentToken)) {
        if (!body.password) {
          return reply.code(400).send({ error: "启用认证需要输入密码" });
        }
        try {
          token = await authService.login(body.password);
        } catch {
          return reply.code(401).send({ error: "密码错误，无法启用认证" });
        }
      }

      await authService.setEnabled(true);
      await appendAuditLog("auth.set-enabled", { enabled: true });
      return {
        ...authService.status(),
        token: token ?? null
      };
    }

    await authService.setEnabled(false);
    await appendAuditLog("auth.set-enabled", { enabled: false });
    return {
      ...authService.status(),
      token: null
    };
  });

  app.get("/api/app-settings", async () => {
    return appSettingsService.get();
  });

  app.patch("/api/app-settings", async (req) => {
    const body = z
      .object({
        trashRetentionDays: z.number().int().min(1).max(365).optional(),
        legacyUiEnabled: z.boolean().optional(),
        autoOpenBrowser: z.boolean().optional(),
        autoUpdateRepo: z.boolean().optional()
      })
      .parse(req.body ?? {});
    const settings = await appSettingsService.patch(body);
    await trashService.setRetentionDays(settings.trashRetentionDays);
    await appendAuditLog("settings.patch", body);
    return settings;
  });

  app.get("/api/dashboard/summary", async (req) => {
    const query = z
      .object({
        instanceId: z.string().optional()
      })
      .parse(req.query ?? {});
    await instanceStore.refreshRunningState();
    const instances = instanceStore.list();
    const queueJobs = queueService.list();
    const vaultCount = vaultService.list().length;
    const summary = await dashboardService.buildSummary({
      selectedInstanceId: query.instanceId,
      instances,
      queueJobs,
      vaultCount
    });
    return summary;
  });

  app.get("/api/resources", async (req) => {
    const query = z
      .object({
        source: z.enum(["all", "instance", "vault"]).default("all"),
        instanceId: z.string().optional(),
        q: z.string().optional(),
        type: z.string().optional(),
        tags: z.string().optional(),
        favorite: z.string().optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        refreshMode: z.enum(["none", "incremental", "full"]).default("incremental"),
        includeDirs: z.string().optional()
      })
      .parse(req.query ?? {});
    const includeDirs =
      query.includeDirs === undefined ? false : query.includeDirs === "true" || query.includeDirs === "1";
    const favorite =
      query.favorite === undefined ? undefined : query.favorite === "true" || query.favorite === "1";
    const result = await resourceCenterService.list(
      {
        source: query.source,
        instanceId: query.instanceId,
        q: query.q,
        type: query.type,
        tags: splitTagInput(query.tags),
        favorite,
        offset: query.offset,
        limit: query.limit,
        includeDirs,
        refreshMode: query.refreshMode
      },
      instanceStore.list()
    );
    return result;
  });

  app.get("/api/resources/content", async (req, reply) => {
    const query = z
      .object({
        source: z.enum(["instance", "vault"]),
        instanceId: z.string().optional(),
        relPath: z.string().optional(),
        itemId: z.string().optional()
      })
      .parse(req.query ?? {});

    if (query.source === "instance") {
      if (!query.instanceId || !query.relPath) {
        return reply.code(400).send({ error: "缺少 instanceId 或 relPath" });
      }
      const instance = instanceStore.get(query.instanceId);
      const absPath = await resolveInsideRoot(instance.rootPath, query.relPath, false);
      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        return reply.code(400).send({ error: "目录不支持内容预览" });
      }
      const mime = lookupMime(query.relPath) || "application/octet-stream";
      reply.header("Content-Type", mime);
      return reply.send(await fs.readFile(absPath));
    }

    if (!query.itemId) {
      return reply.code(400).send({ error: "缺少 itemId" });
    }
    const vaultItem = vaultService.get(query.itemId);
    const absPath = await vaultService.resolveItemAbsolutePath(query.itemId);
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) {
      return reply.code(400).send({ error: "目录不支持内容预览" });
    }
    const mime = lookupMime(vaultItem.relPath) || "application/octet-stream";
    reply.header("Content-Type", mime);
    return reply.send(await fs.readFile(absPath));
  });

  app.post("/api/resources/batch/apply", async (req) => {
    const body = BatchApplySchema.parse(req.body);
    const refs = body.items.map(parseResourceItemReference);
    const targetInstance = instanceStore.get(body.instanceId);
    const resultItems: Array<{
      source: "instance" | "vault";
      id: string;
      ok: boolean;
      targetRelPath?: string;
      error?: string;
    }> = [];

    for (const ref of refs) {
      try {
        if (ref.source === "vault") {
          const applied = await vaultService.applyToInstance(ref.id, targetInstance.rootPath, body.targetRelDir);
          resultItems.push({
            source: ref.source,
            id: ref.id,
            ok: true,
            targetRelPath: applied.targetRelPath
          });
          continue;
        }

        const sourceInstance = instanceStore.get(ref.instanceId ?? "");
        const safeRelPath = assertSafeRelativePath(ref.relPath ?? "");
        const sourceAbs = await resolveInsideRoot(sourceInstance.rootPath, safeRelPath, false);
        const targetDirAbs = await resolveInsideRoot(targetInstance.rootPath, body.targetRelDir, true);
        await fs.ensureDir(targetDirAbs);
        const baseName = path.basename(safeRelPath);
        let targetAbs = path.join(targetDirAbs, baseName);
        if (await fs.pathExists(targetAbs)) {
          targetAbs = path.join(targetDirAbs, `${Date.now()}-${baseName}`);
        }
        await fs.copy(sourceAbs, targetAbs, { overwrite: false, errorOnExist: false });
        resultItems.push({
          source: ref.source,
          id: ref.id,
          ok: true,
          targetRelPath: path.relative(targetInstance.rootPath, targetAbs).replace(/\\/g, "/")
        });
      } catch (error) {
        resultItems.push({
          source: ref.source,
          id: ref.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await scanCacheService.invalidateInstance(body.instanceId);
    await appendAuditLog("resources.batch.apply", {
      instanceId: body.instanceId,
      targetRelDir: body.targetRelDir,
      count: refs.length
    });
    return {
      total: resultItems.length,
      success: resultItems.filter((item) => item.ok).length,
      failed: resultItems.filter((item) => !item.ok).length,
      items: resultItems
    };
  });

  app.post("/api/resources/batch/export/zip", async (req, reply) => {
    const body = BatchExportSchema.parse(req.body);
    const refs = body.items.map(parseResourceItemReference);
    const entries = await Promise.all(refs.map((ref) => collectResourceForExport(ref)));
    const zipBuffer = await createMixedZip(entries);
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="resources-${Date.now()}.zip"`);
    return reply.send(zipBuffer);
  });

  app.post("/api/resources/batch/delete", async (req) => {
    const body = BatchDeleteSchema.parse(req.body);
    const refs = body.items.map(parseResourceItemReference);
    const affectedInstances = new Set<string>();
    const resultItems: Array<{
      source: "instance" | "vault";
      id: string;
      ok: boolean;
      trashId?: string;
      error?: string;
    }> = [];

    for (const ref of refs) {
      try {
        if (ref.source === "instance") {
          const instance = instanceStore.get(ref.instanceId ?? "");
          const trashItem = await trashService.trashInstancePath(
            instance.id,
            instance.rootPath,
            ref.relPath ?? ""
          );
          affectedInstances.add(instance.id);
          resultItems.push({
            source: ref.source,
            id: ref.id,
            ok: true,
            trashId: trashItem.id
          });
          continue;
        }

        const detached = await vaultService.detachItem(ref.id);
        const trashItem = await trashService.trashVaultItem(detached.item, detached.absPath);
        resultItems.push({
          source: ref.source,
          id: ref.id,
          ok: true,
          trashId: trashItem.id
        });
      } catch (error) {
        resultItems.push({
          source: ref.source,
          id: ref.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    for (const instanceId of affectedInstances) {
      await scanCacheService.invalidateInstance(instanceId);
    }
    await appendAuditLog("resources.batch.delete", {
      count: refs.length,
      success: resultItems.filter((item) => item.ok).length
    });
    return {
      total: resultItems.length,
      success: resultItems.filter((item) => item.ok).length,
      failed: resultItems.filter((item) => !item.ok).length,
      items: resultItems
    };
  });

  app.get("/api/trash/items", async (req) => {
    const query = z
      .object({
        source: z.enum(["instance", "vault"]).optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(50)
      })
      .parse(req.query ?? {});
    const result = trashService.list({
      source: query.source,
      offset: query.offset,
      limit: query.limit
    });
    return {
      ...result,
      retentionDays: trashService.getRetentionDays()
    };
  });

  app.post("/api/trash/restore", async (req) => {
    const body = z
      .object({
        itemIds: z.array(z.string().min(1)).min(1)
      })
      .parse(req.body);
    const restored: Array<{
      itemId: string;
      ok: boolean;
      restoredRelPath?: string;
      source?: "instance" | "vault";
      error?: string;
    }> = [];
    const affectedInstances = new Set<string>();

    for (const itemId of body.itemIds) {
      try {
        const result = await trashService.restoreItem({
          itemId,
          resolveInstanceRoot: async (instanceId) => instanceStore.get(instanceId).rootPath,
          resolveVaultTargetPath: async (relPath) =>
            vaultService.resolveAbsoluteByRelPath(relPath, true),
          restoreVaultMeta: async (snapshot, restoredRelPath) =>
            vaultService.restoreDetachedItem(snapshot, restoredRelPath)
        });
        if (result.item.source === "instance" && result.item.instanceId) {
          affectedInstances.add(result.item.instanceId);
        }
        restored.push({
          itemId,
          ok: true,
          restoredRelPath: result.restoredRelPath,
          source: result.item.source
        });
      } catch (error) {
        restored.push({
          itemId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    for (const instanceId of affectedInstances) {
      await scanCacheService.invalidateInstance(instanceId);
    }
    await appendAuditLog("trash.restore", {
      count: body.itemIds.length,
      success: restored.filter((item) => item.ok).length
    });
    return {
      total: restored.length,
      success: restored.filter((item) => item.ok).length,
      failed: restored.filter((item) => !item.ok).length,
      items: restored
    };
  });

  app.delete("/api/trash/items/:id", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    await trashService.deletePermanent(params.id);
    await appendAuditLog("trash.delete", { itemId: params.id });
    return { ok: true };
  });

  app.post("/api/trash/cleanup", async () => {
    const result = await trashService.cleanupExpired();
    await appendAuditLog("trash.cleanup", result);
    return result;
  });

  app.get("/api/instances", async () => {
    await instanceStore.refreshRunningState();
    return { items: instanceStore.list() };
  });

  app.post("/api/instances", async (req, reply) => {
    const input = AddInstanceSchema.parse(req.body);
    const instance = await instanceStore.add(input.name, input.rootPath);
    await appendAuditLog("instance.add", { instanceId: instance.id, rootPath: instance.rootPath });
    return reply.code(201).send(instance);
  });

  app.patch("/api/instances/:id", async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const patch = PatchInstanceSchema.parse(req.body);
    const instance = await instanceStore.update(params.id, patch);
    await appendAuditLog("instance.patch", { instanceId: instance.id, patch });
    return reply.send(instance);
  });

  app.post("/api/instances/:id/scan", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
        q: z.string().optional(),
        type: z.string().optional(),
        includeDirs: z.string().optional(),
        refreshMode: z.enum(["none", "incremental", "full"]).default("incremental")
      })
      .parse(req.query ?? {});
    const includeDirs =
      query.includeDirs === undefined ? true : query.includeDirs === "true" || query.includeDirs === "1";
    const instance = instanceStore.get(params.id);
    const cached = await scanCacheService.getOrRefresh(
      params.id,
      instance.rootPath,
      query.refreshMode
    );
    const view = scanCacheService.query(cached.items, {
      offset: query.offset,
      limit: query.limit,
      q: query.q,
      type: query.type,
      includeDirs
    });

    return {
      instanceId: instance.id,
      offset: query.offset,
      limit: query.limit,
      q: query.q ?? "",
      type: query.type ?? "",
      refreshMode: query.refreshMode,
      includeDirs,
      total: view.total,
      scanned: cached.items.length,
      truncated: false,
      summary: view.summary,
      items: view.items,
      cache: cached.cache
    };
  });

  app.get("/api/instances/:id/tree", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ path: z.string().optional() }).parse(req.query);
    const instance = instanceStore.get(params.id);
    const relPath = query.path ? assertSafeRelativePath(query.path) : "";
    const baseAbs = relPath
      ? await resolveInsideRoot(instance.rootPath, relPath, false)
      : instance.rootPath;
    const nodes = await buildFileTree(baseAbs, "", { maxDepth: 5, maxNodes: 5000 });
    return {
      instanceId: instance.id,
      rootPath: relPath,
      nodes
    };
  });

  app.get("/api/instances/:id/file", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ path: z.string().min(1) }).parse(req.query);
    const instance = instanceStore.get(params.id);
    const file = await readTextFile(instance.rootPath, query.path);
    return {
      source: "instance",
      instanceId: instance.id,
      ...file
    };
  });

  app.put("/api/instances/:id/file", async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const payload = SaveFileSchema.parse(req.body);
    const instance = instanceStore.get(params.id);

    if (isProbablyJson(payload.relPath)) {
      try {
        JSON.parse(payload.content);
      } catch (error) {
        return reply.code(400).send({
          error: "JSON 格式错误",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const running = await isInstanceLikelyRunning(instance.rootPath);
    if (payload.queueIfRunning && running) {
      const queued = await queueService.enqueue({
        type: "write",
        status: "blocked",
        reason: "st-running",
        payload: {
          instanceId: params.id,
          relPath: payload.relPath,
          content: payload.content,
          createBackup: payload.createBackup
        }
      });
      await appendAuditLog("file.write.queued", {
        instanceId: params.id,
        relPath: payload.relPath,
        jobId: queued.id
      });
      return reply.code(202).send({ queued: true, job: queued });
    }

    const result = await writeTextFileWithBackup({
      instanceId: params.id,
      rootPath: instance.rootPath,
      relPath: payload.relPath,
      content: payload.content,
      createBackupBeforeWrite: payload.createBackup
    });
    await scanCacheService.invalidateInstance(params.id);
    await appendAuditLog("file.write", {
      instanceId: params.id,
      relPath: payload.relPath,
      backup: result.backupPath
    });
    return {
      queued: false,
      backupPath: result.backupPath
    };
  });

  app.post("/api/instances/:id/import/zip", async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z.object({ targetRelDir: z.string().optional() }).parse(req.query);
    const instance = instanceStore.get(params.id);
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: "缺少上传文件" });
    }
    const uploaded = await readMultipartToBuffer(file);
    const count = await extractZipToRoot(
      instance.rootPath,
      uploaded.buffer,
      query.targetRelDir ?? ""
    );
    await scanCacheService.invalidateInstance(params.id);
    await appendAuditLog("instance.import.zip", {
      instanceId: params.id,
      filename: uploaded.filename,
      count
    });
    return {
      imported: count
    };
  });

  app.post("/api/instances/:id/export/zip", async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        paths: z.array(z.string()).optional()
      })
      .parse(req.body ?? {});
    const instance = instanceStore.get(params.id);
    const zipBuffer = await createZipFromPaths(instance.rootPath, body.paths ?? []);
    reply.header("Content-Type", "application/zip");
    reply.header(
      "Content-Disposition",
      `attachment; filename="instance-${params.id}-${Date.now()}.zip"`
    );
    return reply.send(zipBuffer);
  });

  app.post("/api/instances/:id/plugins/install", async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const instance = instanceStore.get(params.id);
    const extensionRelDir = await detectExtensionRelDir(instance.rootPath);

    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) {
        return reply.code(400).send({ error: "缺少 ZIP 文件" });
      }
      const uploaded = await readMultipartToBuffer(file);
      const pluginName = path.basename(uploaded.filename, path.extname(uploaded.filename));
      const targetDir = `${extensionRelDir}/${pluginName}`;
      const count = await extractZipToRoot(instance.rootPath, uploaded.buffer, targetDir);
      await scanCacheService.invalidateInstance(params.id);
      await appendAuditLog("plugin.install.zip", {
        instanceId: params.id,
        pluginName,
        count
      });
      return {
        mode: "zip",
        pluginName,
        targetDir,
        imported: count
      };
    }

    const body = z
      .object({
        repoUrl: z.string().url(),
        pluginName: z.string().optional()
      })
      .parse(req.body);
    const pluginName =
      body.pluginName ??
      path.basename(body.repoUrl).replace(/\.git$/i, "") ??
      `plugin-${Date.now()}`;
    const targetAbs = await resolveInsideRoot(
      instance.rootPath,
      `${extensionRelDir}/${pluginName}`,
      true
    );
    await fs.ensureDir(path.dirname(targetAbs));
    await simpleGit().clone(body.repoUrl, targetAbs);
    await scanCacheService.invalidateInstance(params.id);
    await appendAuditLog("plugin.install.git", {
      instanceId: params.id,
      repoUrl: body.repoUrl,
      targetAbs
    });
    return {
      mode: "git",
      pluginName,
      targetRelDir: `${extensionRelDir}/${pluginName}`
    };
  });

  app.post("/api/instances/:id/git/clone", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ repoUrl: z.string().url(), branch: z.string().optional() }).parse(req.body);
    await gitService.clone(params.id, body.repoUrl, body.branch);
    await appendAuditLog("git.clone", { instanceId: params.id, repoUrl: body.repoUrl });
    return { ok: true };
  });

  app.post("/api/instances/:id/git/commit", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ message: z.string().default("update") }).parse(req.body ?? {});
    const instance = instanceStore.get(params.id);
    const commit = await gitService.commit(params.id, instance.rootPath, body.message);
    await appendAuditLog("git.commit", { instanceId: params.id, commit, message: body.message });
    return { commit };
  });

  app.post("/api/instances/:id/git/pull", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const instance = instanceStore.get(params.id);
    const summary = await gitService.pull(params.id, instance.rootPath);
    await scanCacheService.invalidateInstance(params.id);
    await appendAuditLog("git.pull", { instanceId: params.id, summary });
    return { summary };
  });

  app.post("/api/instances/:id/git/push", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ message: z.string().optional() }).parse(req.body ?? {});
    const instance = instanceStore.get(params.id);
    await gitService.push(params.id, instance.rootPath, body.message);
    await appendAuditLog("git.push", { instanceId: params.id, message: body.message });
    return { ok: true };
  });

  app.get("/api/queue", async () => ({
    items: queueService.list()
  }));

  app.post("/api/queue/:id/cancel", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const job = await queueService.cancel(params.id);
    await appendAuditLog("queue.cancel", { jobId: params.id });
    return job;
  });

  app.get("/api/backups", async (req) => {
    const query = z
      .object({
        instanceId: z.string().min(1),
        relPath: z.string().min(1)
      })
      .parse(req.query);
    const files = await listBackups(query.instanceId, query.relPath);
    return {
      items: files
    };
  });

  app.post("/api/backups/restore", async (req) => {
    const body = z
      .object({
        instanceId: z.string().min(1),
        relPath: z.string().min(1),
        backupFile: z.string().min(1)
      })
      .parse(req.body);
    const instance = instanceStore.get(body.instanceId);
    const targetAbs = await resolveInsideRoot(instance.rootPath, body.relPath, true);
    await restoreBackup(body.instanceId, body.relPath, body.backupFile, targetAbs);
    await scanCacheService.invalidateInstance(body.instanceId);
    await appendAuditLog("backup.restore", {
      instanceId: body.instanceId,
      relPath: body.relPath,
      backupFile: body.backupFile
    });
    return { ok: true };
  });

  app.get("/api/vault/items", async (req) => {
    const query = z
      .object({
        q: z.string().optional(),
        tags: z.string().optional(),
        favorite: z.string().optional()
      })
      .parse(req.query);
    const items = vaultService.list({
      q: query.q,
      tags: query.tags ? splitTagInput(query.tags) : [],
      favorite:
        query.favorite === undefined ? undefined : query.favorite === "true" || query.favorite === "1"
    });
    return { items };
  });

  app.post("/api/vault/import/path", async (req, reply) => {
    const body = z
      .object({
        sourcePath: z.string().min(1),
        tags: z.array(z.string()).optional()
      })
      .parse(req.body);
    const item = await vaultService.importFromPath(body.sourcePath, body.tags ?? []);
    await appendAuditLog("vault.import.path", { sourcePath: body.sourcePath, itemId: item.id });
    return reply.code(201).send(item);
  });

  app.post("/api/vault/import/zip", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: "缺少 ZIP 文件" });
    }
    const uploaded = await readMultipartToBuffer(file);
    const tags =
      file.fields.tags && "value" in file.fields.tags ? splitTagInput(file.fields.tags.value) : [];
    const items = await vaultService.importZipBuffer(uploaded.buffer, tags);
    await appendAuditLog("vault.import.zip", {
      filename: uploaded.filename,
      count: items.length
    });
    return reply.code(201).send({ items });
  });

  app.post("/api/vault/export/zip", async (req, reply) => {
    const body = z
      .object({
        itemIds: z.array(z.string()).optional()
      })
      .parse(req.body ?? {});
    const relPaths =
      body.itemIds && body.itemIds.length > 0
        ? body.itemIds.map((id) => vaultService.get(id).relPath)
        : [];
    const zipBuffer = await createZipFromPaths(APP_PATHS.vaultFilesDir, relPaths);
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="vault-${Date.now()}.zip"`);
    return reply.send(zipBuffer);
  });

  app.patch("/api/vault/items/:id/meta", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        favorite: z.boolean().optional()
      })
      .parse(req.body);
    const item = await vaultService.updateMeta(params.id, body);
    await appendAuditLog("vault.meta.patch", { itemId: params.id, body });
    return item;
  });

  app.delete("/api/vault/items/:id", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    await vaultService.remove(params.id);
    await appendAuditLog("vault.delete", { itemId: params.id });
    return { ok: true };
  });

  app.post("/api/vault/items/:id/apply", async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        instanceId: z.string().min(1),
        targetRelDir: z.string().min(1),
        mode: z.literal("copy_once").default("copy_once")
      })
      .parse(req.body);
    const instance = instanceStore.get(body.instanceId);
    const result = await vaultService.applyToInstance(params.id, instance.rootPath, body.targetRelDir);
    await scanCacheService.invalidateInstance(body.instanceId);
    await appendAuditLog("vault.apply", {
      itemId: params.id,
      instanceId: body.instanceId,
      targetRelPath: result.targetRelPath
    });
    return result;
  });

  app.post("/api/vault/git/clone", async (req) => {
    const body = z.object({ repoUrl: z.string().url(), branch: z.string().optional() }).parse(req.body);
    await gitService.clone("vault", body.repoUrl, body.branch);
    await appendAuditLog("vault.git.clone", { repoUrl: body.repoUrl });
    return { ok: true };
  });

  app.post("/api/vault/git/commit", async (req) => {
    const body = z.object({ message: z.string().default("vault update") }).parse(req.body ?? {});
    const commit = await gitService.commit("vault", APP_PATHS.vaultFilesDir, body.message);
    await appendAuditLog("vault.git.commit", { commit, message: body.message });
    return { commit };
  });

  app.post("/api/vault/git/pull", async () => {
    const summary = await gitService.pull("vault", APP_PATHS.vaultFilesDir);
    await appendAuditLog("vault.git.pull", { summary });
    return { summary };
  });

  app.post("/api/vault/git/push", async (req) => {
    const body = z.object({ message: z.string().optional() }).parse(req.body ?? {});
    await gitService.push("vault", APP_PATHS.vaultFilesDir, body.message);
    await appendAuditLog("vault.git.push", { message: body.message });
    return { ok: true };
  });

  app.get("/api/vault/items/:id/content", async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const absPath = await vaultService.resolveItemAbsolutePath(params.id);
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) {
      return reply.code(400).send({ error: "目录不支持直接预览" });
    }
    if (stat.size > 5 * 1024 * 1024) {
      return { readOnly: true, truncated: true, content: "" };
    }
    const content = await fs.readFile(absPath, "utf8").catch(() => "");
    return {
      readOnly: false,
      truncated: false,
      content
    };
  });

  app.get("/api/file", async (req, reply) => {
    const query = z
      .object({
        source: z.enum(["instance", "vault"]),
        instanceId: z.string().optional(),
        path: z.string().optional(),
        itemId: z.string().optional()
      })
      .parse(req.query);

    if (query.source === "instance") {
      if (!query.instanceId || !query.path) {
        return reply.code(400).send({ error: "缺少 instanceId 或 path" });
      }
      const instance = instanceStore.get(query.instanceId);
      const data = await readTextFile(instance.rootPath, query.path);
      return {
        source: "instance",
        ...data
      };
    }

    if (!query.itemId) {
      return reply.code(400).send({ error: "缺少 itemId" });
    }
    const absPath = await vaultService.resolveItemAbsolutePath(query.itemId);
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) {
      return reply.code(400).send({ error: "目录不支持文本读取" });
    }
    const content = await fs.readFile(absPath, "utf8").catch(() => "");
    return {
      source: "vault",
      relPath: query.itemId,
      size: stat.size,
      readOnly: stat.size > 5 * 1024 * 1024,
      truncated: false,
      content
    };
  });

  const clientDist = path.resolve(__dirname, "../client");
  if (await fs.pathExists(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/"
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "API Not Found" });
      }
      return reply.sendFile("index.html");
    });
  }
}

async function main(): Promise<void> {
  await setup();

  const queueInterval = setInterval(() => {
    void processQueue();
  }, 8000);

  const trashCleanupInterval = setInterval(() => {
    void trashService.cleanupExpired();
  }, 6 * 60 * 60 * 1000);

  app.addHook("onClose", async () => {
    clearInterval(queueInterval);
    clearInterval(trashCleanupInterval);
  });

  const port = Number(process.env.PORT ?? 3888);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({
    host,
    port
  });
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});

