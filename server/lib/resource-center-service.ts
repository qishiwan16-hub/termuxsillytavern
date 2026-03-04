import path from "node:path";
import fs from "fs-extra";
import type { Instance, PreviewKind, ResourceItem, ResourceScanItem, ResourceType, VaultItem } from "../types.js";
import { APP_PATHS } from "./env.js";
import { ScanCacheService } from "./scan-cache-service.js";
import { VaultService } from "./vault-service.js";
import { resolveInsideRoot } from "./path-safety.js";

type RefreshMode = "none" | "incremental" | "full";

export interface ResourceQuery {
  source: "all" | "instance" | "vault";
  instanceId?: string;
  q?: string;
  type?: string;
  tags: string[];
  favorite?: boolean;
  offset: number;
  limit: number;
  includeDirs: boolean;
  refreshMode: RefreshMode;
}

export interface ResourceListResult {
  items: ResourceItem[];
  total: number;
  offset: number;
  limit: number;
  summary: Record<ResourceType, number>;
  sourceSummary: Record<"instance" | "vault", number>;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"]);
const JSON_EXTENSIONS = new Set([".json"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".yaml",
  ".yml",
  ".ini",
  ".log",
  ".css",
  ".js",
  ".ts",
  ".html",
  ".xml",
  ".csv"
]);

function inferPreviewKind(relPath: string, isDir: boolean): PreviewKind {
  if (isDir) return "none";
  const ext = path.extname(relPath.toLowerCase());
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (JSON_EXTENSIONS.has(ext)) return "json";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "none";
}

function normalizeText(input?: string): string {
  return input?.trim().toLowerCase() ?? "";
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export class ResourceCenterService {
  constructor(
    private readonly scanCacheService: ScanCacheService,
    private readonly vaultService: VaultService
  ) {}

  private matchInstanceScan(
    item: ResourceScanItem,
    query: ResourceQuery,
    normalizedQ: string,
    normalizedType: string
  ): boolean {
    if (!query.includeDirs && item.isDir) return false;
    if (normalizedType && item.type.toLowerCase() !== normalizedType) return false;
    if (!normalizedQ) return true;
    const rel = item.relPath.toLowerCase();
    const type = item.type.toLowerCase();
    return rel.includes(normalizedQ) || type.includes(normalizedQ);
  }

  private toInstanceResource(instance: Instance, item: ResourceScanItem): ResourceItem {
    const previewKind = inferPreviewKind(item.relPath, item.isDir);
    return {
      id: `instance:${instance.id}:${item.relPath}`,
      source: "instance",
      instanceId: instance.id,
      relPath: item.relPath,
      title: path.basename(item.relPath) || item.relPath || instance.name,
      type: item.type,
      tags: [],
      favorite: false,
      isDir: item.isDir,
      previewKind,
      editable: !item.isDir && (previewKind === "text" || previewKind === "json")
    };
  }

  private matchVaultItem(
    item: VaultItem,
    query: ResourceQuery,
    normalizedQ: string,
    normalizedType: string,
    normalizedTags: string[]
  ): boolean {
    if (query.favorite !== undefined && item.favorite !== query.favorite) return false;
    if (normalizedType && item.type.toLowerCase() !== normalizedType) return false;
    if (normalizedTags.length > 0) {
      const own = new Set(item.tags.map((tag) => tag.toLowerCase()));
      if (!normalizedTags.every((tag) => own.has(tag))) return false;
    }
    if (!normalizedQ) return true;
    const q = normalizedQ;
    const inTitle = item.title.toLowerCase().includes(q);
    const inPath = item.relPath.toLowerCase().includes(q);
    const inTags = item.tags.some((tag) => tag.toLowerCase().includes(q));
    const inType = item.type.toLowerCase().includes(q);
    return inTitle || inPath || inTags || inType;
  }

  private toVaultResource(item: VaultItem): ResourceItem {
    const previewKind = inferPreviewKind(item.relPath, false);
    return {
      id: `vault:${item.id}`,
      source: "vault",
      relPath: item.relPath,
      title: item.title,
      type: item.type,
      tags: item.tags,
      favorite: item.favorite,
      isDir: false,
      previewKind,
      editable: false
    };
  }

  private async enrichPageItems(
    items: ResourceItem[],
    instanceMap: Map<string, Instance>
  ): Promise<ResourceItem[]> {
    const enriched = await Promise.all(
      items.map(async (item) => {
        try {
          let absPath = "";
          if (item.source === "instance") {
            const instance = instanceMap.get(item.instanceId ?? "");
            if (!instance) {
              return item;
            }
            absPath = await resolveInsideRoot(instance.rootPath, item.relPath, false);
          } else {
            absPath = await resolveInsideRoot(APP_PATHS.vaultFilesDir, item.relPath, false);
          }
          const stat = await fs.stat(absPath);
          return {
            ...item,
            size: stat.isDirectory() ? undefined : stat.size,
            updatedAt: stat.mtime.toISOString()
          };
        } catch {
          return item;
        }
      })
    );
    return enriched;
  }

  async list(query: ResourceQuery, instances: Instance[]): Promise<ResourceListResult> {
    const normalizedQ = normalizeText(query.q);
    const normalizedType = normalizeText(query.type);
    const normalizedTags = normalizeTags(query.tags);

    const instanceMap = new Map(instances.map((instance) => [instance.id, instance]));
    const all: ResourceItem[] = [];

    if (query.source !== "vault") {
      const targetInstances = query.instanceId
        ? instances.filter((instance) => instance.id === query.instanceId)
        : instances;
      for (const instance of targetInstances) {
        const cached = await this.scanCacheService.getOrRefresh(
          instance.id,
          instance.rootPath,
          query.refreshMode
        );
        for (const scanItem of cached.items) {
          if (!this.matchInstanceScan(scanItem, query, normalizedQ, normalizedType)) {
            continue;
          }
          all.push(this.toInstanceResource(instance, scanItem));
        }
      }
    }

    if (query.source !== "instance") {
      const vaultItems = this.vaultService.list();
      for (const vaultItem of vaultItems) {
        if (!this.matchVaultItem(vaultItem, query, normalizedQ, normalizedType, normalizedTags)) {
          continue;
        }
        all.push(this.toVaultResource(vaultItem));
      }
    }

    all.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

    const summary = all.reduce<Record<ResourceType, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1;
      return acc;
    }, {} as Record<ResourceType, number>);

    const sourceSummary = all.reduce<Record<"instance" | "vault", number>>(
      (acc, item) => {
        acc[item.source] = (acc[item.source] ?? 0) + 1;
        return acc;
      },
      { instance: 0, vault: 0 }
    );

    const page = all.slice(query.offset, query.offset + query.limit);
    const items = await this.enrichPageItems(page, instanceMap);

    return {
      items,
      total: all.length,
      offset: query.offset,
      limit: query.limit,
      summary,
      sourceSummary
    };
  }
}
