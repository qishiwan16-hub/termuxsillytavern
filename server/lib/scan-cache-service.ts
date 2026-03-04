import path from "node:path";
import fs from "fs-extra";
import type { ResourceScanItem } from "../types.js";
import { APP_PATHS } from "./env.js";
import { inferResourceTypeByPath } from "./resource-type.js";

type RefreshMode = "none" | "incremental" | "full";

interface SegmentCache {
  signature: string;
  scannedAt: string;
  items: ResourceScanItem[];
}

interface InstanceScanCache {
  instanceId: string;
  rootPath: string;
  updatedAt: string;
  segments: Record<string, SegmentCache>;
}

interface ScanCacheFile {
  version: number;
  instances: Record<string, InstanceScanCache>;
}

interface QueryOptions {
  offset: number;
  limit: number;
  q?: string;
  type?: string;
  includeDirs: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function shouldIgnoreName(name: string): boolean {
  if (name.startsWith(".git")) {
    return true;
  }
  if (name === "node_modules") {
    return true;
  }
  return false;
}

export class ScanCacheService {
  private fileData: ScanCacheFile = {
    version: 1,
    instances: {}
  };

  async init(): Promise<void> {
    await fs.ensureFile(APP_PATHS.scanCacheFile);
    const content = await fs.readFile(APP_PATHS.scanCacheFile, "utf8").catch(() => "");
    if (!content.trim()) {
      await this.persist();
      return;
    }
    const parsed = (await fs.readJson(APP_PATHS.scanCacheFile)) as Partial<ScanCacheFile>;
    this.fileData = {
      version: parsed.version ?? 1,
      instances: parsed.instances ?? {}
    };
  }

  private async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.scanCacheFile, this.fileData, { spaces: 2 });
  }

  private ensureInstance(instanceId: string, rootPath: string): InstanceScanCache {
    const normalizedRoot = path.resolve(rootPath);
    const current = this.fileData.instances[instanceId];
    if (!current || path.resolve(current.rootPath) !== normalizedRoot) {
      const created: InstanceScanCache = {
        instanceId,
        rootPath: normalizedRoot,
        updatedAt: nowIso(),
        segments: {}
      };
      this.fileData.instances[instanceId] = created;
      return created;
    }
    return current;
  }

  async invalidateInstance(instanceId: string): Promise<void> {
    const instance = this.fileData.instances[instanceId];
    if (!instance) {
      return;
    }
    instance.segments = {};
    instance.updatedAt = nowIso();
    await this.persist();
  }

  private async scanPath(absPath: string, relPath: string, isDir: boolean): Promise<ResourceScanItem[]> {
    if (!isDir) {
      return [
        {
          relPath,
          isDir: false,
          type: inferResourceTypeByPath(relPath)
        }
      ];
    }

    const items: ResourceScanItem[] = [
      {
        relPath,
        isDir: true,
        type: inferResourceTypeByPath(relPath)
      }
    ];

    const entries = await fs.readdir(absPath, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldIgnoreName(entry.name)) {
        continue;
      }
      const childRel = `${relPath}/${entry.name}`.replace(/\\/g, "/");
      const childAbs = path.join(absPath, entry.name);
      items.push(...(await this.scanPath(childAbs, childRel, entry.isDirectory())));
    }
    return items;
  }

  private signatureForStat(stat: fs.Stats, isDir: boolean): string {
    const mtime = Math.floor(stat.mtimeMs);
    const size = isDir ? 0 : stat.size;
    return `${isDir ? "d" : "f"}:${mtime}:${size}`;
  }

  async getOrRefresh(
    instanceId: string,
    rootPath: string,
    refreshMode: RefreshMode
  ): Promise<{
    items: ResourceScanItem[];
    cache: {
      mode: RefreshMode;
      changedSegments: number;
      reusedSegments: number;
      updatedAt: string;
    };
  }> {
    const instanceCache = this.ensureInstance(instanceId, rootPath);

    if (refreshMode === "none" && Object.keys(instanceCache.segments).length > 0) {
      const items = Object.values(instanceCache.segments).flatMap((segment) => segment.items);
      return {
        items,
        cache: {
          mode: refreshMode,
          changedSegments: 0,
          reusedSegments: Object.keys(instanceCache.segments).length,
          updatedAt: instanceCache.updatedAt
        }
      };
    }

    const entries = await fs.readdir(instanceCache.rootPath, { withFileTypes: true }).catch(() => []);
    const topEntries = entries.filter((entry) => !shouldIgnoreName(entry.name));
    const seen = new Set<string>();
    let changedSegments = 0;
    let reusedSegments = 0;

    for (const entry of topEntries) {
      const key = entry.name;
      seen.add(key);
      const absPath = path.join(instanceCache.rootPath, entry.name);
      const stat = await fs.stat(absPath);
      const signature = this.signatureForStat(stat, entry.isDirectory());
      const existing = instanceCache.segments[key];

      if (refreshMode !== "full" && existing && existing.signature === signature) {
        reusedSegments += 1;
        continue;
      }

      const scannedItems = await this.scanPath(absPath, entry.name.replace(/\\/g, "/"), entry.isDirectory());
      instanceCache.segments[key] = {
        signature,
        scannedAt: nowIso(),
        items: scannedItems
      };
      changedSegments += 1;
    }

    for (const key of Object.keys(instanceCache.segments)) {
      if (!seen.has(key)) {
        delete instanceCache.segments[key];
        changedSegments += 1;
      }
    }

    instanceCache.updatedAt = nowIso();
    await this.persist();

    const items = Object.values(instanceCache.segments).flatMap((segment) => segment.items);
    return {
      items,
      cache: {
        mode: refreshMode,
        changedSegments,
        reusedSegments,
        updatedAt: instanceCache.updatedAt
      }
    };
  }

  query(allItems: ResourceScanItem[], options: QueryOptions): {
    total: number;
    summary: Record<string, number>;
    items: ResourceScanItem[];
  } {
    const keyword = options.q?.trim().toLowerCase() ?? "";
    const typeFilter = options.type?.trim().toLowerCase() ?? "";
    const summary: Record<string, number> = {};
    const matched: ResourceScanItem[] = [];

    for (const item of allItems) {
      if (!options.includeDirs && item.isDir) {
        continue;
      }
      if (typeFilter && item.type.toLowerCase() !== typeFilter) {
        continue;
      }
      if (keyword) {
        const hitPath = item.relPath.toLowerCase().includes(keyword);
        const hitType = item.type.toLowerCase().includes(keyword);
        if (!hitPath && !hitType) {
          continue;
        }
      }
      matched.push(item);
      summary[item.type] = (summary[item.type] ?? 0) + 1;
    }

    const paged = matched.slice(options.offset, options.offset + options.limit);
    return {
      total: matched.length,
      summary,
      items: paged
    };
  }
}
