import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { APP_PATHS, ensureAppDirs } from "./lib/env.js";
import { InstanceStore } from "./lib/instance-store.js";
import { VaultService } from "./lib/vault-service.js";
import { QueueService } from "./lib/queue-service.js";
import { buildFileTree, scanResources } from "./lib/file-tree.js";
import { appendAuditLog } from "./lib/audit.js";
import { readMultipartToBuffer } from "./lib/upload.js";
import { extractZipToRoot, createZipFromPaths } from "./lib/zip-service.js";
import { readTextFile, writeTextFileWithBackup } from "./lib/file-service.js";
import { listBackups, restoreBackup } from "./lib/backup.js";
import { resolveInsideRoot, assertSafeRelativePath } from "./lib/path-safety.js";
import { isInstanceLikelyRunning } from "./lib/runtime.js";
import { GitService } from "./lib/git-service.js";
import type { QueueJob } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });
const instanceStore = new InstanceStore();
const vaultService = new VaultService();
const queueService = new QueueService();
const gitService = new GitService();

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
    throw new Error(`未实现的任务类型: ${job.type}`);
  });
}

async function setup(): Promise<void> {
  await ensureAppDirs();
  await instanceStore.init();
  await vaultService.init();
  await queueService.init();
  await instanceStore.refreshRunningState();

  await app.register(multipart, {
    limits: {
      fileSize: 400 * 1024 * 1024
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    time: new Date().toISOString(),
    dataRoot: APP_PATHS.dataRoot
  }));

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
    const instance = instanceStore.get(params.id);
    const items = await scanResources(instance.rootPath);
    const summary = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1;
      return acc;
    }, {});
    return {
      instanceId: instance.id,
      total: items.length,
      summary,
      items
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

  const interval = setInterval(() => {
    void processQueue();
  }, 8000);

  app.addHook("onClose", async () => {
    clearInterval(interval);
  });

  const port = Number(process.env.PORT ?? 3888);
  await app.listen({
    host: "127.0.0.1",
    port
  });
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
