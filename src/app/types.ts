export type AuthMode = "checking" | "setup" | "login" | "ready";
export type Source = "all" | "instance" | "vault";
export type PanelKey = "resources" | "queue" | "git" | "settings" | "cloud";

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
  queueStats: {
    total: number;
    blocked: number;
    failed: number;
    running?: number;
    pending?: number;
    updatedAt: string;
  };
}

export interface ResourceStatItem {
  key: string;
  label: string;
  value: number;
}
