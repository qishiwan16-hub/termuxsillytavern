import path from "node:path";
import fs from "fs-extra";
import { createBackup } from "./backup.js";
import { resolveInsideRoot } from "./path-safety.js";

export const LARGE_FILE_LIMIT = 5 * 1024 * 1024;

export interface ReadFileResult {
  relPath: string;
  size: number;
  readOnly: boolean;
  truncated: boolean;
  content: string;
  encoding: "utf8";
}

export async function readTextFile(
  rootPath: string,
  relPath: string,
  maxPreviewBytes = LARGE_FILE_LIMIT
): Promise<ReadFileResult> {
  const absPath = await resolveInsideRoot(rootPath, relPath, false);
  const stat = await fs.stat(absPath);
  const readOnly = stat.size > LARGE_FILE_LIMIT;
  const previewBytes = Math.min(stat.size, maxPreviewBytes);
  const content = await fs.readFile(absPath, {
    encoding: "utf8",
    flag: "r"
  });
  return {
    relPath,
    size: stat.size,
    readOnly,
    truncated: stat.size > previewBytes,
    content: stat.size > previewBytes ? content.slice(0, previewBytes) : content,
    encoding: "utf8"
  };
}

export async function writeTextFileWithBackup(params: {
  instanceId: string;
  rootPath: string;
  relPath: string;
  content: string;
  createBackupBeforeWrite: boolean;
}): Promise<{ backupPath: string | null }> {
  const { instanceId, rootPath, relPath, content, createBackupBeforeWrite } = params;
  const targetAbs = await resolveInsideRoot(rootPath, relPath, true);
  await fs.ensureDir(path.dirname(targetAbs));
  let backupPath: string | null = null;
  if (createBackupBeforeWrite) {
    backupPath = await createBackup(instanceId, targetAbs, relPath);
  }
  const tempPath = `${targetAbs}.tmp-${Date.now()}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.move(tempPath, targetAbs, { overwrite: true });
  return { backupPath };
}
