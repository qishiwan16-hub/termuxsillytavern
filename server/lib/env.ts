import path from "node:path";
import os from "node:os";
import fs from "fs-extra";

export const DEFAULT_ST_PATH = path.join(os.homedir(), "SillyTavern");
export const APP_DATA_ROOT =
  process.env.ST_MANAGER_HOME ?? path.join(os.homedir(), ".st-resource-manager");

export const APP_PATHS = {
  dataRoot: APP_DATA_ROOT,
  configDir: path.join(APP_DATA_ROOT, "config"),
  stateDir: path.join(APP_DATA_ROOT, "state"),
  backupsDir: path.join(APP_DATA_ROOT, "backups"),
  reposDir: path.join(APP_DATA_ROOT, "repos"),
  vaultDir: path.join(APP_DATA_ROOT, "vault"),
  vaultFilesDir: path.join(APP_DATA_ROOT, "vault", "files"),
  auditDir: path.join(APP_DATA_ROOT, "audit"),
  instancesFile: path.join(APP_DATA_ROOT, "config", "instances.json"),
  queueFile: path.join(APP_DATA_ROOT, "state", "write-queue.json"),
  vaultMetaFile: path.join(APP_DATA_ROOT, "vault", "meta.json"),
  auditLogFile: path.join(APP_DATA_ROOT, "audit", "actions.log")
};

export async function ensureAppDirs(): Promise<void> {
  await fs.ensureDir(APP_PATHS.dataRoot);
  await fs.ensureDir(APP_PATHS.configDir);
  await fs.ensureDir(APP_PATHS.stateDir);
  await fs.ensureDir(APP_PATHS.backupsDir);
  await fs.ensureDir(APP_PATHS.reposDir);
  await fs.ensureDir(APP_PATHS.vaultDir);
  await fs.ensureDir(APP_PATHS.vaultFilesDir);
  await fs.ensureDir(APP_PATHS.auditDir);
}
