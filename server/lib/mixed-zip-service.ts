import path from "node:path";
import fs from "fs-extra";
import JSZip from "jszip";

const IGNORED_DIRS = new Set([".git", "node_modules"]);

async function addPathToZip(zip: JSZip, absPath: string, zipRelPath: string): Promise<void> {
  const stat = await fs.stat(absPath);
  if (!stat.isDirectory()) {
    zip.file(zipRelPath.replace(/\\/g, "/"), await fs.readFile(absPath));
    return;
  }

  const entries = await fs.readdir(absPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const childAbs = path.join(absPath, entry.name);
    const childZipRel = `${zipRelPath}/${entry.name}`.replace(/\\/g, "/");
    await addPathToZip(zip, childAbs, childZipRel);
  }
}

export async function createMixedZip(
  entries: Array<{ absPath: string; zipRelPath: string }>
): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of entries) {
    await addPathToZip(zip, entry.absPath, entry.zipRelPath);
  }
  zip.file(
    "stpkg.json",
    JSON.stringify(
      {
        format: "st-resource-manager",
        version: 2,
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
