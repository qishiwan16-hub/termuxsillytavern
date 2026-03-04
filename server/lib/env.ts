import path from "node:path";
import os from "node:os";
import fs from "fs-extra";

export const DEFAULT_ST_PATH = path.join(os.homedir(), "SillyTavern");
const DEFAULT_APP_DATA_ROOT = path.join(os.homedir(), ".st-resource-manager");
const FALLBACK_APP_DATA_ROOT = path.join(process.cwd(), ".st-resource-manager");

export let APP_DATA_ROOT = process.env.ST_MANAGER_HOME ?? DEFAULT_APP_DATA_ROOT;

function buildPaths(rootPath: string) {
  return {
    dataRoot: rootPath,
    configDir: path.join(rootPath, "config"),
    stateDir: path.join(rootPath, "state"),
    backupsDir: path.join(rootPath, "backups"),
    reposDir: path.join(rootPath, "repos"),
    vaultDir: path.join(rootPath, "vault"),
    vaultFilesDir: path.join(rootPath, "vault", "files"),
    trashDir: path.join(rootPath, "trash"),
    auditDir: path.join(rootPath, "audit"),
    instancesFile: path.join(rootPath, "config", "instances.json"),
    securityFile: path.join(rootPath, "config", "security.json"),
    appSettingsFile: path.join(rootPath, "config", "app-settings.json"),
    queueFile: path.join(rootPath, "state", "write-queue.json"),
    scanCacheFile: path.join(rootPath, "state", "scan-cache.json"),
    trashIndexFile: path.join(rootPath, "state", "trash-index.json"),
    vaultMetaFile: path.join(rootPath, "vault", "meta.json"),
    auditLogFile: path.join(rootPath, "audit", "actions.log")
  };
}

export let APP_PATHS = buildPaths(APP_DATA_ROOT);

function setDataRoot(rootPath: string): void {
  APP_DATA_ROOT = rootPath;
  APP_PATHS = buildPaths(rootPath);
}

export async function ensureAppDirs(): Promise<void> {
  const ensureAll = async () => {
    await fs.ensureDir(APP_PATHS.dataRoot);
    await fs.ensureDir(APP_PATHS.configDir);
    await fs.ensureDir(APP_PATHS.stateDir);
    await fs.ensureDir(APP_PATHS.backupsDir);
    await fs.ensureDir(APP_PATHS.reposDir);
    await fs.ensureDir(APP_PATHS.vaultDir);
    await fs.ensureDir(APP_PATHS.vaultFilesDir);
    await fs.ensureDir(APP_PATHS.trashDir);
    await fs.ensureDir(APP_PATHS.auditDir);
  };

  try {
    await ensureAll();
  } catch (error) {
    if (process.env.ST_MANAGER_HOME) {
      throw error;
    }
    setDataRoot(FALLBACK_APP_DATA_ROOT);
    await ensureAll();
  }
}
