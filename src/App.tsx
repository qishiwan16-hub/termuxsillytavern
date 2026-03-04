import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiGet,
  apiPatch,
  apiPost,
  clearAuthToken,
  downloadZip,
  getAuthToken,
  setAuthToken
} from "./lib/api";

const LegacyApp = lazy(() => import("./LegacyApp").then((mod) => ({ default: mod.LegacyApp })));

type AuthMode = "checking" | "setup" | "login" | "ready";
type Source = "all" | "instance" | "vault";
type PanelKey = "resources" | "queue" | "git" | "settings";

interface AuthStatus {
  enabled: boolean;
  passwordConfigured: boolean;
}

interface Instance {
  id: string;
  name: string;
  rootPath: string;
  isRunning: boolean;
}

interface ResourceItem {
  id: string;
  source: "instance" | "vault";
  instanceId?: string;
  relPath: string;
  title: string;
  type: string;
  favorite: boolean;
}

interface ResourceResp {
  items: ResourceItem[];
  total: number;
  sourceSummary: { instance: number; vault: number };
}

interface QueueJob {
  id: string;
  type: string;
  status: string;
  reason?: string;
  updatedAt: string;
}

interface AppSettings {
  trashRetentionDays: number;
  legacyUiEnabled: boolean;
  autoOpenBrowser: boolean;
  autoUpdateRepo: boolean;
}

