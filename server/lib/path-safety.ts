import path from "node:path";
import fs from "fs-extra";

function normalizeToPosix(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function startsWithPath(parent: string, child: string): boolean {
  const normalizedParent = path.resolve(parent);
  const normalizedChild = path.resolve(child);
  if (normalizedParent === normalizedChild) {
    return true;
  }
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

export function assertSafeRelativePath(relPath: string): string {
  const normalized = normalizeToPosix(relPath).trim();
  if (!normalized || normalized === ".") {
    return "";
  }
  if (path.isAbsolute(normalized)) {
    throw new Error("不允许绝对路径");
  }
  const parts = normalized.split("/");
  if (parts.includes("..")) {
    throw new Error("检测到非法路径穿越");
  }
  return normalized;
}

export async function resolveInsideRoot(
  rootPath: string,
  relPath: string,
  allowNonExistent = false
): Promise<string> {
  const safeRel = assertSafeRelativePath(relPath);
  const rootReal = await fs.realpath(rootPath);
  const target = path.resolve(rootReal, safeRel);

  const targetExists = await fs.pathExists(target);
  if (targetExists) {
    const targetReal = await fs.realpath(target);
    if (!startsWithPath(rootReal, targetReal)) {
      throw new Error("路径越界，拒绝访问");
    }
    return targetReal;
  }

  if (!allowNonExistent) {
    throw new Error("目标不存在");
  }

  const parentReal = await fs.realpath(path.dirname(target));
  if (!startsWithPath(rootReal, parentReal)) {
    throw new Error("路径越界，拒绝写入");
  }
  return target;
}

export async function ensureDirInsideRoot(rootPath: string, relPath: string): Promise<string> {
  const absPath = await resolveInsideRoot(rootPath, relPath, true);
  await fs.ensureDir(absPath);
  return absPath;
}

export function toSafeBackupSegment(relPath: string): string {
  return assertSafeRelativePath(relPath).replace(/\//g, "__").replace(/\s+/g, "_");
}
