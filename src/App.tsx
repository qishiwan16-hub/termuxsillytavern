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
  selectedInstance?: { name: string; rootPath: string; version: string; resourceTotal: number; isRunning: boolean };
  queueStats: { total: number; blocked: number; failed: number; updatedAt: string };
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "home", label: "Home" },
  { key: "resources", label: "Resources" },
  { key: "queue", label: "Queue" },
  { key: "git", label: "Git" },
  { key: "settings", label: "Settings" }
];

function toVaultId(resourceId: string): string {
  return resourceId.replace(/^vault:/, "");
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
  const [resources, setResources] = useState<ResourceResp>({ items: [], total: 0, sourceSummary: { instance: 0, vault: 0 } });
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [legacyMode, setLegacyMode] = useState(false);
  const [gitResult, setGitResult] = useState("");
  const [toast, setToast] = useState("Ready");

  const currentInstance = useMemo(() => instances.find((item) => item.id === instanceId), [instances, instanceId]);
  const selectedItems = useMemo(() => resources.items.filter((item) => selectedIds.includes(item.id)), [resources.items, selectedIds]);

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
    const nextId = instancesResp.items.some((item) => item.id === instanceId) ? instanceId : (instancesResp.items[0]?.id ?? "");
    setInstanceId(nextId);

    const dashboardResp = await safe(() => apiGet<Dashboard>(`/api/dashboard/summary${nextId ? `?instanceId=${encodeURIComponent(nextId)}` : ""}`));
    if (dashboardResp) setDashboard(dashboardResp);

    const resourcesResp = await safe(() => apiGet<ResourceResp>(`/api/resources?source=${source}&instanceId=${encodeURIComponent(nextId)}&q=${encodeURIComponent(query)}&offset=0&limit=50&refreshMode=incremental&includeDirs=false`));
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

  if (legacyMode) {
    return (
      <>
        <div className="m-app">
          <section className="m-card">
            <h2>Legacy Mode</h2>
            <button type="button" className="m-btn" onClick={() => setLegacyMode(false)}>Back</button>
          </section>
        </div>
        <Suspense fallback={<div className="m-app"><section className="m-card">Loading legacy UI...</section></div>}>
          <LegacyApp />
        </Suspense>
      </>
    );
  }

  if (authMode !== "ready") {
    return (
      <div className="m-auth-wrap">
        <section className="m-auth-card">
          <h2>ST Resource Manager</h2>
          {authMode === "checking" ? <p className="m-muted">Initializing...</p> : null}
          {authMode === "setup" ? (
            <>
              <input className="m-input" type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="Set password" />
              <button type="button" className="m-btn" onClick={() => void safe(async () => {
                const result = await apiPost<{ token: string }>("/api/auth/setup", { password: setupPassword });
                if (result.token) setAuthToken(result.token);
                setAuthMode("ready");
                await loadAll();
              })}>Setup</button>
            </>
          ) : null}
          {authMode === "login" ? (
            <>
              <input className="m-input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Password" />
              <button type="button" className="m-btn" onClick={() => void safe(async () => {
                const result = await apiPost<{ token: string | null }>("/api/auth/login", { password: loginPassword });
                if (result.token) setAuthToken(result.token);
                setAuthMode("ready");
                await loadAll();
              })}>Login</button>
            </>
          ) : null}
          <p className="m-muted">{toast}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="m-app">
      <header className="m-topbar">
        <div>
          <p className="m-label">ST RESOURCE MANAGER</p>
          <h1>Resource Center</h1>
          <p className="m-subline">{currentInstance?.name ?? "-"} · {currentInstance?.isRunning ? "Running" : "Stopped"}</p>
          <p className="m-subline">{currentInstance?.rootPath ?? "-"}</p>
        </div>
        <button type="button" className="m-icon-btn" onClick={() => void loadAll()}>Refresh</button>
      </header>

      <section className="m-instance-strip">
        <select className="m-input" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </section>

      <main className="m-main">
        {tab === "home" ? <section className="m-card"><h2>Dashboard</h2><p className="m-muted">Version: {dashboard?.selectedInstance?.version ?? "unknown"}</p><p className="m-muted">Resources: {dashboard?.selectedInstance?.resourceTotal ?? 0}</p><p className="m-muted">Queue: {dashboard?.queueStats.total ?? 0} (blocked {dashboard?.queueStats.blocked ?? 0}, failed {dashboard?.queueStats.failed ?? 0})</p></section> : null}

        {tab === "resources" ? <section className="m-card"><h2>Resources</h2><div className="m-actions-row"><select className="m-input" value={source} onChange={(e) => setSource(e.target.value as Source)}><option value="all">all</option><option value="instance">instance</option><option value="vault">vault</option></select><input className="m-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="keyword" /><button type="button" className="m-btn" onClick={() => void loadAll()}>Search</button></div><p className="m-muted">Total: {resources.total} · Instance: {resources.sourceSummary.instance} · Vault: {resources.sourceSummary.vault}</p><div className="m-actions-row"><button type="button" className="m-btn m-btn-ghost" onClick={() => setSelectedIds(resources.items.map((item) => item.id))}>Select Page</button><button type="button" className="m-btn" onClick={() => void safe(async () => { if (!instanceId || selectedItems.length === 0) return; await apiPost("/api/resources/batch/apply", { instanceId, targetRelDir: "data/default-user/characters", mode: "copy_once", items: selectedItems.map((item) => item.source === "vault" ? { source: "vault", id: toVaultId(item.id) } : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }) }); setToast("Batch apply done"); await loadAll(); })}>Batch Apply</button><button type="button" className="m-btn m-btn-ghost" onClick={() => void safe(async () => { if (selectedItems.length === 0) return; await downloadZip("/api/resources/batch/export/zip", { items: selectedItems.map((item) => item.source === "vault" ? { source: "vault", id: toVaultId(item.id) } : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }) }, `resources-${Date.now()}.zip`); })}>Export ZIP</button><button type="button" className="m-btn m-btn-danger" onClick={() => void safe(async () => { if (selectedItems.length === 0) return; await apiPost("/api/resources/batch/delete", { items: selectedItems.map((item) => item.source === "vault" ? { source: "vault", id: toVaultId(item.id) } : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }) }); setToast("Moved to trash"); await loadAll(); })}>Delete</button></div><ul className="m-list-clean">{resources.items.map((item) => <li key={item.id} className="m-resource-card"><p className="m-muted">{item.title}</p><p className="m-muted">{item.relPath}</p><div className="m-actions-row"><label className="m-check"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])} />Select</label>{item.source === "vault" ? <button type="button" className="m-btn m-btn-ghost" onClick={() => void safe(async () => { await apiPatch(`/api/vault/items/${toVaultId(item.id)}/meta`, { favorite: !item.favorite }); await loadAll(); })}>{item.favorite ? "Unstar" : "Star"}</button> : null}</div></li>)}</ul></section> : null}

        {tab === "queue" ? <section className="m-card"><h2>Queue</h2><ul className="m-list-clean">{queue.map((job) => <li key={job.id} className="m-resource-card"><p className="m-muted">{job.type} · {job.status} · {job.reason ?? "-"}</p><p className="m-muted">{job.updatedAt}</p></li>)}</ul></section> : null}

        {tab === "git" ? <section className="m-card"><h2>Git</h2><div className="m-actions-row"><button type="button" className="m-btn" onClick={() => void safe(async () => { if (!instanceId) return; const result = await apiPost("/api/instances/" + instanceId + "/git/pull", {}); setGitResult(JSON.stringify(result, null, 2)); await loadAll(); })}>Pull Instance</button><button type="button" className="m-btn m-btn-ghost" onClick={() => void safe(async () => { const result = await apiPost("/api/vault/git/pull", {}); setGitResult(JSON.stringify(result, null, 2)); await loadAll(); })}>Pull Vault</button></div><pre className="m-muted" style={{ whiteSpace: "pre-wrap" }}>{gitResult || "No output yet."}</pre></section> : null}

        {tab === "settings" ? <section className="m-card"><h2>Settings</h2><div className="m-actions-row"><input className="m-input" type="password" value={enablePassword} onChange={(e) => setEnablePassword(e.target.value)} placeholder="password for auth toggle" /><button type="button" className="m-btn" onClick={() => void safe(async () => { await apiPost("/api/auth/set-enabled", { enabled: !authStatus.enabled, password: enablePassword || undefined }); const status = await apiGet<AuthStatus>("/api/auth/status"); setAuthStatus(status); setEnablePassword(""); })}>{authStatus.enabled ? "Disable Auth" : "Enable Auth"}</button></div><div className="m-actions-row"><input className="m-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="current password" /><input className="m-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="new password" /><button type="button" className="m-btn" onClick={() => void safe(async () => { await apiPost("/api/auth/change-password", { currentPassword, newPassword }); setCurrentPassword(""); setNewPassword(""); })}>Change Password</button></div><div className="m-actions-row"><label className="m-check"><input type="checkbox" checked={settings?.autoOpenBrowser ?? false} onChange={(e) => void safe(async () => setSettings(await apiPatch("/api/app-settings", { autoOpenBrowser: e.target.checked })))} />auto open</label><label className="m-check"><input type="checkbox" checked={settings?.autoUpdateRepo ?? true} onChange={(e) => void safe(async () => setSettings(await apiPatch("/api/app-settings", { autoUpdateRepo: e.target.checked })))} />auto update</label><label className="m-check"><input type="checkbox" checked={settings?.legacyUiEnabled ?? true} onChange={(e) => void safe(async () => setSettings(await apiPatch("/api/app-settings", { legacyUiEnabled: e.target.checked })))} />legacy entry</label></div><button type="button" className="m-btn m-btn-ghost" onClick={() => setLegacyMode(true)}>Open Legacy UI</button></section> : null}
      </main>

      <nav className="m-bottom-nav">
        {TABS.map((item) => <button key={item.key} type="button" className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}
      </nav>
      {toast ? <div className="m-toast">{toast}</div> : null}
    </div>
  );
}
