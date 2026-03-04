import path from "node:path";
import type { ResourceType } from "../types.js";

const TYPE_HINTS: Record<ResourceType, string[]> = {
  character: ["character", "characters", "char", "chars"],
  world: ["world", "worlds", "worldbook", "worldbooks", "lorebook", "lorebooks"],
  preset: ["preset", "presets", "instruct", "sysprompt"],
  chat: ["chat", "chats", "history", "histories"],
  extension: ["extension", "extensions", "third-party"],
  prompt: ["prompt", "prompts"],
  theme: ["theme", "themes"],
  config: ["config", "configs", "setting", "settings"],
  plugin: ["plugin", "plugins"],
  asset: ["asset", "assets", "card", "cards", "image", "images", "avatar", "background"],
  other: []
};

const EXT_TYPE_HINTS: Record<string, ResourceType> = {
  ".png": "asset",
  ".jpg": "asset",
  ".jpeg": "asset",
  ".webp": "asset",
  ".gif": "asset",
  ".svg": "asset",
  ".json": "config",
  ".yaml": "config",
  ".yml": "config",
  ".css": "theme",
  ".js": "plugin",
  ".ts": "plugin",
  ".md": "other",
  ".txt": "other"
};

export function inferResourceTypeByPath(relPath: string): ResourceType {
  const lower = relPath.toLowerCase().replace(/\\/g, "/");
  for (const [type, hints] of Object.entries(TYPE_HINTS) as Array<[ResourceType, string[]]>) {
    if (type === "other") {
      continue;
    }
    if (hints.some((hint) => lower.includes(`/${hint}/`) || lower.endsWith(`/${hint}`))) {
      return type;
    }
  }

  const ext = path.extname(lower);
  return EXT_TYPE_HINTS[ext] ?? "other";
}
