import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { LegacyApp } from "./LegacyApp";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  downloadZip,
  getAuthToken,
  setAuthToken
} from "./lib/api";

type Tab = "home" | "resources" | "queue" | "git" | "settings";
type AuthMode = "checking" | "setup" | "login" | "ready";
type Source = "all" | "instance" | "vault";
type RefreshMode = "none" | "incremental" | "full";

interface AuthStatus { enabled: boolean; passwordConfigured: boolean; }
interface Instance { id: string; name: string; rootPath: string; isRunning: boolean; }
interface AppSettings { trashRetentionDays: number; legacyUiEnabled: boolean; autoOpenBrowser: boolean; autoUpdateRepo: boolean; }
interface QueueJob { id: string; type: string; status: string; reason?: string; updatedAt: string; }
interface TrashItem { id: string; source: "instance" | "vault"; originalRelPath: string; deletedAt: string; expireAt: string; }
interface ResourceItem {
  id: string; source: "instance" | "vault"; instanceId?: string; relPath: string; title: string; type: string; tags: string[];
  favorite: boolean; previewKind: "text" | "json" | "image" | "none"; editable: boolean; size?: number; updatedAt?: string;
}
interface ResourceResp { items: ResourceItem[]; total: number; offset: number; limit: number; sourceSummary: Record<"instance" | "vault", number>; }
interface Dashboard {
  selectedInstance?: { name: string; rootPath: string; isRunning: boolean; version: string; resourceTotal: number; };
  instances: Array<{ id: string; name: string; isRunning: boolean; resourceTotal: number; }>;
  queueStats: { total: number; blocked: number; failed: number; running: number; updatedAt: string; };
  resourceStats: Record<string, number>;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "home", label: "首页" }, { key: "resources", label: "资源" }, { key: "queue", label: "队列" }, { key: "git", label: "Git" }, { key: "settings", label: "设置" }
];

