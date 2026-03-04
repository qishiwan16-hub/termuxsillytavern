import path from "node:path";
import fs from "fs-extra";
import JSZip from "jszip";
import { assertSafeRelativePath, resolveInsideRoot } from "./path-safety.js";

const IGNORED_DIRS = new Set([".git", "node_modules"]);

async function collectFiles(rootPath: string, relPath: string, zip: JSZip): Promise<void> {
  const absPath = path.join(rootPath, relPath);
  const stat = await fs.stat(absPath);
  if (!stat.isDirectory()) {
    zip.file(relPath.replace(/\\/g, "/"), await fs.readFile(absPath));
    return;
  }

  const entries = await fs.readdir(absPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const childRel = relPath ? path.join(relPath, entry.name) : entry.name;
    await collectFiles(rootPath, childRel, zip);
  }
}

export async function createZipFromPaths(
  rootPath: string,
  relPaths: string[]
): Promise<Buffer> {
  const zip = new JSZip();
  const selected = relPaths.length > 0 ? relPaths : [""];

  for (const relPath of selected) {
    const safeRel = assertSafeRelativePath(relPath);
    if (!safeRel) {
      const entries = await fs.readdir(rootPath);
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry)) {
          continue;
        }
        await collectFiles(rootPath, entry, zip);
      }
      continue;
    }
    await collectFiles(rootPath, safeRel, zip);
  }

  zip.file(
    "stpkg.json",
    JSON.stringify(
      {
        format: "st-resource-manager",
        version: 1,
        exportedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

export async function extractZipToRoot(
  rootPath: string,
  buffer: Buffer,
  targetRelDir = ""
): Promise<number> {
  const zip = await JSZip.loadAsync(buffer);
  let written = 0;

  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }
    if (entryName === "stpkg.json") {
      continue;
    }
    const normalized = entryName.replace(/\\/g, "/");
    const safeEntry = assertSafeRelativePath(normalized);
    const mergedRel = targetRelDir
      ? `${assertSafeRelativePath(targetRelDir)}/${safeEntry}`
      : safeEntry;
    const targetAbs = await resolveInsideRoot(rootPath, mergedRel, true);
    await fs.ensureDir(path.dirname(targetAbs));
    await fs.writeFile(targetAbs, await entry.async("nodebuffer"));
    written += 1;
  }
  return written;
}
