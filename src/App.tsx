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

type Tab = "home" | "resources" | "queue" | "git" | "settings";
type AuthMode = "checking" | "setup" | "login" | "ready";
type Source = "all" | "instance" | "vault";

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
  selectedInstance?: { id?: string; name: string; rootPath: string; version: string; resourceTotal: number; isRunning: boolean };
  resourceStats?: Record<string, number>;
  queueStats: { total: number; blocked: number; failed: number; running?: number; pending?: number; updatedAt: string };
}

interface ResourceStatItem {
  key: string;
  label: string;
  value: number;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "home", label: "首页" },
  { key: "resources", label: "资源" },
  { key: "queue", label: "队列" },
  { key: "git", label: "Git" },
  { key: "settings", label: "设置" }
];

const RESOURCE_TYPE_LABELS: Array<{ key: string; label: string }> = [
  { key: "character", label: "角色卡" },
  { key: "world", label: "世界书" },
  { key: "preset", label: "预设" },
  { key: "chat", label: "聊天记录" },
  { key: "prompt", label: "提示词" },
  { key: "plugin", label: "插件" },
  { key: "extension", label: "扩展" },
  { key: "theme", label: "主题美化" },
  { key: "asset", label: "素材资源" },
  { key: "config", label: "配置文件" },
  { key: "other", label: "其他" }
];

function toVaultId(resourceId: string): string {
  return resourceId.replace(/^vault:/, "");
}

function toShortDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function buildPlateCode(seed: string): string {
  const source = seed || "ST0000";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  let out = "";
  for (let index = 0; index < 5; index += 1) {
    out += chars[(hash + index * 17) % chars.length];
  }
  return `京A·${out}`;
}

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ enabled: false, passwordConfigured: false });
  const [setupPassword, setSetupPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [enablePassword, setEnablePassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

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
  const [legacyMode, setLegacyMode] = useState(false);
  const [gitResult, setGitResult] = useState("");
  const [toast, setToast] = useState("");

  const currentInstance = useMemo(() => instances.find((item) => item.id === instanceId), [instances, instanceId]);
  const selectedItems = useMemo(
    () => resources.items.filter((item) => selectedIds.includes(item.id)),
    [resources.items, selectedIds]
  );
  const plateCode = useMemo(() => buildPlateCode(instanceId), [instanceId]);
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
    return (stats.theme ?? 0) + (stats.asset ?? 0);
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
      .map((key) => ({
        key,
        label: key,
        value: stats[key] ?? 0
      }))
      .filter((item) => item.value > 0);
    return [...base, ...extra];
  }, [dashboard]);

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

  async function loadAll(): Promise<void> {
    const instancesResp = await safe(() => apiGet<{ items: Instance[] }>("/api/instances"));
    if (!instancesResp) return;
    setInstances(instancesResp.items);

    const nextId = instancesResp.items.some((item) => item.id === instanceId)
      ? instanceId
      : (instancesResp.items[0]?.id ?? "");
    setInstanceId(nextId);

    const dashboardResp = await safe(
      () => apiGet<Dashboard>(`/api/dashboard/summary${nextId ? `?instanceId=${encodeURIComponent(nextId)}` : ""}`)
    );
    if (dashboardResp) setDashboard(dashboardResp);

    const resourcesResp = await safe(
      () =>
        apiGet<ResourceResp>(
          `/api/resources?source=${source}&instanceId=${encodeURIComponent(nextId)}&q=${encodeURIComponent(query)}&offset=0&limit=50&refreshMode=incremental&includeDirs=false`
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

  function renderHome(): React.ReactNode {
    return (
      <section className="m-home-page">
        <section className="m-home-hero">
          <div className="m-home-hero-top">
            <div className="m-home-avatar" aria-hidden="true">
              ST
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

          <h2 className="m-home-name">{currentInstance?.name ?? "默认实例"}</h2>
          <p className="m-home-sub">{currentInstance?.isRunning ? "运行中的 SillyTavern 实例" : "待机中的 SillyTavern 实例"}</p>
          <p className="m-home-path">{currentInstance?.rootPath ?? "/data/data/com.termux/files/home/SillyTavern"}</p>

          <button type="button" className="m-home-plate" onClick={() => setTab("resources")}>
            {plateCode}
          </button>
        </section>

        <section className="m-home-instance-wrap">
          <select className="m-home-instance-select" value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
            {instances.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
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

        <section className="m-home-summary">
          <div className="m-home-summary-head">
            <h3>资源总览</h3>
            <button type="button" onClick={() => setTab("resources")}>
              进入管理
            </button>
          </div>

          <div className="m-home-kv">
            <p>
              <span>当前版本</span>
              <strong>{dashboard?.selectedInstance?.version ?? "unknown"}</strong>
            </p>
            <p>
              <span>队列任务</span>
              <strong>{dashboard?.queueStats.total ?? 0}</strong>
            </p>
            <p>
              <span>失败任务</span>
              <strong>{dashboard?.queueStats.failed ?? 0}</strong>
            </p>
            <p>
              <span>美化资源</span>
              <strong>{beautifyCount}</strong>
            </p>
          </div>
        </section>

        <section className="m-home-stats">
          <h3>分类数量</h3>
          <div className="m-home-stat-grid">
            {homeStats.map((item) => (
              <article key={item.key} className="m-home-stat-card">
                <p>{item.label}</p>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        </section>

        <article className="m-home-rec">
          <p className="m-home-rec-label">
            <span className="dot" />
            SYNC
          </p>
          <p className="m-home-rec-title">最近同步</p>
          <p className="m-home-rec-time">{toShortDate(dashboard?.queueStats.updatedAt)}</p>
        </article>
      </section>
    );
  }

  function renderResources(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>资源</h2>
        <div className="m-actions-row">
          <select className="m-input" value={source} onChange={(event) => setSource(event.target.value as Source)}>
            <option value="all">全部</option>
            <option value="instance">实例</option>
            <option value="vault">Vault</option>
          </select>
          <input className="m-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词" />
          <button type="button" className="m-btn" onClick={() => void loadAll()}>
            搜索
          </button>
        </div>
        <p className="m-muted">
          总数 {resources.total} · 实例 {resources.sourceSummary.instance} · Vault {resources.sourceSummary.vault}
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

  function renderQueue(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>队列</h2>
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

  function renderGit(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>Git</h2>
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
            拉取实例
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

  function renderSettings(): React.ReactNode {
    return (
      <section className="m-card">
        <h2>设置</h2>
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

  if (legacyMode) {
    return (
      <>
        <div className="m-app">
          <section className="m-card">
            <h2>旧版模式</h2>
            <button type="button" className="m-btn" onClick={() => setLegacyMode(false)}>
              返回
            </button>
          </section>
        </div>
        <Suspense
          fallback={
            <div className="m-app">
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
      <div className="m-auth-wrap">
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
    <div className="m-app">
      {tab !== "home" ? (
        <>
          <header className="m-topbar">
            <div>
              <p className="m-label">ST RESOURCE MANAGER</p>
              <h1>资源中心</h1>
              <p className="m-subline">
                {currentInstance?.name ?? "-"} · {currentInstance?.isRunning ? "运行中" : "未运行"}
              </p>
              <p className="m-subline m-break">{currentInstance?.rootPath ?? "-"}</p>
            </div>
            <button
              type="button"
              className="m-icon-btn"
              onClick={() => {
                void loadAll();
                setToast("已刷新");
              }}
            >
              刷新
            </button>
          </header>

          <section className="m-instance-strip">
            <select className="m-input" value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
              {instances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </section>
        </>
      ) : null}

      <main className="m-main">
        {tab === "home" ? renderHome() : null}
        {tab === "resources" ? renderResources() : null}
        {tab === "queue" ? renderQueue() : null}
        {tab === "git" ? renderGit() : null}
        {tab === "settings" ? renderSettings() : null}
      </main>

      <nav className="m-bottom-nav">
        {TABS.map((item) => (
          <button key={item.key} type="button" className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      {toast ? <div className="m-toast">{toast}</div> : null}
    </div>
  );
}
