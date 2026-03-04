import path from "node:path";
import fs from "fs-extra";
import { APP_PATHS } from "./env.js";
import type { AppSettings } from "../types.js";

interface OneClickConfig {
  AUTO_OPEN: "0" | "1";
  AUTO_UPDATE: "0" | "1";
}

const DEFAULT_SETTINGS: AppSettings = {
  trashRetentionDays: 30,
  legacyUiEnabled: true,
  autoOpenBrowser: false,
  autoUpdateRepo: true
};

function clampRetentionDays(days: number): number {
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return 90;
}

function parseBooleanLike(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "1" || value.toLowerCase() === "true") return true;
    if (value === "0" || value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function parseOneClick(content: string): OneClickConfig {
  const initial: OneClickConfig = {
    AUTO_OPEN: "0",
    AUTO_UPDATE: "1"
  };
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [rawKey, rawValue] = trimmed.split("=");
    if (!rawKey || !rawValue) continue;
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key === "AUTO_OPEN") {
      initial.AUTO_OPEN = value === "1" ? "1" : "0";
    }
    if (key === "AUTO_UPDATE") {
      initial.AUTO_UPDATE = value === "0" ? "0" : "1";
    }
  }
  return initial;
}

function stringifyOneClick(config: OneClickConfig): string {
  return `AUTO_OPEN=${config.AUTO_OPEN}\nAUTO_UPDATE=${config.AUTO_UPDATE}\n`;
}

export class AppSettingsService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  private oneClickPath(): string {
    return path.join(process.cwd(), ".runtime", "oneclick.conf");
  }

  async init(): Promise<void> {
    await fs.ensureFile(APP_PATHS.appSettingsFile);
    const current = await fs.readFile(APP_PATHS.appSettingsFile, "utf8").catch(() => "");
    if (!current.trim()) {
      this.settings = { ...DEFAULT_SETTINGS };
      await this.persist();
    } else {
      const parsed = (await fs.readJson(APP_PATHS.appSettingsFile)) as Partial<AppSettings>;
      this.settings = {
        trashRetentionDays: clampRetentionDays(Number(parsed.trashRetentionDays ?? DEFAULT_SETTINGS.trashRetentionDays)),
        legacyUiEnabled: parseBooleanLike(parsed.legacyUiEnabled, DEFAULT_SETTINGS.legacyUiEnabled),
        autoOpenBrowser: parseBooleanLike(parsed.autoOpenBrowser, DEFAULT_SETTINGS.autoOpenBrowser),
        autoUpdateRepo: parseBooleanLike(parsed.autoUpdateRepo, DEFAULT_SETTINGS.autoUpdateRepo)
      };
    }
    await this.syncFromOneClickFile();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.appSettingsFile, this.settings, { spaces: 2 });
  }

  private async syncFromOneClickFile(): Promise<void> {
    const confPath = this.oneClickPath();
    if (!(await fs.pathExists(confPath))) {
      return;
    }
    const content = await fs.readFile(confPath, "utf8").catch(() => "");
    const parsed = parseOneClick(content);
    this.settings.autoOpenBrowser = parsed.AUTO_OPEN === "1";
    this.settings.autoUpdateRepo = parsed.AUTO_UPDATE === "1";
  }

  private async syncToOneClickFile(): Promise<void> {
    const confPath = this.oneClickPath();
    await fs.ensureDir(path.dirname(confPath));
    const content = stringifyOneClick({
      AUTO_OPEN: this.settings.autoOpenBrowser ? "1" : "0",
      AUTO_UPDATE: this.settings.autoUpdateRepo ? "1" : "0"
    });
    await fs.writeFile(confPath, content, "utf8");
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  async patch(input: Partial<AppSettings>): Promise<AppSettings> {
    if (input.trashRetentionDays !== undefined) {
      this.settings.trashRetentionDays = clampRetentionDays(Number(input.trashRetentionDays));
    }
    if (input.legacyUiEnabled !== undefined) {
      this.settings.legacyUiEnabled = Boolean(input.legacyUiEnabled);
    }
    if (input.autoOpenBrowser !== undefined) {
      this.settings.autoOpenBrowser = Boolean(input.autoOpenBrowser);
    }
    if (input.autoUpdateRepo !== undefined) {
      this.settings.autoUpdateRepo = Boolean(input.autoUpdateRepo);
    }
    await this.persist();
    await this.syncToOneClickFile();
    return this.get();
  }
}
