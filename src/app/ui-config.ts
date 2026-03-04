export const PROFILE_NAME_KEY = "st_manager_profile_name";
export const PROFILE_AVATAR_KEY = "st_manager_profile_avatar";
export const FONT_SCALE_KEY = "st_manager_font_scale";
export const PROJECT_PATH_FAVORITES_KEY = "st_manager_project_path_favorites";

export const RESOURCE_TYPE_LABELS: Array<{ key: string; label: string }> = [
  { key: "character", label: "角色卡" },
  { key: "world", label: "世界书" },
  { key: "preset", label: "预设" },
  { key: "chat", label: "聊天记录" },
  { key: "prompt", label: "全局扩展" },
  { key: "plugin", label: "插件" },
  { key: "extension", label: "扩展" },
  { key: "theme", label: "主题美化" },
  { key: "other", label: "其他" }
];

export const HIDDEN_HOME_STAT_KEYS = new Set(["asset", "config"]);

export function toVaultId(resourceId: string): string {
  return resourceId.replace(/^vault:/, "");
}

export function toShortDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function initials(name: string): string {
  const value = name.trim();
  if (!value) return "ST";
  return value.slice(0, 2).toUpperCase();
}
