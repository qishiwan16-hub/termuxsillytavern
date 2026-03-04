import path from "node:path";
import fs from "fs-extra";
import { APP_PATHS } from "./env.js";
import { assertSafeRelativePath } from "./path-safety.js";

const MAX_BACKUP_COUNT = 10;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupDirFor(instanceId: string, relPath: string): string {
  const safeRel = assertSafeRelativePath(relPath);
  const relDir = path.dirname(safeRel);
  return path.join(APP_PATHS.backupsDir, instanceId, relDir);
}

function backupFilenameFor(relPath: string): string {
  const base = path.basename(relPath);
  return `${base}.${timestamp()}.bak`;
}

async function trimOldBackups(dirPath: string, basename: string): Promise<void> {
  const items = await fs.readdir(dirPath).catch(() => []);
  const matched = items
    .filter((item) => item.startsWith(`${basename}.`) && item.endsWith(".bak"))
    .sort((a, b) => b.localeCompare(a, "en"));
  if (matched.length <= MAX_BACKUP_COUNT) {
    return;
  }
  const toDelete = matched.slice(MAX_BACKUP_COUNT);
  await Promise.all(toDelete.map((name) => fs.remove(path.join(dirPath, name))));
}

export async function createBackup(
  instanceId: string,
  sourceAbsPath: string,
  relPath: string
): Promise<string | null> {
  const exists = await fs.pathExists(sourceAbsPath);
  if (!exists) {
    return null;
  }
  const targetDir = backupDirFor(instanceId, relPath);
  await fs.ensureDir(targetDir);
  const filename = backupFilenameFor(relPath);
  const targetAbs = path.join(targetDir, filename);
  await fs.copyFile(sourceAbsPath, targetAbs);
  await trimOldBackups(targetDir, path.basename(relPath));
  return targetAbs;
}

export async function listBackups(instanceId: string, relPath: string): Promise<string[]> {
  const safeRel = assertSafeRelativePath(relPath);
  const dir = backupDirFor(instanceId, safeRel);
  const base = path.basename(safeRel);
  const entries = await fs.readdir(dir).catch(() => []);
  return entries
    .filter((item) => item.startsWith(`${base}.`) && item.endsWith(".bak"))
    .sort((a, b) => b.localeCompare(a, "en"));
}

export async function restoreBackup(
  instanceId: string,
  relPath: string,
  backupFile: string,
  targetAbsPath: string
): Promise<void> {
  const safeRel = assertSafeRelativePath(relPath);
  const dir = backupDirFor(instanceId, safeRel);
  const backupAbs = path.join(dir, backupFile);
  if (!(await fs.pathExists(backupAbs))) {
    throw new Error("备份不存在");
  }
  await fs.ensureDir(path.dirname(targetAbsPath));
  await fs.copyFile(backupAbs, targetAbsPath);
}
