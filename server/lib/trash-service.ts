import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { APP_PATHS } from "./env.js";
import { assertSafeRelativePath, resolveInsideRoot } from "./path-safety.js";
import type { TrashItem, VaultItem } from "../types.js";

interface TrashIndexFile {
  version: number;
  retentionDays: number;
  items: TrashItem[];
}

interface ListTrashQuery {
  source?: "instance" | "vault";
  offset?: number;
  limit?: number;
}

const DEFAULT_RETENTION_DAYS = 30;

function nowIso(): string {
  return new Date().toISOString();
}

function addDays(dateIso: string, days: number): string {
  const ts = Date.parse(dateIso);
  return new Date(ts + days * 24 * 60 * 60 * 1000).toISOString();
}

function clampRetentionDays(days: number): number {
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return 90;
}

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export class TrashService {
  private data: TrashIndexFile = {
    version: 1,
    retentionDays: DEFAULT_RETENTION_DAYS,
    items: []
  };

  async init(initialRetentionDays = DEFAULT_RETENTION_DAYS): Promise<void> {
    await fs.ensureFile(APP_PATHS.trashIndexFile);
    await fs.ensureDir(APP_PATHS.trashDir);
    const content = await fs.readFile(APP_PATHS.trashIndexFile, "utf8").catch(() => "");
    if (!content.trim()) {
      this.data = {
        version: 1,
        retentionDays: clampRetentionDays(initialRetentionDays),
        items: []
      };
      await this.persist();
      return;
    }
    const parsed = (await fs.readJson(APP_PATHS.trashIndexFile)) as Partial<TrashIndexFile>;
    this.data = {
      version: parsed.version ?? 1,
      retentionDays: clampRetentionDays(Number(parsed.retentionDays ?? initialRetentionDays)),
      items: parsed.items ?? []
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.trashIndexFile, this.data, { spaces: 2 });
  }

  getRetentionDays(): number {
    return this.data.retentionDays;
  }

  async setRetentionDays(days: number): Promise<number> {
    this.data.retentionDays = clampRetentionDays(days);
    await this.persist();
    return this.data.retentionDays;
  }

  list(query: ListTrashQuery = {}): { items: TrashItem[]; total: number; offset: number; limit: number } {
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));
    const filtered =
      query.source === undefined
        ? this.data.items
        : this.data.items.filter((item) => item.source === query.source);
    const sorted = [...filtered].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return {
      items: sorted.slice(offset, offset + limit),
      total: sorted.length,
      offset,
      limit
    };
  }

  private buildTrashRelPath(source: "instance" | "vault", token: string, originalRelPath: string): string {
    const baseName = path.basename(originalRelPath);
    const folder = source === "instance" ? "instance" : "vault";
    return `${folder}/${token}-${baseName}`.replace(/\\/g, "/");
  }

  private async resolveTrashAbs(trashRelPath: string): Promise<string> {
    const safeRel = assertSafeRelativePath(trashRelPath);
    return resolveInsideRoot(APP_PATHS.trashDir, safeRel, true);
  }

  async trashInstancePath(
    instanceId: string,
    instanceRootPath: string,
    relPath: string
  ): Promise<TrashItem> {
    const safeRelPath = assertSafeRelativePath(relPath);
    const sourceAbs = await resolveInsideRoot(instanceRootPath, safeRelPath, false);
    const stat = await fs.stat(sourceAbs);
    const id = crypto.randomUUID();
    const deletedAt = nowIso();
    const trashedRelPath = this.buildTrashRelPath("instance", id, safeRelPath);
    const targetAbs = await this.resolveTrashAbs(trashedRelPath);
    await fs.ensureDir(path.dirname(targetAbs));
    await fs.move(sourceAbs, targetAbs, { overwrite: false });

    const item: TrashItem = {
      id,
      source: "instance",
      instanceId,
      originalRelPath: safeRelPath,
      trashedRelPath,
      isDir: stat.isDirectory(),
      size: stat.isDirectory() ? undefined : stat.size,
      deletedAt,
      expireAt: addDays(deletedAt, this.data.retentionDays)
    };
    this.data.items.push(item);
    await this.persist();
    return item;
  }

  async trashVaultItem(vaultItem: VaultItem, sourceAbs: string): Promise<TrashItem> {
    const id = crypto.randomUUID();
    const deletedAt = nowIso();
    const trashedRelPath = this.buildTrashRelPath("vault", id, vaultItem.relPath);
    const targetAbs = await this.resolveTrashAbs(trashedRelPath);
    const stat = await fs.stat(sourceAbs);
    await fs.ensureDir(path.dirname(targetAbs));
    await fs.move(sourceAbs, targetAbs, { overwrite: false });

    const item: TrashItem = {
      id,
      source: "vault",
      originalRelPath: vaultItem.relPath,
      trashedRelPath,
      isDir: stat.isDirectory(),
      size: stat.isDirectory() ? undefined : stat.size,
      deletedAt,
      expireAt: addDays(deletedAt, this.data.retentionDays),
      vaultSnapshot: vaultItem
    };
    this.data.items.push(item);
    await this.persist();
    return item;
  }

  private getById(itemId: string): TrashItem {
    const item = this.data.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error("回收站条目不存在");
    }
    return item;
  }

  private async removeIndexItem(itemId: string): Promise<void> {
    this.data.items = this.data.items.filter((item) => item.id !== itemId);
    await this.persist();
  }

  async restoreItem(params: {
    itemId: string;
    resolveInstanceRoot: (instanceId: string) => Promise<string>;
    resolveVaultTargetPath: (relPath: string) => Promise<string>;
    restoreVaultMeta: (snapshot: VaultItem, restoredRelPath: string) => Promise<VaultItem>;
  }): Promise<{ item: TrashItem; restoredRelPath: string }> {
    const item = this.getById(params.itemId);
    const sourceAbs = await this.resolveTrashAbs(item.trashedRelPath);
    if (!(await fs.pathExists(sourceAbs))) {
      throw new Error("回收站文件不存在，无法恢复");
    }

    if (item.source === "instance") {
      if (!item.instanceId) {
        throw new Error("实例来源缺失，无法恢复");
      }
      const instanceRootPath = await params.resolveInstanceRoot(item.instanceId);
      let targetAbs = await resolveInsideRoot(instanceRootPath, item.originalRelPath, true);
      if (await fs.pathExists(targetAbs)) {
        const parsed = path.parse(item.originalRelPath);
        const renamed = path
          .join(parsed.dir, `${parsed.name}-${timestampSuffix()}${parsed.ext}`)
          .replace(/\\/g, "/");
        targetAbs = await resolveInsideRoot(instanceRootPath, renamed, true);
      }
      await fs.ensureDir(path.dirname(targetAbs));
      await fs.move(sourceAbs, targetAbs, { overwrite: false });
      const restoredRelPath = path.relative(instanceRootPath, targetAbs).replace(/\\/g, "/");
      await this.removeIndexItem(item.id);
      return { item, restoredRelPath };
    }

    if (!item.vaultSnapshot) {
      throw new Error("Vault 元数据快照缺失，无法恢复");
    }

    let targetAbs = await params.resolveVaultTargetPath(item.originalRelPath);
    if (await fs.pathExists(targetAbs)) {
      const parsed = path.parse(item.originalRelPath);
      const renamed = path
        .join(parsed.dir, `${parsed.name}-${timestampSuffix()}${parsed.ext}`)
        .replace(/\\/g, "/");
      targetAbs = await params.resolveVaultTargetPath(renamed);
    }
    await fs.ensureDir(path.dirname(targetAbs));
    await fs.move(sourceAbs, targetAbs, { overwrite: false });
    const restoredRelPath = path.relative(APP_PATHS.vaultFilesDir, targetAbs).replace(/\\/g, "/");
    await params.restoreVaultMeta(item.vaultSnapshot, restoredRelPath);
    await this.removeIndexItem(item.id);
    return { item, restoredRelPath };
  }

  async deletePermanent(itemId: string): Promise<void> {
    const item = this.getById(itemId);
    const targetAbs = await this.resolveTrashAbs(item.trashedRelPath);
    if (await fs.pathExists(targetAbs)) {
      await fs.remove(targetAbs);
    }
    await this.removeIndexItem(item.id);
  }

  async cleanupExpired(now = new Date()): Promise<{ removed: number }> {
    const deadline = now.getTime();
    const expired = this.data.items.filter((item) => Date.parse(item.expireAt) <= deadline);
    for (const item of expired) {
      const targetAbs = await this.resolveTrashAbs(item.trashedRelPath);
      if (await fs.pathExists(targetAbs)) {
        await fs.remove(targetAbs);
      }
    }
    if (expired.length > 0) {
      const expiredSet = new Set(expired.map((item) => item.id));
      this.data.items = this.data.items.filter((item) => !expiredSet.has(item.id));
      await this.persist();
    }
    return { removed: expired.length };
  }
}
