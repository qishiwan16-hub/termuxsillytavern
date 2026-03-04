import path from "node:path";
import fs from "fs-extra";
import type { FileNode, ResourceScanItem } from "../types.js";
import { inferResourceTypeByPath } from "./resource-type.js";

interface BuildTreeOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export async function buildFileTree(
  rootPath: string,
  baseRelPath = "",
  options: BuildTreeOptions = {}
): Promise<FileNode[]> {
  const maxDepth = options.maxDepth ?? 6;
  const maxNodes = options.maxNodes ?? 5000;
  let visited = 0;

  async function walk(currentAbs: string, relPath: string, depth: number): Promise<FileNode[]> {
    if (depth > maxDepth || visited > maxNodes) {
      return [];
    }
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });
    const children: FileNode[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".git")) {
        continue;
      }
      if (entry.name === "node_modules") {
        continue;
      }

      visited += 1;
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const childAbs = path.join(currentAbs, entry.name);
      const itemType = inferResourceTypeByPath(childRel);

      if (entry.isDirectory()) {
        const subChildren = await walk(childAbs, childRel, depth + 1);
        children.push({
          name: entry.name,
          relPath: childRel,
          isDir: true,
          type: itemType,
          children: subChildren
        });
      } else {
        const stat = await fs.stat(childAbs);
        children.push({
          name: entry.name,
          relPath: childRel,
          isDir: false,
          size: stat.size,
          type: itemType
        });
      }
    }

    children.sort((a, b) => {
      if (a.isDir && !b.isDir) {
        return -1;
      }
      if (!a.isDir && b.isDir) {
        return 1;
      }
      return a.name.localeCompare(b.name, "zh-CN");
    });

    return children;
  }

  const startAbs = baseRelPath ? path.join(rootPath, baseRelPath) : rootPath;
  return walk(startAbs, baseRelPath, 0);
}

export async function scanResources(rootPath: string): Promise<ResourceScanItem[]> {
  const result: ResourceScanItem[] = [];

  async function walk(currentAbs: string, relPath: string): Promise<void> {
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".git")) {
        continue;
      }
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const childAbs = path.join(currentAbs, entry.name);
      result.push({
        relPath: childRel,
        isDir: entry.isDirectory(),
        type: inferResourceTypeByPath(childRel)
      });
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      }
    }
  }

  await walk(rootPath, "");
  return result;
}