function fmtDate(v?: string): string { if (!v) return "-"; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString("zh-CN", { hour12: false }); }
function fmtSize(v?: number): string { if (v === undefined) return "-"; if (v < 1024) return `${v} B`; if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`; return `${(v / (1024 * 1024)).toFixed(1)} MB`; }
function vaultId(id: string): string { return id.replace(/^vault:/, ""); }
function resRef(item: ResourceItem): { source: "instance" | "vault"; id?: string; instanceId?: string; relPath?: string } {
  return item.source === "vault" ? { source: "vault", id: vaultId(item.id) } : { source: "instance", instanceId: item.instanceId, relPath: item.relPath };
}
async function authBlob(url: string): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.blob();
}

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ enabled: false, passwordConfigured: false });
  const [setupPassword, setSetupPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [queueItems, setQueueItems] = useState<QueueJob[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [resources, setResources] = useState<ResourceResp>({ items: [], total: 0, offset: 0, limit: 50, sourceSummary: { instance: 0, vault: 0 } });
  const [source, setSource] = useState<Source>("all");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [tags, setTags] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [targetDir, setTargetDir] = useState("data/default-user/characters");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [active, setActive] = useState<ResourceItem | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [previewReadOnly, setPreviewReadOnly] = useState(true);
  const [previewImage, setPreviewImage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorValue, setEditorValue] = useState("");
  const [gitTarget, setGitTarget] = useState<"instance" | "vault">("instance");
  const [gitRepo, setGitRepo] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitMessage, setGitMessage] = useState("update resources");
  const [gitResult, setGitResult] = useState("");
  const [legacyMode, setLegacyMode] = useState(false);
  const [enableAuthPassword, setEnableAuthPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [toast, setToast] = useState("准备就绪");
  const toastTimerRef = useRef<number | null>(null);

  const currentInstance = useMemo(() => instances.find((item) => item.id === instanceId), [instances, instanceId]);
  const selectedResources = useMemo(() => resources.items.filter((item) => selectedIds.includes(item.id)), [resources.items, selectedIds]);

  function notify(message: string): void {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => { setToast(""); toastTimerRef.current = null; }, 2600);
  }

  function onError(error: unknown): void {
    notify(error instanceof Error ? error.message : String(error));
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try { return await fn(); } catch (error) { onError(error); return undefined; }
  }

  async function loadInstances(): Promise<string> {
    const res = await run(() => apiGet<{ items: Instance[] }>("/api/instances"));
    if (!res) return "";
    setInstances(res.items);
    const next = res.items.some((item) => item.id === instanceId) ? instanceId : (res.items[0]?.id ?? "");
    setInstanceId(next);
    return next;
  }

  async function loadDashboard(selected = instanceId): Promise<void> {
    const qs = selected ? `?instanceId=${encodeURIComponent(selected)}` : "";
    const res = await run(() => apiGet<Dashboard>(`/api/dashboard/summary${qs}`));
    if (res) setDashboard(res);
  }

  async function loadResources(offset = 0, refreshMode: RefreshMode = "none"): Promise<void> {
    const p = new URLSearchParams({ source, offset: String(offset), limit: "50", refreshMode, includeDirs: "false" });
    if (instanceId) p.set("instanceId", instanceId);
    if (q.trim()) p.set("q", q.trim());
    if (typeFilter.trim()) p.set("type", typeFilter.trim());
    if (tags.trim()) p.set("tags", tags.trim());
    if (favoriteOnly) p.set("favorite", "true");
    const res = await run(() => apiGet<ResourceResp>(`/api/resources?${p.toString()}`));
    if (!res) return;
    setResources(res);
    setSelectedIds((prev) => prev.filter((id) => res.items.some((item) => item.id === id)));
  }

  async function loadSettings(): Promise<void> {
    const res = await run(() => apiGet<AppSettings>("/api/app-settings"));
    if (res) setSettings(res);
  }

  async function loadQueue(): Promise<void> {
    const res = await run(() => apiGet<{ items: QueueJob[] }>("/api/queue"));
    if (res) setQueueItems(res.items);
  }

  async function loadTrash(): Promise<void> {
    const res = await run(() => apiGet<{ items: TrashItem[] }>("/api/trash/items?offset=0&limit=100"));
    if (res) setTrashItems(res.items);
  }

  async function bootstrap(): Promise<void> {
    const selected = await loadInstances();
    await Promise.all([loadSettings(), loadQueue(), loadTrash()]);
    await Promise.all([loadDashboard(selected), loadResources(0, "incremental")]);
  }

  async function initialize(): Promise<void> {
    const status = await run(() => apiGet<AuthStatus>("/api/auth/status"));
    if (!status) return;
    setAuthStatus(status);
    if (!status.passwordConfigured) { setAuthMode("setup"); return; }
    if (status.enabled && !getAuthToken()) { setAuthMode("login"); return; }
    setAuthMode("ready");
    await bootstrap();
  }

  async function openResource(item: ResourceItem): Promise<void> {
    setActive(item);
    setPreviewText("");
    setEditorValue("");
    setPreviewReadOnly(true);
    setPreviewImage((prev) => { if (prev) URL.revokeObjectURL(prev); return ""; });
    if (item.previewKind === "none") return;
    if (item.previewKind === "image") {
      const qs = new URLSearchParams({ source: item.source });
      if (item.source === "instance") { qs.set("instanceId", item.instanceId ?? ""); qs.set("relPath", item.relPath); } else { qs.set("itemId", vaultId(item.id)); }
      const blob = await run(() => authBlob(`/api/resources/content?${qs.toString()}`));
      if (blob) setPreviewImage(URL.createObjectURL(blob));
      return;
    }
    if (item.source === "instance") {
      const qs = new URLSearchParams({ source: "instance", instanceId: item.instanceId ?? "", path: item.relPath });
      const res = await run(() => apiGet<{ content: string; readOnly: boolean }>(`/api/file?${qs.toString()}`));
      if (res) { setPreviewText(res.content); setEditorValue(res.content); setPreviewReadOnly(res.readOnly || !item.editable); }
      return;
    }
    const vaultRes = await run(() => apiGet<{ content: string; readOnly: boolean }>(`/api/vault/items/${vaultId(item.id)}/content`));
    if (vaultRes) { setPreviewText(vaultRes.content); setEditorValue(vaultRes.content); setPreviewReadOnly(true); }
  }

  useEffect(() => {
    void initialize();
    return () => { if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current); if (previewImage) URL.revokeObjectURL(previewImage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authMode !== "ready" || !instanceId) return;
    void Promise.all([loadDashboard(instanceId), loadResources(0, "incremental")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  if (legacyMode) {
    return <>
      <div className="m-app"><section className="m-card"><h2>旧版并行入口</h2><button type="button" className="m-btn" onClick={() => setLegacyMode(false)}>返回新版</button></section></div>
      <LegacyApp />
    </>;
  }

  if (authMode !== "ready") {
    return <div className="m-auth-wrap"><section className="m-auth-card"><h2>资源管理器</h2>
      {authMode === "checking" ? <p className="m-muted">初始化中...</p> : null}
      {authMode === "setup" ? <>
        <input className="m-input" type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="设置密码（至少 6 位）" />
        <button type="button" className="m-btn" onClick={() => void run(async () => { const r = await apiPost<{ token: string }>("/api/auth/setup", { password: setupPassword }); if (r.token) setAuthToken(r.token); setAuthMode("ready"); await bootstrap(); })}>完成初始化</button>
      </> : null}
      {authMode === "login" ? <>
        <input className="m-input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="输入密码" />
        <button type="button" className="m-btn" onClick={() => void run(async () => { const r = await apiPost<{ token: string | null }>("/api/auth/login", { password: loginPassword }); if (r.token) setAuthToken(r.token); setAuthMode("ready"); await bootstrap(); })}>登录</button>
      </> : null}
    </section></div>;
  }

  return <div className="m-app">
    <header className="m-topbar"><div><p className="m-label">ST RESOURCE MANAGER</p><h1>资源中心</h1><p className="m-subline">实例: {currentInstance?.name ?? "未选择"} · {currentInstance?.isRunning ? "运行中" : "未运行"}</p><p className="m-subline">{currentInstance?.rootPath ?? "-"}</p></div><button type="button" className="m-icon-btn" onClick={() => void bootstrap()}>刷新</button></header>
    <section className="m-instance-strip"><select className="m-input" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>{instances.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></section>
    <main className="m-main">
      {tab === "home" ? <div className="m-stack">
        <section className="m-card"><h2>当前实例</h2><p className="m-big">{dashboard?.selectedInstance?.name ?? "-"}</p><p className="m-muted">版本: {dashboard?.selectedInstance?.version ?? "unknown"} · 资源: {dashboard?.selectedInstance?.resourceTotal ?? 0}</p></section>
        <section className="m-card"><h2>全实例总览</h2><ul className="m-list-clean">{(dashboard?.instances ?? []).map((item) => <li key={item.id} className="m-mini-row"><strong>{item.name}</strong><span>{item.isRunning ? "运行中" : "未运行"}</span><span className="m-muted">{item.resourceTotal} 文件</span><span className="m-muted">ID: {item.id}</span></li>)}</ul></section>
        <section className="m-card"><h2>资源统计</h2><div className="m-stats-grid">{Object.entries(dashboard?.resourceStats ?? {}).map(([k, v]) => <div key={k} className="m-stat-item"><span className="m-muted">{k}</span><strong>{v}</strong></div>)}</div></section>
      </div> : null}
      {tab === "resources" ? <div className="m-stack">
        <section className="m-card"><h2>统一资源中心</h2><div className="m-filter-grid"><select className="m-input" value={source} onChange={(e) => setSource(e.target.value as Source)}><option value="all">全部来源</option><option value="instance">实例</option><option value="vault">Vault</option></select><input className="m-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="类型" /><input className="m-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="关键词" /><input className="m-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签（逗号）" /></div><div className="m-actions-row" style={{ marginTop: 8 }}><label className="m-check"><input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} />仅收藏</label><button type="button" className="m-btn" onClick={() => void loadResources(0, "none")}>筛选</button><button type="button" className="m-btn m-btn-ghost" onClick={() => void loadResources(0, "incremental")}>增量刷新</button><button type="button" className="m-btn m-btn-ghost" onClick={() => setShowTrash((v) => !v)}>{showTrash ? "隐藏回收站" : "回收站"}</button></div><p className="m-muted">共 {resources.total} 条 · 实例 {resources.sourceSummary.instance} · Vault {resources.sourceSummary.vault}</p></section>
        <section className="m-card"><h2>批量动作</h2><input className="m-input" value={targetDir} onChange={(e) => setTargetDir(e.target.value)} placeholder="目标目录" /><div className="m-actions-row" style={{ marginTop: 8 }}><button type="button" className="m-btn m-btn-ghost" onClick={() => { const ids = resources.items.map((x) => x.id); const all = ids.every((id) => selectedIds.includes(id)); setSelectedIds(all ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]); }}>{resources.items.length > 0 && resources.items.every((x) => selectedIds.includes(x.id)) ? "取消本页全选" : "本页全选"}</button><span className="m-muted">已选 {selectedResources.length}</span><button type="button" className="m-btn" onClick={() => void run(async () => { if (!instanceId || selectedResources.length === 0) return; const r = await apiPost<{ success: number; total: number }>("/api/resources/batch/apply", { instanceId, targetRelDir: targetDir, mode: "copy_once", items: selectedResources.map(resRef) }); notify(`取用完成 ${r.success}/${r.total}`); setSelectedIds([]); await Promise.all([loadResources(resources.offset, "incremental"), loadDashboard(instanceId)]); })}>批量取用</button><button type="button" className="m-btn m-btn-ghost" onClick={() => void run(async () => { if (selectedResources.length === 0) return; await downloadZip("/api/resources/batch/export/zip", { items: selectedResources.map(resRef) }, `resources-${Date.now()}.zip`); notify("已导出 ZIP"); })}>批量导出</button><button type="button" className="m-btn m-btn-danger" onClick={() => void run(async () => { if (selectedResources.length === 0) return; if (!window.confirm(`确认删除 ${selectedResources.length} 项到回收站？`)) return; const r = await apiPost<{ success: number; total: number }>("/api/resources/batch/delete", { items: selectedResources.map(resRef) }); notify(`已移入回收站 ${r.success}/${r.total}`); setSelectedIds([]); await Promise.all([loadResources(resources.offset, "incremental"), loadTrash()]); })}>批量删除</button></div></section>
        <section className="m-card"><h2>资源列表</h2><div className="m-resource-list">{resources.items.map((item) => <article key={item.id} className="m-resource-card"><div className="m-resource-head"><h3>{item.title}</h3>{item.source === "vault" ? <button type="button" className={`m-star ${item.favorite ? "active" : ""}`} onClick={() => void run(async () => { await apiPatch(`/api/vault/items/${vaultId(item.id)}/meta`, { favorite: !item.favorite }); await loadResources(resources.offset, "none"); })}>{item.favorite ? "★" : "☆"}</button> : null}</div><p className="m-muted">{item.relPath}</p><div className="m-tags"><span className="m-tag">{item.source}</span><span className="m-tag">{item.type}</span><span className="m-tag">{item.previewKind}</span>{item.tags.slice(0, 2).map((tag) => <span key={tag} className="m-tag">#{tag}</span>)}</div><p className="m-muted">大小: {fmtSize(item.size)} · 更新: {fmtDate(item.updatedAt)}</p><div className="m-actions-row"><button type="button" className="m-btn m-btn-ghost" onClick={() => void openResource(item)}>详情</button><label className="m-check"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])} />选择</label></div></article>)}</div></section>
        {showTrash ? <section className="m-card"><h2>回收站</h2><div className="m-actions-row"><button type="button" className="m-btn m-btn-ghost" onClick={() => void loadTrash()}>刷新</button><button type="button" className="m-btn m-btn-ghost" onClick={() => void run(async () => { const r = await apiPost<{ removed: number }>("/api/trash/cleanup", {}); notify(`清理 ${r.removed} 项`); await loadTrash(); })}>清理过期</button></div><ul className="m-list-clean">{trashItems.map((item) => <li key={item.id} className="m-resource-card"><p className="m-muted">{item.originalRelPath}</p><p className="m-muted">来源: {item.source} · 删除: {fmtDate(item.deletedAt)} · 过期: {fmtDate(item.expireAt)}</p><div className="m-actions-row"><button type="button" className="m-btn" onClick={() => void run(async () => { await apiPost("/api/trash/restore", { itemIds: [item.id] }); await Promise.all([loadTrash(), loadResources(resources.offset, "incremental")]); notify("已恢复"); })}>恢复</button><button type="button" className="m-btn m-btn-danger" onClick={() => void run(async () => { if (!window.confirm("确认永久删除？")) return; await apiDelete(`/api/trash/items/${item.id}`); await loadTrash(); notify("已永久删除"); })}>永久删除</button></div></li>)}</ul></section> : null}
      </div> : null}
      {tab === "queue" ? <section className="m-card"><h2>写入队列</h2><div className="m-actions-row"><button type="button" className="m-btn m-btn-ghost" onClick={() => void loadQueue()}>刷新</button></div><ul className="m-list-clean">{queueItems.map((job) => <li key={job.id} className="m-resource-card"><p className="m-muted">{job.type} · {job.status} · {job.reason ?? "-"}</p><p className="m-muted">更新: {fmtDate(job.updatedAt)}</p><button type="button" className="m-btn m-btn-danger" onClick={() => void run(async () => { await apiPost(`/api/queue/${job.id}/cancel`, {}); await loadQueue(); })} disabled={job.status === "done" || job.status === "cancelled"}>取消</button></li>)}</ul></section> : null}
      {tab === "git" ? <section className="m-card"><h2>Git 操作</h2><div className="m-filter-grid"><select className="m-input" value={gitTarget} onChange={(e) => setGitTarget(e.target.value as "instance" | "vault")}><option value="instance">实例</option><option value="vault">Vault</option></select><input className="m-input" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} placeholder="仓库地址（clone）" /><input className="m-input" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} placeholder="分支" /><input className="m-input" value={gitMessage} onChange={(e) => setGitMessage(e.target.value)} placeholder="提交信息" /></div><div className="m-actions-row" style={{ marginTop: 8 }}>{(["clone", "commit", "pull", "push"] as const).map((action) => <button key={action} type="button" className={`m-btn ${action === "clone" ? "" : "m-btn-ghost"}`} onClick={() => void run(async () => { if (gitTarget === "instance" && !instanceId) return; const base = gitTarget === "vault" ? "/api/vault/git" : `/api/instances/${instanceId}/git`; const body = action === "clone" ? { repoUrl: gitRepo, branch: gitBranch } : action === "commit" ? { message: gitMessage } : action === "push" ? { message: gitMessage } : {}; const r = await apiPost<Record<string, unknown>>(`${base}/${action}`, body); setGitResult(JSON.stringify(r, null, 2)); await loadResources(0, "incremental"); })}>{action.toUpperCase()}</button>)}</div><pre className="m-muted" style={{ whiteSpace: "pre-wrap" }}>{gitResult || "结果会显示在这里"}</pre></section> : null}
      {tab === "settings" ? <div className="m-stack">
        <section className="m-card"><h2>认证设置</h2><p className="m-muted">状态: {authStatus.enabled ? "已启用" : "未启用"} · 密码{authStatus.passwordConfigured ? "已设置" : "未设置"}</p><div className="m-actions-row">{authStatus.enabled ? <button type="button" className="m-btn m-btn-danger" onClick={() => void run(async () => { await apiPost("/api/auth/set-enabled", { enabled: false }); setAuthStatus(await apiGet<AuthStatus>("/api/auth/status")); })}>关闭认证</button> : <><input className="m-input" type="password" value={enableAuthPassword} onChange={(e) => setEnableAuthPassword(e.target.value)} placeholder="启用认证需输入密码" /><button type="button" className="m-btn" onClick={() => void run(async () => { const r = await apiPost<{ token?: string | null }>("/api/auth/set-enabled", { enabled: true, password: enableAuthPassword }); if (r.token) setAuthToken(r.token); setAuthStatus(await apiGet<AuthStatus>("/api/auth/status")); setEnableAuthPassword(""); })}>启用认证</button></>}</div><div className="m-filter-grid" style={{ marginTop: 8 }}><input className="m-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="当前密码" /><input className="m-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密码（至少 6 位）" /><button type="button" className="m-btn" onClick={() => void run(async () => { await apiPost("/api/auth/change-password", { currentPassword, newPassword }); setCurrentPassword(""); setNewPassword(""); notify("密码已更新"); })}>修改密码</button></div></section>
        <section className="m-card"><h2>应用设置</h2><div className="m-actions-row"><label className="m-check"><input type="checkbox" checked={settings?.autoOpenBrowser ?? false} onChange={(e) => void run(async () => setSettings(await apiPatch<AppSettings>("/api/app-settings", { autoOpenBrowser: e.target.checked })))} />自动跳转浏览器</label><label className="m-check"><input type="checkbox" checked={settings?.autoUpdateRepo ?? true} onChange={(e) => void run(async () => setSettings(await apiPatch<AppSettings>("/api/app-settings", { autoUpdateRepo: e.target.checked })))} />自动更新仓库</label><label className="m-check"><input type="checkbox" checked={settings?.legacyUiEnabled ?? true} onChange={(e) => void run(async () => setSettings(await apiPatch<AppSettings>("/api/app-settings", { legacyUiEnabled: e.target.checked })))} />启用旧版入口</label></div><div className="m-actions-row" style={{ marginTop: 8 }}><span className="m-muted">回收站保留天数</span><select className="m-input" value={String(settings?.trashRetentionDays ?? 30)} onChange={(e) => void run(async () => setSettings(await apiPatch<AppSettings>("/api/app-settings", { trashRetentionDays: Number(e.target.value) })))}>{[7, 14, 30, 90].map((d) => <option key={d} value={String(d)}>{d} 天</option>)}</select></div>{settings?.legacyUiEnabled ? <button type="button" className="m-btn m-btn-ghost" onClick={() => setLegacyMode(true)}>进入旧版页面</button> : null}</section>
      </div> : null}
    </main>

    {active ? <div className="m-drawer-mask" onClick={() => setActive(null)}><section className="m-drawer" onClick={(e) => e.stopPropagation()}><div className="m-drawer-head"><h2>{active.title}</h2><button type="button" className="m-btn m-btn-ghost" onClick={() => setActive(null)}>关闭</button></div><p className="m-muted">{active.relPath}</p><div className="m-tags"><span className="m-tag">{active.source}</span><span className="m-tag">{active.type}</span><span className="m-tag">{active.previewKind}</span></div>{active.previewKind === "image" && previewImage ? <img src={previewImage} alt={active.title} className="m-preview-image" /> : null}{active.previewKind !== "image" && active.previewKind !== "none" ? <div className="m-editor-shell"><CodeMirror value={editorValue || previewText} height="220px" editable={!previewReadOnly} extensions={active.previewKind === "json" ? [jsonLang()] : []} onChange={(value) => setEditorValue(value)} /></div> : null}<div className="m-actions-row" style={{ marginTop: 8 }}>{active.previewKind !== "image" && active.previewKind !== "none" ? <button type="button" className="m-btn m-btn-ghost" onClick={() => setEditorOpen(true)}>全屏编辑</button> : null}{active.source === "instance" && active.editable ? <button type="button" className="m-btn" disabled={previewReadOnly} onClick={() => void run(async () => { await apiPut(`/api/instances/${active.instanceId}/file`, { relPath: active.relPath, content: editorValue, queueIfRunning: true, createBackup: true }); await Promise.all([loadQueue(), loadResources(resources.offset, "none")]); notify("保存成功"); })}>保存</button> : null}</div></section></div> : null}
    {editorOpen && active ? <div className="m-modal-mask" onClick={() => setEditorOpen(false)}><section className="m-modal" onClick={(e) => e.stopPropagation()}><div className="m-drawer-head"><h2>全屏编辑</h2><button type="button" className="m-btn m-btn-ghost" onClick={() => setEditorOpen(false)}>关闭</button></div><div className="m-editor-full"><CodeMirror value={editorValue} height="65vh" editable={!previewReadOnly} extensions={active.previewKind === "json" ? [jsonLang()] : []} onChange={(value) => setEditorValue(value)} /></div></section></div> : null}

    <nav className="m-bottom-nav">{TABS.map((item) => <button key={item.key} type="button" className={item.key === tab ? "active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav>
    {toast ? <div className="m-toast">{toast}</div> : null}
  </div>;
}
