import assert from "node:assert/strict";
import path from "node:path";
import fs from "fs-extra";
import { APP_PATHS, ensureAppDirs } from "../lib/env.js";
import { resolveInsideRoot } from "../lib/path-safety.js";
import { QueueService } from "../lib/queue-service.js";
import { createBackup, listBackups } from "../lib/backup.js";
import { VaultService } from "../lib/vault-service.js";
import { AuthService } from "../lib/auth-service.js";
import { scanResourcesPaged } from "../lib/file-tree.js";
import { TrashService } from "../lib/trash-service.js";

async function resetDataRoot(): Promise<void> {
  await fs.remove(APP_PATHS.dataRoot);
  await ensureAppDirs();
}

async function testPathSafety(): Promise<void> {
  await resetDataRoot();
  const root = path.join(APP_PATHS.dataRoot, "instance-a");
  await fs.ensureDir(root);
  const resolved = await resolveInsideRoot(root, "data/file.txt", true);
  assert.ok(resolved.endsWith(path.join("data", "file.txt")));
  await assert.rejects(() => resolveInsideRoot(root, "../outside.txt", true));
}

async function testQueue(): Promise<void> {
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
}

async function testBackup(): Promise<void> {
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
}

async function testVaultTagSearch(): Promise<void> {
  await resetDataRoot();
  const vault = new VaultService();
  await vault.init();

  const itemA = await vault.importBuffer("hero-card.png", Buffer.from("a"), ["role", "style"]);
  const itemB = await vault.importBuffer("world-book.json", Buffer.from("{}"), ["worldbook"]);
  await vault.updateMeta(itemB.id, { favorite: true, tags: ["worldbook", "featured"] });

  const byTag = vault.list({ tags: ["role"] });
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0]?.id, itemA.id);

  const favoriteOnly = vault.list({ favorite: true });
  assert.equal(favoriteOnly.length, 1);
  assert.equal(favoriteOnly[0]?.id, itemB.id);
}

async function testAuthLifecycle(): Promise<void> {
  await resetDataRoot();
  const auth = new AuthService();
  await auth.init();

  const initial = auth.status();
  assert.equal(initial.enabled, false);
  assert.equal(initial.passwordConfigured, false);

  await auth.setupPassword("123456");
  const setup = auth.status();
  assert.equal(setup.enabled, true);
  assert.equal(setup.passwordConfigured, true);

  const token = await auth.login("123456");
  assert.ok(token.length > 10);
  assert.equal(auth.isRequestAuthorized(token), true);
  auth.logout(token);
  assert.equal(auth.isRequestAuthorized(token), false);

  await auth.setEnabled(false);
  assert.equal(auth.status().enabled, false);

  await auth.setEnabled(true);
  assert.equal(auth.status().enabled, true);
}

async function testScanPaging(): Promise<void> {
  await resetDataRoot();
  const root = path.join(APP_PATHS.dataRoot, "instance-scan");
  await fs.ensureDir(path.join(root, "data/default-user/characters"));
  await fs.ensureDir(path.join(root, "data/default-user/worlds"));
  await fs.writeFile(path.join(root, "data/default-user/characters/a.json"), "{}", "utf8");
  await fs.writeFile(path.join(root, "data/default-user/characters/b.json"), "{}", "utf8");
  await fs.writeFile(path.join(root, "data/default-user/worlds/c.json"), "{}", "utf8");

  const page1 = await scanResourcesPaged(root, {
    offset: 0,
    limit: 2,
    includeDirs: false
  });
  assert.equal(page1.items.length, 2);
  assert.ok(page1.total >= 3);

  const page2 = await scanResourcesPaged(root, {
    offset: 2,
    limit: 2,
    includeDirs: false
  });
  assert.ok(page2.items.length >= 1);

  const filtered = await scanResourcesPaged(root, {
    offset: 0,
    limit: 50,
    includeDirs: false,
    type: "world"
  });
  assert.ok(filtered.total >= 1);
}

async function testTrashLifecycle(): Promise<void> {
  await resetDataRoot();
  const vault = new VaultService();
  await vault.init();
  const trash = new TrashService();
  await trash.init(30);

  const imported = await vault.importBuffer("trash-target.txt", Buffer.from("abc"), ["test"]);
  const detached = await vault.detachItem(imported.id);
  const trashed = await trash.trashVaultItem(detached.item, detached.absPath);
  assert.equal(trash.list({ offset: 0, limit: 10 }).items.length, 1);

  const restored = await trash.restoreItem({
    itemId: trashed.id,
    resolveInstanceRoot: async () => {
      throw new Error("not needed");
    },
    resolveVaultTargetPath: async (relPath) => vault.resolveAbsoluteByRelPath(relPath, true),
    restoreVaultMeta: async (snapshot, restoredRelPath) =>
      vault.restoreDetachedItem(snapshot, restoredRelPath)
  });
  assert.equal(restored.item.source, "vault");

  const existed = vault.list({ q: "trash-target" });
  assert.ok(existed.length >= 1);
}

async function run(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["Path Safety", testPathSafety],
    ["Queue Processing", testQueue],
    ["Backup Rotation", testBackup],
    ["Vault Tag Search", testVaultTagSearch],
    ["Auth Lifecycle", testAuthLifecycle],
    ["Scan Paging", testScanPaging],
    ["Trash Lifecycle", testTrashLifecycle]
  ];

  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`ALL PASS (${passed}/${tests.length})`);
}

void run();
