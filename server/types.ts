export type LibraryKind = "instance" | "vault";
export type ResourceSource = "instance" | "vault";

export type ResourceType =
  | "character"
  | "world"
  | "preset"
  | "chat"
  | "extension"
  | "prompt"
  | "theme"
  | "config"
  | "plugin"
  | "asset"
  | "other";

export interface Instance {
  id: string;
  name: string;
  rootPath: string;
  layoutType: "modern" | "legacy" | "custom";
  isRunning: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VaultItem {
  id: string;
  relPath: string;
  type: ResourceType;
  tags: string[];
  title: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueJob {
  id: string;
  type: "write" | "import" | "plugin-install";
  status: "pending" | "blocked" | "running" | "done" | "failed" | "cancelled";
  reason?: "st-running" | "conflict" | "validation-error";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface FileNode {
  name: string;
  relPath: string;
  isDir: boolean;
  size?: number;
  type: ResourceType;
  children?: FileNode[];
}

export interface ResourceScanItem {
  relPath: string;
  type: ResourceType;
  isDir: boolean;
}

export type PreviewKind = "text" | "json" | "image" | "none";

export interface ResourceItem {
  id: string;
  source: ResourceSource;
  instanceId?: string;
  relPath: string;
  title: string;
  type: ResourceType;
  tags: string[];
  favorite: boolean;
  isDir: boolean;
  size?: number;
  updatedAt?: string;
  previewKind: PreviewKind;
  editable: boolean;
}

export interface DashboardInstanceSummary {
  id: string;
  name: string;
  rootPath: string;
  isRunning: boolean;
  version: string;
  resourceTotal: number;
}

export interface DashboardSummary {
  selectedInstanceId: string | null;
  selectedInstance?: DashboardInstanceSummary;
  instances: DashboardInstanceSummary[];
  resourceStats: Record<ResourceType, number>;
  queueStats: {
    total: number;
    blocked: number;
    failed: number;
    running: number;
    pending: number;
    updatedAt: string;
  };
  quickActions: Array<{
    id: string;
    title: string;
    action: "import-zip" | "batch-apply" | "open-trash" | "restore-backup";
  }>;
}

export interface TrashItem {
  id: string;
  source: ResourceSource;
  instanceId?: string;
  originalRelPath: string;
  trashedRelPath: string;
  isDir: boolean;
  size?: number;
  deletedAt: string;
  expireAt: string;
  vaultSnapshot?: VaultItem;
}

export interface AppSettings {
  trashRetentionDays: number;
  legacyUiEnabled: boolean;
  autoOpenBrowser: boolean;
  autoUpdateRepo: boolean;
}
