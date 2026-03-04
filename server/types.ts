export type LibraryKind = "instance" | "vault";

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
