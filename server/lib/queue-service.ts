import crypto from "node:crypto";
import fs from "fs-extra";
import { APP_PATHS } from "./env.js";
import type { QueueJob } from "../types.js";

interface QueueFileData {
  jobs: QueueJob[];
}

interface EnqueueInput {
  type: QueueJob["type"];
  payload: Record<string, unknown>;
  status?: QueueJob["status"];
  reason?: QueueJob["reason"];
}

function nowIso(): string {
  return new Date().toISOString();
}

export class QueueService {
  private jobs: QueueJob[] = [];
  private processing = false;

  async init(): Promise<void> {
    await fs.ensureFile(APP_PATHS.queueFile);
    const content = await fs.readFile(APP_PATHS.queueFile, "utf8").catch(() => "");
    if (!content.trim()) {
      this.jobs = [];
      await this.persist();
      return;
    }
    const parsed = (await fs.readJson(APP_PATHS.queueFile)) as QueueFileData;
    this.jobs = parsed.jobs ?? [];
  }

  private async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.queueFile, { jobs: this.jobs }, { spaces: 2 });
  }

  list(): QueueJob[] {
    return [...this.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt, "en"));
  }

  async enqueue(input: EnqueueInput): Promise<QueueJob> {
    const timestamp = nowIso();
    const job: QueueJob = {
      id: crypto.randomUUID(),
      type: input.type,
      status: input.status ?? "pending",
      reason: input.reason,
      payload: input.payload,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.jobs.push(job);
    await this.persist();
    return job;
  }

  async cancel(jobId: string): Promise<QueueJob> {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) {
      throw new Error("任务不存在");
    }
    if (job.status === "running") {
      throw new Error("运行中的任务不可取消");
    }
    job.status = "cancelled";
    job.updatedAt = nowIso();
    await this.persist();
    return job;
  }

  async process(
    shouldBlock: (job: QueueJob) => Promise<QueueJob["reason"] | null>,
    executor: (job: QueueJob) => Promise<void>
  ): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      for (const job of this.jobs) {
        if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
          continue;
        }

        const blockReason = await shouldBlock(job);
        if (blockReason) {
          job.status = "blocked";
          job.reason = blockReason;
          job.updatedAt = nowIso();
          continue;
        }

        job.status = "running";
        job.reason = undefined;
        job.updatedAt = nowIso();
        await this.persist();

        try {
          await executor(job);
          job.status = "done";
          job.lastError = undefined;
        } catch (error) {
          job.status = "failed";
          job.lastError = error instanceof Error ? error.message : String(error);
        }
        job.updatedAt = nowIso();
        await this.persist();
      }
      await this.persist();
    } finally {
      this.processing = false;
    }
  }
}
