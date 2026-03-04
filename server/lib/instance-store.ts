import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { APP_PATHS, DEFAULT_ST_PATH } from "./env.js";
import type { Instance } from "../types.js";
import { isInstanceLikelyRunning } from "./runtime.js";

interface InstanceFileData {
  instances: Instance[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function detectLayoutType(rootPath: string): Instance["layoutType"] {
  const modernPath = path.join(rootPath, "data", "default-user");
  const legacyPath = path.join(rootPath, "public");
  if (fs.existsSync(modernPath)) {
    return "modern";
  }
  if (fs.existsSync(legacyPath)) {
    return "legacy";
  }
  return "custom";
}

export class InstanceStore {
  private instances: Instance[] = [];

  async init(): Promise<void> {
    await fs.ensureFile(APP_PATHS.instancesFile);
    const exists = await fs.readFile(APP_PATHS.instancesFile, "utf8").catch(() => "");
    if (!exists.trim()) {
      this.instances = [
        {
          id: "default",
          name: "默认实例",
          rootPath: DEFAULT_ST_PATH,
          layoutType: detectLayoutType(DEFAULT_ST_PATH),
          isRunning: false,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ];
      await this.persist();
      return;
    }

    const data = (await fs.readJson(APP_PATHS.instancesFile)) as InstanceFileData;
    this.instances = data.instances ?? [];
    if (this.instances.length === 0) {
      this.instances.push({
        id: "default",
        name: "默认实例",
        rootPath: DEFAULT_ST_PATH,
        layoutType: detectLayoutType(DEFAULT_ST_PATH),
        isRunning: false,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      await this.persist();
    }
  }

  async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.instancesFile, { instances: this.instances }, { spaces: 2 });
  }

  async refreshRunningState(): Promise<void> {
    for (const instance of this.instances) {
      instance.isRunning = await isInstanceLikelyRunning(instance.rootPath);
    }
    await this.persist();
  }

  list(): Instance[] {
    return this.instances;
  }

  get(instanceId: string): Instance {
    const instance = this.instances.find((item) => item.id === instanceId);
    if (!instance) {
      throw new Error("实例不存在");
    }
    return instance;
  }

  async add(name: string, rootPath: string): Promise<Instance> {
    const absolutePath = path.resolve(rootPath);
    const newItem: Instance = {
      id: crypto.randomUUID(),
      name,
      rootPath: absolutePath,
      layoutType: detectLayoutType(absolutePath),
      isRunning: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.instances.push(newItem);
    await this.persist();
    return newItem;
  }

  async update(
    id: string,
    patch: Partial<Pick<Instance, "name" | "rootPath" | "layoutType">>
  ): Promise<Instance> {
    const instance = this.get(id);
    if (patch.name) {
      instance.name = patch.name;
    }
    if (patch.rootPath) {
      instance.rootPath = path.resolve(patch.rootPath);
      instance.layoutType = detectLayoutType(instance.rootPath);
    } else if (patch.layoutType) {
      instance.layoutType = patch.layoutType;
    }
    instance.updatedAt = nowIso();
    await this.persist();
    return instance;
  }
}
