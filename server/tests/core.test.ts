import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import fs from "fs-extra";
import { APP_PATHS, ensureAppDirs } from "../lib/env.js";
import { resolveInsideRoot } from "../lib/path-safety.js";
import { QueueService } from "../lib/queue-service.js";
import { createBackup, listBackups } from "../lib/backup.js";
import { VaultService } from "../lib/vault-service.js";

async function resetDataRoot(): Promise<void> {
  await fs.remove(APP_PATHS.dataRoot);
  await ensureAppDirs();
}

test("路径安全: 拒绝越界路径", async () => {
  await resetDataRoot();
  const root = path.join(APP_PATHS.dataRoot, "instance-a");
  await fs.ensureDir(root);
  const resolved = await resolveInsideRoot(root, "data/file.txt", true);
  assert.ok(resolved.endsWith(path.join("data", "file.txt")));
  await assert.rejects(() => resolveInsideRoot(root, "../outside.txt", true));
});

test("队列: blocked 任务在可执行时完成", async () => {
  await resetDataRoot();
  const queue = new QueueService();
  await queue.init();
  const job = await queue.enqueue({
    type: "write",
    status: "blocked",
    reason: "st-running",
    payload: {
      instanceId: "default",
      relPath: "a.txt",
      content: "hello"
    }
  });
  let executed = false;
  await queue.process(async () => null, async (item) => {
    if (item.id === job.id) {
      executed = true;
    }
  });
  const current = queue.list().find((item) => item.id === job.id);
  assert.ok(executed);
  assert.equal(current?.status, "done");
});

test("备份: 单资源最多保留10份", async () => {
  await resetDataRoot();
  const instanceRoot = path.join(APP_PATHS.dataRoot, "instance-b");
  await fs.ensureDir(instanceRoot);
  const relPath = "data/default-user/settings.json";
  const absPath = path.join(instanceRoot, relPath);
  await fs.ensureDir(path.dirname(absPath));

  for (let i = 0; i < 14; i += 1) {
    await fs.writeFile(absPath, JSON.stringify({ version: i }), "utf8");
    await createBackup("test-instance", absPath, relPath);
  }

  const backups = await listBackups("test-instance", relPath);
  assert.ok(backups.length <= 10);
  assert.ok(backups.length > 0);
});

test("Vault: 标签检索与收藏过滤可用", async () => {
  await resetDataRoot();
  const vault = new VaultService();
  await vault.init();

  const itemA = await vault.importBuffer("hero-card.png", Buffer.from("a"), ["角色", "美化"]);
  const itemB = await vault.importBuffer("world-book.json", Buffer.from("{}"), ["世界书"]);
  await vault.updateMeta(itemB.id, { favorite: true, tags: ["世界书", "精选"] });

  const byTag = vault.list({ tags: ["角色"] });
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0]?.id, itemA.id);

  const favoriteOnly = vault.list({ favorite: true });
  assert.equal(favoriteOnly.length, 1);
  assert.equal(favoriteOnly[0]?.id, itemB.id);
});
