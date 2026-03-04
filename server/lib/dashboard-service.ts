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

async function detectVersion(instanceRootPath: string): Promise<string> {
  const packageJsonPath = path.join(instanceRootPath, "package.json");
  if (!(await fs.pathExists(packageJsonPath))) {
    return "unknown";
  }
  try {
    const pkg = (await fs.readJson(packageJsonPath)) as { version?: string };
    return pkg.version?.trim() || "unknown";
  } catch {
    return "unknown";
  }
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
