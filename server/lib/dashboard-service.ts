import path from "node:path";
import fs from "fs-extra";
import type {
  DashboardInstanceSummary,
  DashboardSummary,
  Instance,
  QueueJob,
  ResourceType
} from "../types.js";
import { ScanCacheService } from "./scan-cache-service.js";

function emptyResourceStats(): Record<ResourceType, number> {
  return {
    character: 0,
    world: 0,
    preset: 0,
    chat: 0,
    extension: 0,
    prompt: 0,
    theme: 0,
    config: 0,
    plugin: 0,
    asset: 0,
    other: 0
  };
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    const normalized = path.resolve(item);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function inferSillyTavernRoot(resourceRootPath: string): string {
  const abs = path.resolve(resourceRootPath);
  const parsed = path.parse(abs);
  const rel = abs.slice(parsed.root.length);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    const current = parts[index]?.toLowerCase();
    const next = parts[index + 1]?.toLowerCase();
    if (current === "data" && next === "default-user") {
      const prefix = parts.slice(0, index);
      return path.join(parsed.root, ...prefix);
    }
  }
  return abs;
}

async function readPackageInfo(dirPath: string): Promise<{ name: string; version: string } | null> {
  const packageJsonPath = path.join(dirPath, "package.json");
  if (!(await fs.pathExists(packageJsonPath))) {
    return null;
  }
  try {
    const pkg = (await fs.readJson(packageJsonPath)) as { name?: string; version?: string };
    const version = pkg.version?.trim();
    if (!version) {
      return null;
    }
    return {
      name: (pkg.name ?? "").trim().toLowerCase(),
      version
    };
  } catch {
    return null;
  }
}

async function detectVersion(instanceRootPath: string): Promise<string> {
  const abs = path.resolve(instanceRootPath);
  const stRoot = inferSillyTavernRoot(abs);
  const candidates = uniquePaths([
    stRoot,
    abs,
    path.resolve(abs, ".."),
    path.resolve(abs, "..", "..")
  ]);

  let fallbackVersion: string | null = null;
  for (const candidate of candidates) {
    const pkg = await readPackageInfo(candidate);
    if (!pkg) continue;
    if (pkg.name.includes("sillytavern")) {
      return pkg.version;
    }
    if (!fallbackVersion) {
      fallbackVersion = pkg.version;
    }
  }
  return fallbackVersion ?? "unknown";
}

function calcQueueStats(jobs: QueueJob[]): DashboardSummary["queueStats"] {
  const stats: DashboardSummary["queueStats"] = {
    total: jobs.length,
    blocked: 0,
    failed: 0,
    running: 0,
    pending: 0,
    updatedAt: jobs[0]?.updatedAt ?? new Date().toISOString()
  };
  for (const job of jobs) {
    if (job.status === "blocked") stats.blocked += 1;
    if (job.status === "failed") stats.failed += 1;
    if (job.status === "running") stats.running += 1;
    if (job.status === "pending") stats.pending += 1;
    if (job.updatedAt > stats.updatedAt) {
      stats.updatedAt = job.updatedAt;
    }
  }
  return stats;
}

function calcResourceStats(items: Array<{ type: ResourceType; isDir: boolean }>): Record<ResourceType, number> {
  const stats = emptyResourceStats();
  for (const item of items) {
    if (item.isDir) continue;
    stats[item.type] += 1;
  }
  return stats;
}

export class DashboardService {
  constructor(private readonly scanCacheService: ScanCacheService) {}

  async buildSummary(params: {
    selectedInstanceId?: string;
    instances: Instance[];
    queueJobs: QueueJob[];
    vaultCount: number;
  }): Promise<DashboardSummary> {
    const selected =
      params.instances.find((item) => item.id === params.selectedInstanceId) ?? params.instances[0] ?? null;

    const summaries: DashboardInstanceSummary[] = [];
    for (const instance of params.instances) {
      const cached = await this.scanCacheService.getOrRefresh(
        instance.id,
        instance.rootPath,
        "none"
      );
      const fileCount = cached.items.filter((item) => !item.isDir).length;
      summaries.push({
        id: instance.id,
        name: instance.name,
        rootPath: instance.rootPath,
        isRunning: instance.isRunning,
        version: await detectVersion(instance.rootPath),
        resourceTotal: fileCount
      });
    }

    let selectedStats = emptyResourceStats();
    if (selected) {
      const cached = await this.scanCacheService.getOrRefresh(
        selected.id,
        selected.rootPath,
        "incremental"
      );
      selectedStats = calcResourceStats(cached.items);
    }
    selectedStats.asset += params.vaultCount;

    return {
      selectedInstanceId: selected?.id ?? null,
      selectedInstance: summaries.find((item) => item.id === selected?.id),
      instances: summaries,
      resourceStats: selectedStats,
      queueStats: calcQueueStats(params.queueJobs),
      quickActions: [
        { id: "import-zip", title: "导入 ZIP", action: "import-zip" },
        { id: "batch-apply", title: "批量取用", action: "batch-apply" },
        { id: "open-trash", title: "回收站", action: "open-trash" },
        { id: "restore-backup", title: "备份恢复", action: "restore-backup" }
      ]
    };
  }
}
