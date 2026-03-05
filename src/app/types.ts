export type AuthMode = "checking" | "setup" | "login" | "ready";
export type Source = "all" | "instance" | "vault";
export type PanelKey = "resources" | "character" | "preset" | "queue" | "git" | "settings" | "cloud";

export interface AuthStatus {
  enabled: boolean;
  passwordConfigured: boolean;
}

export interface Instance {
  id: string;
  name: string;
  rootPath: string;
  isRunning: boolean;
}

export interface ResourceItem {
  id: string;
  source: "instance" | "vault";
  instanceId?: string;
  relPath: string;
  title: string;
  type: string;
  favorite: boolean;
}

export interface ResourceResp {
  items: ResourceItem[];
  total: number;
  sourceSummary: { instance: number; vault: number };
}

export interface QueueJob {
  id: string;
  type: string;
  status: string;
  reason?: string;
  updatedAt: string;
}

export interface AppSettings {
  trashRetentionDays: number;
  legacyUiEnabled: boolean;
  autoOpenBrowser: boolean;
  autoUpdateRepo: boolean;
}

export interface Dashboard {
  selectedInstanceId: string | null;
  selectedInstance?: {
    id?: string;
    name: string;
    rootPath: string;
    version: string;
    resourceTotal: number;
    isRunning: boolean;
  };
  resourceStats?: Record<string, number>;
  tavernResourceStats?: {
    preset: number;
    character: number;
    chat: number;
    world: number;
    beautify: number;
    background: number;
  };
  queueStats: {
    total: number;
    blocked: number;
    failed: number;
    running?: number;
    pending?: number;
    updatedAt: string;
  };
}

export interface InstanceFileNode {
  name: string;
  relPath: string;
  isDir: boolean;
  size?: number;
  children?: InstanceFileNode[];
}

export interface InstanceTreeResp {
  instanceId: string;
  rootPath: string;
  nodes: InstanceFileNode[];
}

export interface InstanceFileResp {
  source: "instance";
  instanceId: string;
  relPath: string;
  size: number;
  readOnly: boolean;
  truncated: boolean;
  content: string;
  encoding: "utf8";
}

export interface PresetFileItem {
  name: string;
  relPath: string;
  size?: number;
}

export interface CharacterCardItem {
  name: string;
  relPath: string;
  size?: number;
  ext: "png" | "webp" | "json";
}

export interface PresetBasicSettings {
  temperature: string;
  topP: string;
  frequencyPenalty: string;
  presencePenalty: string;
  maxContext: string;
  maxResponseTokens: string;
  streaming: boolean;
}

export interface ResourceStatItem {
  key: string;
  label: string;
  value: number;
}

export interface DirectoryEntry {
  name: string;
  absPath: string;
}

export interface DirectoryBrowseResp {
  rootPath: string;
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
}