interface Dashboard {
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

interface ResourceStatItem {
  key: string;
  label: string;
  value: number;
}

const PROFILE_NAME_KEY = "st_manager_profile_name";
const PROFILE_AVATAR_KEY = "st_manager_profile_avatar";
const FONT_SCALE_KEY = "st_manager_font_scale";

const RESOURCE_TYPE_LABELS: Array<{ key: string; label: string }> = [
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

const HIDDEN_HOME_STAT_KEYS = new Set(["asset", "config"]);

function toVaultId(resourceId: string): string {
  return resourceId.replace(/^vault:/, "");
}

function toShortDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function initials(name: string): string {
  const value = name.trim();
  if (!value) return "ST";
  return value.slice(0, 2).toUpperCase();
}

export function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ enabled: false, passwordConfigured: false });
  const [setupPassword, setSetupPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [enablePassword, setEnablePassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [profileName, setProfileName] = useState("管理员");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("管理员");
  const [fontScale, setFontScale] = useState(0.5);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [resources, setResources] = useState<ResourceResp>({
    items: [],
    total: 0,
    sourceSummary: { instance: 0, vault: 0 }
  });
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gitResult, setGitResult] = useState("");
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [legacyMode, setLegacyMode] = useState(false);
  const [toast, setToast] = useState("");

  const currentInstance = useMemo(() => instances.find((item) => item.id === instanceId), [instances, instanceId]);
  const selectedItems = useMemo(
    () => resources.items.filter((item) => selectedIds.includes(item.id)),
    [resources.items, selectedIds]
  );
  const queueHealth = useMemo(() => {
    const total = dashboard?.queueStats.total ?? 0;
    const blocked = dashboard?.queueStats.blocked ?? 0;
    const failed = dashboard?.queueStats.failed ?? 0;
    if (total === 0) return 100;
    const healthy = Math.max(0, total - blocked - failed);
    return Math.round((healthy / total) * 100);
  }, [dashboard]);
  const beautifyCount = useMemo(() => {
    const stats = dashboard?.resourceStats ?? {};
    return stats.theme ?? 0;
  }, [dashboard]);
  const homeStats = useMemo<ResourceStatItem[]>(() => {
    const stats = dashboard?.resourceStats ?? {};
    const base = RESOURCE_TYPE_LABELS.map((item) => ({
      key: item.key,
      label: item.label,
      value: stats[item.key] ?? 0
    }));
    const extra = Object.keys(stats)
      .filter((key) => !RESOURCE_TYPE_LABELS.some((item) => item.key === key))
      .filter((key) => !HIDDEN_HOME_STAT_KEYS.has(key))
      .map((key) => ({
        key,
        label: key,
        value: stats[key] ?? 0
      }))
      .filter((item) => item.value > 0);
    return [...base, ...extra];
  }, [dashboard]);
  const homeStatsNonZero = useMemo(() => homeStats.filter((item) => item.value > 0), [homeStats]);
  const homeStatsTop = useMemo(() => {
    return [...homeStats]
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"))
      .slice(0, 6);
  }, [homeStats]);
  const appStyle = useMemo(
    () =>
      ({
        "--m-font-scale": String(fontScale)
      }) as React.CSSProperties,
    [fontScale]
  );

  useEffect(() => {
    const name = localStorage.getItem(PROFILE_NAME_KEY)?.trim();
    const avatar = localStorage.getItem(PROFILE_AVATAR_KEY) ?? "";
    const savedScale = Number(localStorage.getItem(FONT_SCALE_KEY));
    if (name) {
      setProfileName(name);
      setProfileDraftName(name);
    }
    if (avatar) {
      setProfileAvatar(avatar);
    }
    if (!Number.isNaN(savedScale) && savedScale >= 0.4 && savedScale <= 1.2) {
      setFontScale(savedScale);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthToken();
        setAuthMode("login");
      }
      setToast(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  async function loadAll(options?: { instanceId?: string; source?: Source; query?: string }): Promise<void> {
    const preferredInstanceId = options?.instanceId ?? instanceId;
    const nextSource = options?.source ?? source;
    const nextQuery = options?.query ?? query;
    const instancesResp = await safe(() => apiGet<{ items: Instance[] }>("/api/instances"));
    if (!instancesResp) return;
    setInstances(instancesResp.items);

    const nextId = instancesResp.items.some((item) => item.id === preferredInstanceId)
      ? preferredInstanceId
      : (instancesResp.items[0]?.id ?? "");
    setInstanceId(nextId);

    const dashboardResp = await safe(
      () => apiGet<Dashboard>(`/api/dashboard/summary${nextId ? `?instanceId=${encodeURIComponent(nextId)}` : ""}`)
    );
    if (dashboardResp) setDashboard(dashboardResp);

    const resourcesResp = await safe(
      () =>
        apiGet<ResourceResp>(
          `/api/resources?source=${nextSource}&instanceId=${encodeURIComponent(nextId)}&q=${encodeURIComponent(nextQuery)}&offset=0&limit=50&refreshMode=incremental&includeDirs=false`
        )
    );
    if (resourcesResp) setResources(resourcesResp);

    const queueResp = await safe(() => apiGet<{ items: QueueJob[] }>("/api/queue"));
    if (queueResp) setQueue(queueResp.items);

    const settingsResp = await safe(() => apiGet<AppSettings>("/api/app-settings"));
    if (settingsResp) setSettings(settingsResp);
  }

  useEffect(() => {
    void (async () => {
      const status = await safe(() => apiGet<AuthStatus>("/api/auth/status"));
      if (!status) {
        setAuthMode("login");
        return;
      }
      setAuthStatus(status);
      if (!status.passwordConfigured) {
        setAuthMode("setup");
        return;
      }
      if (status.enabled && !getAuthToken()) {
        setAuthMode("login");
        return;
      }
      setAuthMode("ready");
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile(): Promise<void> {
    const name = profileDraftName.trim() || "管理员";
    setProfileName(name);
    setProfileDraftName(name);
    localStorage.setItem(PROFILE_NAME_KEY, name);
    if (profileAvatar) {
      localStorage.setItem(PROFILE_AVATAR_KEY, profileAvatar);
    } else {
      localStorage.removeItem(PROFILE_AVATAR_KEY);
    }
    setToast("资料已保存");
  }

  async function updateAvatar(file: File | null): Promise<void> {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      setProfileAvatar(value);
    };
    reader.onerror = () => {
      setToast("头像读取失败");
    };
    reader.readAsDataURL(file);
  }

  function updateFontScale(nextScale: number): void {
    const value = Number.isFinite(nextScale) ? Math.min(1.2, Math.max(0.4, nextScale)) : 0.5;
    setFontScale(value);
    localStorage.setItem(FONT_SCALE_KEY, String(value));
  }

  function renderProfileEditor(): React.ReactNode {
    if (!showProfileEditor) return null;
    return (
      <div className="m-modal-mask" onClick={() => setShowProfileEditor(false)}>
        <section className="m-profile-modal" onClick={(event) => event.stopPropagation()}>
          <div className="m-profile-header">
            <h3>个人资料</h3>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setShowProfileEditor(false)}>
              关闭
            </button>
          </div>

          <div className="m-profile-block m-profile-basic">
            <label className="m-profile-avatar-picker">
              {profileAvatar ? <img src={profileAvatar} alt="头像" /> : <span>{initials(profileName)}</span>}
              <input type="file" accept="image/*" onChange={(event) => void updateAvatar(event.target.files?.[0] ?? null)} />
            </label>
            <div className="m-profile-name-editor">
              <input
                className="m-input"
                value={profileDraftName}
                onChange={(event) => setProfileDraftName(event.target.value)}
                placeholder="资源管理器用户名"
              />
              <button type="button" className="m-btn" onClick={() => void saveProfile()}>
                保存资料
              </button>
            </div>
          </div>

          <div className="m-profile-block">
            <p className="m-muted">字体大小</p>
            <div className="m-font-scale-row">
              <input
                className="m-range"
                type="range"
                min={0.4}
                max={1.2}
                step={0.05}
                value={fontScale}
                onChange={(event) => updateFontScale(Number(event.target.value))}
              />
              <strong>{Math.round(fontScale * 100)}%</strong>
            </div>
            <div className="m-actions-row">
              <button type="button" className="m-btn m-btn-ghost" onClick={() => updateFontScale(0.5)}>
                小号（50%）
              </button>
              <button type="button" className="m-btn m-btn-ghost" onClick={() => updateFontScale(0.75)}>
                中号（75%）
              </button>
              <button type="button" className="m-btn m-btn-ghost" onClick={() => updateFontScale(1)}>
                标准（100%）
              </button>
            </div>
          </div>

          <div className="m-profile-block">
            <p className="m-muted">酒馆项目</p>
            <div className="m-profile-project-box">
              <select
                className="m-input"
                value={instanceId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setInstanceId(nextId);
                  void loadAll({ instanceId: nextId });
                }}
              >
                {instances.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <p className="m-muted m-break">
                当前路径：
                {currentInstance?.rootPath ?? "/data/data/com.termux/files/home/SillyTavern"}
              </p>
            </div>
          </div>

          <div className="m-profile-block">
            <p className="m-muted">认证开关</p>
            <div className="m-actions-row">
              <input
                className="m-input"
                type="password"
                value={enablePassword}
                onChange={(event) => setEnablePassword(event.target.value)}
                placeholder="认证开关密码"
              />
              <button
                type="button"
                className="m-btn"
                onClick={() =>
                  void safe(async () => {
                    await apiPost("/api/auth/set-enabled", {
                      enabled: !authStatus.enabled,
                      password: enablePassword || undefined
                    });
                    const status = await apiGet<AuthStatus>("/api/auth/status");
                    setAuthStatus(status);
                    setEnablePassword("");
                  })
                }
              >
                {authStatus.enabled ? "关闭认证" : "启用认证"}
              </button>
            </div>
          </div>

          <div className="m-profile-block">
            <p className="m-muted">修改密码</p>
            <div className="m-actions-row">
              <input
                className="m-input"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="当前密码"
              />
              <input
                className="m-input"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="新密码"
              />
              <button
                type="button"
                className="m-btn"
                onClick={() =>
                  void safe(async () => {
                    await apiPost("/api/auth/change-password", { currentPassword, newPassword });
                    setCurrentPassword("");
                    setNewPassword("");
                    setToast("密码已修改");
                  })
                }
              >
                修改密码
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderHome(): React.ReactNode {
    return (
      <section className="m-home-page">
        <section className="m-home-hero">
          <div className="m-home-hero-top">
            <div className="m-home-user">
              <button type="button" className="m-profile-trigger" onClick={() => setShowProfileEditor(true)} aria-label="打开个人资料">
                {profileAvatar ? <img src={profileAvatar} alt="头像" /> : <span>{initials(profileName)}</span>}
              </button>
              <div className="m-home-user-text">
                <p className="m-home-owner">{profileName}</p>
                <h2 className="m-home-name">{currentInstance?.name ?? "默认项目"}</h2>
                <p className="m-home-sub">{currentInstance?.isRunning ? "当前酒馆项目（运行中）" : "当前酒馆项目（未运行）"}</p>
              </div>
            </div>
            <button
              type="button"
              className="m-home-close"
              onClick={() => {
                void loadAll();
                setToast("已刷新");
              }}
              aria-label="刷新"
            >
              刷新
            </button>
          </div>
        </section>

        <section className="m-home-metrics">
          <div className="m-home-metric">
            <p className="m-home-metric-label">队列健康度</p>
            <p className="m-home-metric-value">
              {queueHealth}
              <span>%</span>
            </p>
          </div>

          <div className="m-home-metric-divider" />

          <div className="m-home-metric">
            <p className="m-home-metric-label">资源总数</p>
            <p className="m-home-metric-value">{(dashboard?.selectedInstance?.resourceTotal ?? 0).toLocaleString("zh-CN")}</p>
          </div>
        </section>

        <article className="m-home-rec">
          <p className="m-home-rec-label">
            <span className="dot" />
            REC
          </p>
          <p className="m-home-rec-title">系统记录</p>
          <div className="m-home-rec-grid">
            <button type="button" onClick={() => setActivePanel("git")}>
              <span>最近同步</span>
              <strong>{toShortDate(dashboard?.queueStats.updatedAt)}</strong>
            </button>
            <button type="button" onClick={() => setActivePanel("settings")}>
              <span>项目版本</span>
              <strong>{dashboard?.selectedInstance?.version ?? "unknown"}</strong>
            </button>
            <button type="button" onClick={() => setActivePanel("git")}>
              <span>队列任务</span>
              <strong>{dashboard?.queueStats.total ?? 0}</strong>
            </button>
            <button type="button" onClick={() => setActivePanel("queue")}>
              <span>失败任务</span>
              <strong>{dashboard?.queueStats.failed ?? 0}</strong>
            </button>
          </div>
        </article>

        <section className="m-home-cockpit">
          <button type="button" className="m-home-cockpit-card" onClick={() => setActivePanel("resources")}>
            <div className="m-home-cockpit-head">
              <p className="m-home-cockpit-eyebrow">资源管理</p>
              <span>进入</span>
            </div>
            <h3>资源中心</h3>
            <p className="m-home-cockpit-main">
              {homeStatsNonZero.length > 0 ? `${homeStatsNonZero.length} 个分类有内容` : "当前暂无资源"}
            </p>
            <p className="m-home-cockpit-sub">
              角色卡 {(dashboard?.resourceStats?.character ?? 0).toLocaleString("zh-CN")} · 世界书{" "}
              {(dashboard?.resourceStats?.world ?? 0).toLocaleString("zh-CN")}
            </p>
            <p className="m-home-cockpit-sub">预设 {(dashboard?.resourceStats?.preset ?? 0).toLocaleString("zh-CN")} · 聊天记录 {(dashboard?.resourceStats?.chat ?? 0).toLocaleString("zh-CN")}</p>
            <p className="m-home-cockpit-sub">主题美化 {beautifyCount.toLocaleString("zh-CN")} · 全局扩展 {(dashboard?.resourceStats?.prompt ?? 0).toLocaleString("zh-CN")}</p>
          </button>

          <button type="button" className="m-home-cockpit-card" onClick={() => setActivePanel("resources")}>
            <div className="m-home-cockpit-head">
              <p className="m-home-cockpit-eyebrow">分类数量</p>
              <span>查看</span>
            </div>
            <h3>资源分类</h3>
            {homeStatsTop.length > 0 ? (
              <ul className="m-home-cockpit-list">
                {homeStatsTop.map((item) => (
                  <li key={item.key}>
                    <span>{item.label}</span>
                    <strong>{item.value.toLocaleString("zh-CN")}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-home-cockpit-empty">暂无记录</p>
            )}
          </button>
        </section>
      </section>
    );
  }

  function renderResourcesPanel(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>资源管理</h2>
        <div className="m-actions-row">
          <select className="m-input" value={source} onChange={(event) => setSource(event.target.value as Source)}>
            <option value="all">全部</option>
            <option value="instance">酒馆项目</option>
            <option value="vault">Vault</option>
          </select>
          <input className="m-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词" />
          <button type="button" className="m-btn" onClick={() => void loadAll({ source, query, instanceId })}>
            搜索
          </button>
        </div>
        <p className="m-muted">
          总数 {resources.total} · 酒馆项目 {resources.sourceSummary.instance} · Vault {resources.sourceSummary.vault}
        </p>

        <div className="m-actions-row">
          <button type="button" className="m-btn m-btn-ghost" onClick={() => setSelectedIds(resources.items.map((item) => item.id))}>
            选择本页
          </button>
          <button
            type="button"
            className="m-btn"
            onClick={() =>
              void safe(async () => {
                if (!instanceId || selectedItems.length === 0) return;
                await apiPost("/api/resources/batch/apply", {
                  instanceId,
                  targetRelDir: "data/default-user/characters",
                  mode: "copy_once",
                  items: selectedItems.map((item) =>
                    item.source === "vault"
                      ? { source: "vault", id: toVaultId(item.id) }
                      : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }
                  )
                });
                setToast("批量取用完成");
                await loadAll();
              })
            }
          >
            批量取用
          </button>
          <button
            type="button"
            className="m-btn m-btn-ghost"
            onClick={() =>
              void safe(async () => {
                if (selectedItems.length === 0) return;
                await downloadZip(
                  "/api/resources/batch/export/zip",
                  {
                    items: selectedItems.map((item) =>
                      item.source === "vault"
                        ? { source: "vault", id: toVaultId(item.id) }
                        : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }
                    )
                  },
                  `resources-${Date.now()}.zip`
                );
              })
            }
          >
            导出 ZIP
          </button>
          <button
            type="button"
            className="m-btn m-btn-danger"
            onClick={() =>
              void safe(async () => {
                if (selectedItems.length === 0) return;
                await apiPost("/api/resources/batch/delete", {
                  items: selectedItems.map((item) =>
                    item.source === "vault"
                      ? { source: "vault", id: toVaultId(item.id) }
                      : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }
                  )
                });
                setToast("已移入回收站");
                await loadAll();
              })
            }
          >
            删除
          </button>
        </div>

        <ul className="m-list-clean">
          {resources.items.map((item) => (
            <li key={item.id} className="m-resource-card">
              <p className="m-muted">{item.title}</p>
              <p className="m-muted m-break">{item.relPath}</p>
              <div className="m-actions-row">
                <label className="m-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() =>
                      setSelectedIds((prev) =>
                        prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                      )
                    }
                  />
                  选择
                </label>
                {item.source === "vault" ? (
                  <button
                    type="button"
                    className="m-btn m-btn-ghost"
                    onClick={() =>
                      void safe(async () => {
                        await apiPatch(`/api/vault/items/${toVaultId(item.id)}/meta`, { favorite: !item.favorite });
                        await loadAll();
                      })
                    }
                  >
                    {item.favorite ? "取消收藏" : "收藏"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  function renderQueuePanel(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>写入队列</h2>
        <ul className="m-list-clean">
          {queue.map((job) => (
            <li key={job.id} className="m-resource-card">
              <p className="m-muted">
                {job.type} · {job.status} · {job.reason ?? "-"}
              </p>
              <p className="m-muted">{toShortDate(job.updatedAt)}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  function renderGitPanel(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>Git 同步</h2>
        <div className="m-actions-row">
          <button
            type="button"
            className="m-btn"
            onClick={() =>
              void safe(async () => {
                if (!instanceId) return;
                const result = await apiPost(`/api/instances/${instanceId}/git/pull`, {});
                setGitResult(JSON.stringify(result, null, 2));
                await loadAll();
              })
            }
          >
            拉取项目
          </button>
          <button
            type="button"
            className="m-btn m-btn-ghost"
            onClick={() =>
              void safe(async () => {
                const result = await apiPost("/api/vault/git/pull", {});
                setGitResult(JSON.stringify(result, null, 2));
                await loadAll();
              })
            }
          >
            拉取 Vault
          </button>
        </div>
        <pre className="m-muted m-pre">{gitResult || "暂无输出"}</pre>
      </section>
    );
  }

  function renderSettingsPanel(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>系统设置</h2>
        <div className="m-actions-row">
          <label className="m-check">
            <input
              type="checkbox"
              checked={settings?.autoOpenBrowser ?? false}
              onChange={(event) =>
                void safe(async () =>
                  setSettings(await apiPatch("/api/app-settings", { autoOpenBrowser: event.target.checked }))
                )
              }
            />
            自动打开浏览器
          </label>
          <label className="m-check">
            <input
              type="checkbox"
              checked={settings?.autoUpdateRepo ?? true}
              onChange={(event) =>
                void safe(async () =>
                  setSettings(await apiPatch("/api/app-settings", { autoUpdateRepo: event.target.checked }))
                )
              }
            />
            自动更新仓库
          </label>
          <label className="m-check">
            <input
              type="checkbox"
              checked={settings?.legacyUiEnabled ?? true}
              onChange={(event) =>
                void safe(async () =>
                  setSettings(await apiPatch("/api/app-settings", { legacyUiEnabled: event.target.checked }))
                )
              }
            />
            显示旧版入口
          </label>
        </div>

        <button type="button" className="m-btn m-btn-ghost" onClick={() => setLegacyMode(true)}>
          打开旧版界面
        </button>
      </section>
    );
  }

  function renderPanel(): React.ReactNode {
    if (!activePanel) return null;

    const title =
      activePanel === "resources"
        ? "资源管理"
        : activePanel === "queue"
          ? "写入队列"
          : activePanel === "git"
            ? "Git 同步"
            : "系统设置";

    return (
      <section className="m-panel-page">
        <header className="m-panel-top">
          <button type="button" className="m-btn m-btn-ghost" onClick={() => setActivePanel(null)}>
            返回首页
          </button>
          <h2>{title}</h2>
          <button
            type="button"
            className="m-btn"
            onClick={() => {
              void loadAll();
              setToast("已刷新");
            }}
          >
            刷新
          </button>
        </header>

        <div className="m-panel-content">
          {activePanel === "resources" ? renderResourcesPanel() : null}
          {activePanel === "queue" ? renderQueuePanel() : null}
          {activePanel === "git" ? renderGitPanel() : null}
          {activePanel === "settings" ? renderSettingsPanel() : null}
        </div>
      </section>
    );
  }

  if (legacyMode) {
    return (
      <>
        <div className="m-app" style={appStyle}>
          <section className="m-card">
            <h2>旧版模式</h2>
            <button type="button" className="m-btn" onClick={() => setLegacyMode(false)}>
              返回
            </button>
          </section>
        </div>
        <Suspense
          fallback={
            <div className="m-app" style={appStyle}>
              <section className="m-card">正在加载旧版界面...</section>
            </div>
          }
        >
          <LegacyApp />
        </Suspense>
      </>
    );
  }

  if (authMode !== "ready") {
    return (
      <div className="m-auth-wrap" style={appStyle}>
        <section className="m-auth-card">
          <h2>ST 资源管理器</h2>
          {authMode === "checking" ? <p className="m-muted">初始化中...</p> : null}
          {authMode === "setup" ? (
            <>
              <input
                className="m-input"
                type="password"
                value={setupPassword}
                onChange={(event) => setSetupPassword(event.target.value)}
                placeholder="设置密码"
              />
              <button
                type="button"
                className="m-btn"
                onClick={() =>
                  void safe(async () => {
                    const result = await apiPost<{ token: string }>("/api/auth/setup", { password: setupPassword });
                    if (result.token) setAuthToken(result.token);
                    setAuthMode("ready");
                    await loadAll();
                  })
                }
              >
                完成设置
              </button>
            </>
          ) : null}
          {authMode === "login" ? (
            <>
              <input
                className="m-input"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="输入密码"
              />
              <button
                type="button"
                className="m-btn"
                onClick={() =>
                  void safe(async () => {
                    const result = await apiPost<{ token: string | null }>("/api/auth/login", {
                      password: loginPassword
                    });
                    if (result.token) setAuthToken(result.token);
                    setAuthMode("ready");
                    await loadAll();
                  })
                }
              >
                登录
              </button>
            </>
          ) : null}
          <p className="m-muted">{toast}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="m-app" style={appStyle}>
      {renderHome()}
      {renderPanel()}
      {renderProfileEditor()}
      {toast ? <div className="m-toast">{toast}</div> : null}
    </div>
  );
}
