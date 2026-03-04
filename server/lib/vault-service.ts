import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import JSZip from "jszip";
import type { VaultItem } from "../types.js";
import { APP_PATHS } from "./env.js";
import { inferResourceTypeByPath } from "./resource-type.js";
import { assertSafeRelativePath, resolveInsideRoot } from "./path-safety.js";

interface VaultMetaFile {
  items: VaultItem[];
}

interface ListVaultParams {
  q?: string;
  tags?: string[];
  favorite?: boolean;
}

interface UpdateVaultMetaInput {
  title?: string;
  tags?: string[];
  favorite?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 150) || "unnamed";
}

export class VaultService {
  private items: VaultItem[] = [];

  async init(): Promise<void> {
    await fs.ensureDir(APP_PATHS.vaultFilesDir);
    await fs.ensureFile(APP_PATHS.vaultMetaFile);
    const content = await fs.readFile(APP_PATHS.vaultMetaFile, "utf8").catch(() => "");
    if (!content.trim()) {
      this.items = [];
      await this.persist();
      return;
    }
    const parsed = (await fs.readJson(APP_PATHS.vaultMetaFile)) as VaultMetaFile;
    this.items = parsed.items ?? [];
  }

  private async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.vaultMetaFile, { items: this.items }, { spaces: 2 });
  }

  list(params: ListVaultParams = {}): VaultItem[] {
    const q = params.q?.toLowerCase().trim();
    const tags = params.tags?.map((tag) => tag.toLowerCase()) ?? [];
    return this.items.filter((item) => {
      if (typeof params.favorite === "boolean" && item.favorite !== params.favorite) {
        return false;
      }
      if (q) {
        const inTitle = item.title.toLowerCase().includes(q);
        const inPath = item.relPath.toLowerCase().includes(q);
        const inTags = item.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!inTitle && !inPath && !inTags) {
          return false;
        }
      }
      if (tags.length > 0) {
        const ownTags = new Set(item.tags.map((tag) => tag.toLowerCase()));
        if (!tags.every((tag) => ownTags.has(tag))) {
          return false;
        }
      }
      return true;
    });
  }

  hasItem(itemId: string): boolean {
    return this.items.some((item) => item.id === itemId);
  }

  get(itemId: string): VaultItem {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error("Vault 素材不存在");
    }
    return item;
  }

  async resolveItemAbsolutePath(itemId: string): Promise<string> {
    const item = this.get(itemId);
    return resolveInsideRoot(APP_PATHS.vaultFilesDir, item.relPath, false);
  }

  async resolveAbsoluteByRelPath(relPath: string, allowNonExistent = false): Promise<string> {
    return resolveInsideRoot(APP_PATHS.vaultFilesDir, relPath, allowNonExistent);
  }

  async importBuffer(filename: string, buffer: Buffer, tags: string[] = []): Promise<VaultItem> {
    const id = crypto.randomUUID();
    const safeName = sanitizeFilename(filename);
    const relPath = `${id}/${safeName}`;
    const targetAbs = await resolveInsideRoot(APP_PATHS.vaultFilesDir, relPath, true);
    await fs.ensureDir(path.dirname(targetAbs));
    await fs.writeFile(targetAbs, buffer);

    const item: VaultItem = {
      id,
      relPath,
      type: inferResourceTypeByPath(relPath),
      tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
      title: safeName,
      favorite: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  async importFromPath(sourcePath: string, tags: string[] = []): Promise<VaultItem> {
    const sourceAbs = path.resolve(sourcePath);
    const stat = await fs.stat(sourceAbs).catch(() => null);
    if (!stat) {
      throw new Error("来源路径不存在");
    }

    const id = crypto.randomUUID();
    const baseName = sanitizeFilename(path.basename(sourceAbs));
    const relPath = `${id}/${baseName}`;
    const targetAbs = await resolveInsideRoot(APP_PATHS.vaultFilesDir, relPath, true);
    await fs.ensureDir(path.dirname(targetAbs));
    await fs.copy(sourceAbs, targetAbs, { overwrite: true });

    const item: VaultItem = {
      id,
      relPath,
      type: inferResourceTypeByPath(relPath),
      tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
      title: baseName,
      favorite: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  async importZipBuffer(zipBuffer: Buffer, baseTags: string[] = []): Promise<VaultItem[]> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const created: VaultItem[] = [];
    for (const [entryName, entry] of Object.entries(zip.files)) {
      if (entry.dir || entryName === "stpkg.json") {
        continue;
      }
      const normalized = assertSafeRelativePath(entryName.replace(/\\/g, "/"));
      const buffer = await entry.async("nodebuffer");
      const item = await this.importBuffer(path.basename(normalized), buffer, baseTags);
      created.push(item);
    }
    return created;
  }

  async updateMeta(itemId: string, patch: UpdateVaultMetaInput): Promise<VaultItem> {
    const item = this.get(itemId);
    if (patch.title !== undefined) {
      item.title = patch.title.trim() || item.title;
    }
    if (patch.tags !== undefined) {
      item.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))];
    }
    if (patch.favorite !== undefined) {
      item.favorite = patch.favorite;
    }
    item.updatedAt = nowIso();
    await this.persist();
    return item;
  }

  async remove(itemId: string): Promise<void> {
    const item = this.get(itemId);
    const firstSegment = item.relPath.split("/")[0];
    const itemRoot = await resolveInsideRoot(APP_PATHS.vaultFilesDir, firstSegment, true);
    await fs.remove(itemRoot);
    this.items = this.items.filter((entry) => entry.id !== itemId);
    await this.persist();
  }

  async detachItem(itemId: string): Promise<{ item: VaultItem; absPath: string }> {
    const item = this.get(itemId);
    const absPath = await resolveInsideRoot(APP_PATHS.vaultFilesDir, item.relPath, false);
    this.items = this.items.filter((entry) => entry.id !== item.id);
    await this.persist();
    return {
      item: { ...item },
      absPath
    };
  }

  async restoreDetachedItem(snapshot: VaultItem, restoredRelPath: string): Promise<VaultItem> {
    let id = snapshot.id;
    if (this.hasItem(id)) {
      id = crypto.randomUUID();
    }
    const restored: VaultItem = {
      ...snapshot,
      id,
      relPath: assertSafeRelativePath(restoredRelPath),
      updatedAt: nowIso()
    };
    this.items.push(restored);
    await this.persist();
    return restored;
  }

  async applyToInstance(
    itemId: string,
    instanceRootPath: string,
    targetRelDir: string
  ): Promise<{ targetRelPath: string; copiedFrom: string }> {
    const item = this.get(itemId);
    const sourceAbs = await this.resolveItemAbsolutePath(itemId);
    const safeTargetDir = assertSafeRelativePath(targetRelDir);
    const targetDirAbs = await resolveInsideRoot(instanceRootPath, safeTargetDir, true);
    await fs.ensureDir(targetDirAbs);
    const name = path.basename(item.relPath);
    let targetAbs = path.join(targetDirAbs, name);
    if (await fs.pathExists(targetAbs)) {
      const stamp = Date.now().toString();
      targetAbs = path.join(targetDirAbs, `${stamp}-${name}`);
    }
    await fs.copy(sourceAbs, targetAbs, { overwrite: false, errorOnExist: false });
    const targetRelPath = path.relative(instanceRootPath, targetAbs).replace(/\\/g, "/");
    return {
      targetRelPath,
      copiedFrom: item.relPath
    };
  }
}
