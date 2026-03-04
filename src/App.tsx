import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  clearAuthToken,
  downloadZip,
  getAuthToken,
  setAuthToken
} from "./lib/api";

type TabKey = "instance" | "scan" | "vault" | "queue" | "git" | "settings";
type AuthMode = "checking" | "setup" | "login" | "ready";
type RefreshMode = "none" | "incremental" | "full";

interface AuthStatus {
  enabled: boolean;
  passwordConfigured: boolean;
}

interface Instance {
  id: string;
  name: string;
  rootPath: string;
  layoutType: "modern" | "legacy" | "custom";
  isRunning: boolean;
}

interface FileNode {
  name: string;
  relPath: string;
  isDir: boolean;
  size?: number;
  children?: FileNode[];
}

interface VaultItem {
  id: string;
  title: string;
  relPath: string;
  tags: string[];
  type: string;
  favorite: boolean;
}

interface QueueJob {
  id: string;
  type: string;
  status: string;
  reason?: string;
  updatedAt: string;
}

interface ScanResult {
  offset: number;
  limit: number;
  total: number;
  scanned: number;
  truncated: boolean;
  refreshMode: RefreshMode;
  cache?: {
    mode: RefreshMode;
    changedSegments: number;
    reusedSegments: number;
    updatedAt: string;
  };
  summary: Record<string, number>;
  items: Array<{ relPath: string; type: string; isDir: boolean }>;
}

interface LoadedFile {
  relPath: string;
  content: string;
  readOnly: boolean;
  size: number;
}

function formatSize(size = 0): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function Tree({
  nodes,
  onPick
}: {
  nodes: FileNode[];
  onPick: (node: FileNode) => void;
}): JSX.Element {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <li key={node.relPath}>
          <button type="button" className="tree-node" onClick={() => onPick(node)}>
            {node.isDir ? "[D]" : "[F]"} {node.name}
          </button>
          {node.isDir && node.children && node.children.length > 0 ? (
            <Tree nodes={node.children} onPick={onPick} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<TabKey>("instance");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("准备就绪");

  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ enabled: false, passwordConfigured: false });
  const [authError, setAuthError] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [treeNodes, setTreeNodes] = useState<FileNode[]>([]);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [editorValue, setEditorValue] = useState("");

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanOffset, setScanOffset] = useState(0);
  const [scanLimit, setScanLimit] = useState(200);
  const [scanQuery, setScanQuery] = useState("");
  const [scanType, setScanType] = useState("");
  const [scanIncludeDirs, setScanIncludeDirs] = useState(true);
  const [scanRefreshMode, setScanRefreshMode] = useState<RefreshMode>("incremental");

  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [vaultQuery, setVaultQuery] = useState("");
  const [vaultImportPath, setVaultImportPath] = useState("");
  const [vaultApplyDir, setVaultApplyDir] = useState("data/default-user/characters");

  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);

  const [addName, setAddName] = useState("新实例");
  const [addRootPath, setAddRootPath] = useState("~/SillyTavern");
  const [pluginRepoUrl, setPluginRepoUrl] = useState("");

  const [enableAuthPassword, setEnableAuthPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [gitTarget, setGitTarget] = useState<"instance" | "vault">("instance");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitMessage, setGitMessage] = useState("resource update");

  const selectedInstance = useMemo(
    () => instances.find((it) => it.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  );

  async function wrap<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthToken();
        setAuthMode("login");
        setAuthError("登录状态失效，请重新登录");
        return undefined;
      }
      setMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function fetchAuthStatus(): Promise<AuthStatus> {
    const response = await fetch("/api/auth/status");
    if (!response.ok) {
      throw new Error("无法获取认证状态");
    }
    return (await response.json()) as AuthStatus;
  }

  async function refreshAuthStatus(): Promise<void> {
    const status = await fetchAuthStatus();
    setAuthStatus(status);
  }

  async function loadInstances(): Promise<void> {
    const res = await apiGet<{ items: Instance[] }>("/api/instances");
    setInstances(res.items);
    if (!selectedInstanceId && res.items[0]) {
      setSelectedInstanceId(res.items[0].id);
    }
  }

  async function loadTree(): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    const res = await apiGet<{ nodes: FileNode[] }>(`/api/instances/${selectedInstanceId}/tree`);
    setTreeNodes(res.nodes);
  }

  async function loadVault(): Promise<void> {
    const query = vaultQuery ? `?q=${encodeURIComponent(vaultQuery)}` : "";
    const res = await apiGet<{ items: VaultItem[] }>(`/api/vault/items${query}`);
    setVaultItems(res.items);
  }

  async function loadQueue(): Promise<void> {
    const res = await apiGet<{ items: QueueJob[] }>("/api/queue");
    setQueueJobs(res.items);
  }

  async function loadScan(forcedOffset?: number, forcedMode?: RefreshMode): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    const offset = forcedOffset ?? scanOffset;
    const mode = forcedMode ?? scanRefreshMode;
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(scanLimit),
      includeDirs: String(scanIncludeDirs),
      refreshMode: mode
    });
    if (scanQuery.trim()) {
      params.set("q", scanQuery.trim());
    }
    if (scanType.trim()) {
      params.set("type", scanType.trim());
    }
    const res = await apiPost<ScanResult>(`/api/instances/${selectedInstanceId}/scan?${params.toString()}`, {});
    setScanResult(res);
    setScanOffset(offset);
  }

  async function bootstrap(): Promise<void> {
    await Promise.all([loadInstances(), loadVault(), loadQueue(), refreshAuthStatus()]);
    setMessage("初始化完成");
  }

  async function initialize(): Promise<void> {
    await wrap(async () => {
      const status = await fetchAuthStatus();
      setAuthStatus(status);
      if (!status.passwordConfigured) {
        setAuthMode("setup");
        return;
      }
      if (!status.enabled) {
        setAuthMode("ready");
        await bootstrap();
        return;
      }
      if (!getAuthToken()) {
        setAuthMode("login");
        return;
      }
      await apiGet("/api/health");
      setAuthMode("ready");
      await bootstrap();
    });
  }

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (authMode === "ready") {
      void wrap(loadTree);
    }
  }, [authMode, selectedInstanceId]);

  async function doSetup(): Promise<void> {
    if (setupPassword.trim().length < 6) {
      setAuthError("密码至少 6 位");
      return;
    }
    await wrap(async () => {
      const res = await apiPost<{ token: string }>("/api/auth/setup", { password: setupPassword });
      setAuthToken(res.token);
      setAuthMode("ready");
      setAuthError("");
      await bootstrap();
    });
  }

  async function doLogin(): Promise<void> {
    if (!loginPassword.trim()) {
      setAuthError("请输入密码");
      return;
    }
    await wrap(async () => {
      const res = await apiPost<{ token: string | null; enabled: boolean }>("/api/auth/login", {
        password: loginPassword
      });
      if (res.enabled && res.token) {
        setAuthToken(res.token);
      }
      setAuthMode("ready");
      setAuthError("");
      await bootstrap();
    });
  }

  async function doLogout(): Promise<void> {
    await wrap(async () => {
      await apiPost("/api/auth/logout", {});
      clearAuthToken();
      setAuthMode("login");
    });
  }

  async function toggleAuthEnabled(nextEnabled: boolean): Promise<void> {
    await wrap(async () => {
      const payload: { enabled: boolean; password?: string } = { enabled: nextEnabled };
      if (nextEnabled && !authStatus.enabled) {
        if (!enableAuthPassword.trim()) {
          throw new Error("启用认证需要输入密码");
        }
        payload.password = enableAuthPassword.trim();
      }
      const res = await apiPost<{ enabled: boolean; passwordConfigured: boolean; token?: string | null }>(
        "/api/auth/set-enabled",
        payload
      );
      if (res.token) {
        setAuthToken(res.token);
      }
      if (!res.enabled) {
        clearAuthToken();
      }
      setEnableAuthPassword("");
      setAuthStatus({ enabled: res.enabled, passwordConfigured: res.passwordConfigured });
      setMessage(`认证已${res.enabled ? "启用" : "关闭"}`);
    });
  }

  async function changePassword(): Promise<void> {
    if (!currentPassword.trim() || !newPassword.trim()) {
      setMessage("请输入当前密码和新密码");
      return;
    }
    if (newPassword.trim().length < 6) {
      setMessage("新密码至少 6 位");
      return;
    }
    await wrap(async () => {
      await apiPost("/api/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      clearAuthToken();
      setAuthMode("login");
      setMessage("密码修改成功，请重新登录");
    });
  }

  async function openFile(node: FileNode): Promise<void> {
    if (node.isDir || !selectedInstanceId) {
      return;
    }
    await wrap(async () => {
      const res = await apiGet<LoadedFile>(`/api/instances/${selectedInstanceId}/file?path=${encodeURIComponent(node.relPath)}`);
      setFile(res);
      setEditorValue(res.content);
      setMessage(`已打开 ${node.relPath}`);
    });
  }

  async function saveFile(): Promise<void> {
    if (!selectedInstanceId || !file) {
      return;
    }
    await wrap(async () => {
      await apiPut(`/api/instances/${selectedInstanceId}/file`, {
        relPath: file.relPath,
        content: editorValue,
        queueIfRunning: true,
        createBackup: true
      });
      await loadQueue();
      await loadTree();
      setMessage("保存成功");
    });
  }

  async function addInstance(): Promise<void> {
    await wrap(async () => {
      await apiPost("/api/instances", { name: addName, rootPath: addRootPath });
      await loadInstances();
      setMessage("实例已添加");
    });
  }

  async function installPluginFromGit(): Promise<void> {
    if (!selectedInstanceId || !pluginRepoUrl.trim()) {
      return;
    }
    await wrap(async () => {
      await apiPost(`/api/instances/${selectedInstanceId}/plugins/install`, { repoUrl: pluginRepoUrl.trim() });
      await loadTree();
      setMessage("插件 Git 安装成功");
    });
  }

  const scanHasNext = scanResult !== null && scanResult.offset + scanResult.limit < scanResult.total;

  if (authMode !== "ready") {
    return (
      <div className="auth-gate">
        <div className="auth-panel">
          {authMode === "checking" ? <h2>初始化中...</h2> : null}
          {authMode === "setup" ? (
            <>
              <h2>设置访问密码</h2>
              <input className="input" type="password" placeholder="至少 6 位" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} />
              <button type="button" className="btn" onClick={() => void doSetup()}>保存并进入</button>
            </>
          ) : null}
          {authMode === "login" ? (
            <>
              <h2>登录</h2>
              <input className="input" type="password" placeholder="访问密码" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
              <button type="button" className="btn" onClick={() => void doLogin()}>登录</button>
            </>
          ) : null}
          {authError ? <p className="hint error">{authError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Termux 私有目录 · 本机 127.0.0.1</p>
          <h1>ST 资源管理器 + Vault</h1>
          <p className="subtitle">无需打开 SillyTavern 即可管理资源。</p>
        </div>
        <div className="status">{busy ? "执行中..." : message}</div>
      </header>

      <section className="card">
        <div className="row">
          <select className="input" value={selectedInstanceId} onChange={(e) => setSelectedInstanceId(e.target.value)}>
            <option value="">选择实例</option>
            {instances.map((it) => (
              <option key={it.id} value={it.id}>{it.name} ({it.isRunning ? "运行中" : "未运行"})</option>
            ))}
          </select>
          <button type="button" className="btn ghost" onClick={() => void wrap(loadInstances)}>刷新</button>
          {authStatus.enabled ? <button type="button" className="btn ghost" onClick={() => void doLogout()}>退出</button> : null}
        </div>
        {selectedInstance ? <p className="hint"><code>{selectedInstance.rootPath}</code> · {selectedInstance.layoutType}</p> : null}
        <div className="inline-form">
          <input className="input" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="实例名称" />
          <input className="input" value={addRootPath} onChange={(e) => setAddRootPath(e.target.value)} placeholder="实例根目录" />
          <button type="button" className="btn" onClick={() => void addInstance()}>新增实例</button>
        </div>
      </section>

      <nav className="tabs">
        {([
          ["instance", "实例文件"],
          ["scan", "资源扫描"],
          ["vault", "Vault"],
          ["queue", "队列"],
          ["git", "Git"],
          ["settings", "设置"]
        ] as Array<[TabKey, string]>).map(([key, label]) => (
          <button key={key} type="button" className={`tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {tab === "instance" ? (
        <section className="grid-two">
          <article className="card">
            <div className="row space">
              <h2>文件树</h2>
              <button type="button" className="btn ghost" onClick={() => void wrap(loadTree)}>刷新</button>
            </div>
            <div className="row">
              <label className="file-picker">导入 ZIP
                <input type="file" accept=".zip" onChange={(e) => {
                  const fileObj = e.target.files?.[0];
                  if (!fileObj || !selectedInstanceId) return;
                  void wrap(async () => {
                    const form = new FormData();
                    form.append("file", fileObj);
                    await apiPost(`/api/instances/${selectedInstanceId}/import/zip`, form);
                    await loadTree();
                  });
                }} />
              </label>
              <button type="button" className="btn" onClick={() => selectedInstanceId && void downloadZip(`/api/instances/${selectedInstanceId}/export/zip`, {}, "instance.zip")}>导出 ZIP</button>
            </div>
            <div className="row">
              <label className="file-picker">插件 ZIP 安装
                <input type="file" accept=".zip" onChange={(e) => {
                  const fileObj = e.target.files?.[0];
                  if (!fileObj || !selectedInstanceId) return;
                  void wrap(async () => {
                    const form = new FormData();
                    form.append("file", fileObj);
                    await apiPost(`/api/instances/${selectedInstanceId}/plugins/install`, form);
                    await loadTree();
                    setMessage("插件 ZIP 安装成功");
                  });
                }} />
              </label>
            </div>
            <div className="row">
              <input className="input" value={pluginRepoUrl} onChange={(e) => setPluginRepoUrl(e.target.value)} placeholder="插件 Git 仓库 URL" />
              <button type="button" className="btn" onClick={() => void installPluginFromGit()}>安装 Git 插件</button>
            </div>
            <div className="tree-wrap"><Tree nodes={treeNodes} onPick={(node) => void openFile(node)} /></div>
          </article>
          <article className="card">
            <div className="row space">
              <h2>编辑器</h2>
              <button type="button" className="btn" disabled={!file || file.readOnly} onClick={() => void saveFile()}>保存</button>
            </div>
            {file ? (
              <>
                <p className="hint"><code>{file.relPath}</code> · {formatSize(file.size)} · {file.readOnly ? "只读" : "可编辑"}</p>
                <div className="editor-wrap">
                  <CodeMirror value={editorValue} height="420px" editable={!file.readOnly} extensions={file.relPath.endsWith(".json") ? [jsonLang()] : []} onChange={(v) => setEditorValue(v)} />
                </div>
              </>
            ) : <p className="hint">点击左侧文件查看内容。</p>}
          </article>
        </section>
      ) : null}

      {tab === "scan" ? (
        <section className="card">
          <div className="row">
            <input className="input" placeholder="关键字" value={scanQuery} onChange={(e) => setScanQuery(e.target.value)} />
            <input className="input" placeholder="类型过滤（可选）" value={scanType} onChange={(e) => setScanType(e.target.value)} />
            <input className="input small-input" type="number" value={scanLimit} onChange={(e) => setScanLimit(Number(e.target.value) || 200)} />
            <select className="input" value={scanRefreshMode} onChange={(e) => setScanRefreshMode(e.target.value as RefreshMode)}>
              <option value="none">缓存查询</option>
              <option value="incremental">增量刷新</option>
              <option value="full">全量刷新</option>
            </select>
            <label><input type="checkbox" checked={scanIncludeDirs} onChange={(e) => setScanIncludeDirs(e.target.checked)} />包含目录</label>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => { setScanOffset(0); void wrap(() => loadScan(0, scanRefreshMode)); }}>执行扫描</button>
            <button type="button" className="btn ghost" onClick={() => { setScanOffset(0); void wrap(() => loadScan(0, "incremental")); }}>增量刷新</button>
            <button type="button" className="btn ghost" onClick={() => { setScanOffset(0); void wrap(() => loadScan(0, "full")); }}>全量刷新</button>
          </div>
          {scanResult ? (
            <>
              <p className="hint">total={scanResult.total} scanned={scanResult.scanned} mode={scanResult.refreshMode}</p>
              {scanResult.cache ? <p className="hint">cache changed={scanResult.cache.changedSegments} reused={scanResult.cache.reusedSegments} updated={scanResult.cache.updatedAt}</p> : null}
              <div className="row">
                <button type="button" className="btn ghost" disabled={scanOffset === 0} onClick={() => { const next = Math.max(0, scanOffset - scanLimit); void wrap(() => loadScan(next, "none")); }}>上一页</button>
                <button type="button" className="btn ghost" disabled={!scanHasNext} onClick={() => { const next = scanOffset + scanLimit; void wrap(() => loadScan(next, "none")); }}>下一页</button>
              </div>
              <div className="list compact">
                {scanResult.items.map((it) => <div key={it.relPath} className="list-item"><code>{it.relPath}</code><span>{it.type}</span></div>)}
              </div>
            </>
          ) : <p className="hint">点击执行扫描获取分页结果。</p>}
        </section>
      ) : null}

      {tab === "vault" ? (
        <section className="card">
          <div className="row">
            <input className="input" placeholder="搜索 Vault" value={vaultQuery} onChange={(e) => setVaultQuery(e.target.value)} />
            <button type="button" className="btn ghost" onClick={() => void wrap(loadVault)}>搜索</button>
            <button type="button" className="btn" onClick={() => void downloadZip("/api/vault/export/zip", {}, "vault.zip")}>导出 ZIP</button>
          </div>
          <div className="row">
            <label className="file-picker">导入 ZIP
              <input type="file" accept=".zip" onChange={(e) => {
                const fileObj = e.target.files?.[0];
                if (!fileObj) return;
                void wrap(async () => {
                  const form = new FormData();
                  form.append("file", fileObj);
                  await apiPost("/api/vault/import/zip", form);
                  await loadVault();
                });
              }} />
            </label>
            <input className="input" placeholder="路径导入" value={vaultImportPath} onChange={(e) => setVaultImportPath(e.target.value)} />
            <button type="button" className="btn" onClick={() => void wrap(async () => {
              await apiPost("/api/vault/import/path", { sourcePath: vaultImportPath, tags: [] });
              await loadVault();
            })}>导入路径</button>
          </div>
          <div className="row"><input className="input" placeholder="取用目标目录" value={vaultApplyDir} onChange={(e) => setVaultApplyDir(e.target.value)} /></div>
          <div className="list">
            {vaultItems.map((it) => (
              <div key={it.id} className="vault-item">
                <div className="row space">
                  <strong>{it.title}</strong>
                  <div className="row">
                    <button type="button" className="btn ghost" onClick={() => void wrap(async () => {
                      await apiPatch(`/api/vault/items/${it.id}/meta`, { favorite: !it.favorite });
                      await loadVault();
                    })}>{it.favorite ? "已收藏" : "收藏"}</button>
                    <button type="button" className="btn" onClick={() => selectedInstanceId && void wrap(async () => {
                      await apiPost(`/api/vault/items/${it.id}/apply`, { instanceId: selectedInstanceId, targetRelDir: vaultApplyDir, mode: "copy_once" });
                      await loadTree();
                    })}>取用</button>
                    <button type="button" className="btn danger" onClick={() => void wrap(async () => {
                      await apiDelete(`/api/vault/items/${it.id}`);
                      await loadVault();
                    })}>删除</button>
                  </div>
                </div>
                <p className="hint"><code>{it.relPath}</code> · {it.type}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "queue" ? (
        <section className="card">
          <div className="row space"><h2>写入队列</h2><button type="button" className="btn ghost" onClick={() => void wrap(loadQueue)}>刷新</button></div>
          <div className="list">
            {queueJobs.map((job) => (
              <div key={job.id} className="list-item">
                <span>{job.type} · {job.status} {job.reason ? `· ${job.reason}` : ""}</span>
                <button type="button" className="btn danger" onClick={() => void wrap(async () => { await apiPost(`/api/queue/${job.id}/cancel`, {}); await loadQueue(); })}>取消</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "git" ? (
        <section className="card">
          <div className="row">
            <select className="input" value={gitTarget} onChange={(e) => setGitTarget(e.target.value as "instance" | "vault")}>
              <option value="instance">实例</option>
              <option value="vault">Vault</option>
            </select>
            <input className="input" placeholder="repo url" value={gitRepoUrl} onChange={(e) => setGitRepoUrl(e.target.value)} />
            <input className="input" placeholder="branch" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
          </div>
          <div className="row">
            <input className="input" placeholder="message" value={gitMessage} onChange={(e) => setGitMessage(e.target.value)} />
            <button type="button" className="btn" onClick={() => {
              if (gitTarget === "instance" && !selectedInstanceId) { setMessage("请先选择实例"); return; }
              const endpoint = gitTarget === "vault" ? "/api/vault/git/clone" : `/api/instances/${selectedInstanceId}/git/clone`;
              void wrap(() => apiPost(endpoint, { repoUrl: gitRepoUrl, branch: gitBranch }));
            }}>Clone</button>
            <button type="button" className="btn" onClick={() => {
              if (gitTarget === "instance" && !selectedInstanceId) { setMessage("请先选择实例"); return; }
              const endpoint = gitTarget === "vault" ? "/api/vault/git/commit" : `/api/instances/${selectedInstanceId}/git/commit`;
              void wrap(() => apiPost(endpoint, { message: gitMessage }));
            }}>Commit</button>
            <button type="button" className="btn" onClick={() => {
              if (gitTarget === "instance" && !selectedInstanceId) { setMessage("请先选择实例"); return; }
              const endpoint = gitTarget === "vault" ? "/api/vault/git/pull" : `/api/instances/${selectedInstanceId}/git/pull`;
              void wrap(() => apiPost(endpoint, {}));
            }}>Pull</button>
            <button type="button" className="btn" onClick={() => {
              if (gitTarget === "instance" && !selectedInstanceId) { setMessage("请先选择实例"); return; }
              const endpoint = gitTarget === "vault" ? "/api/vault/git/push" : `/api/instances/${selectedInstanceId}/git/push`;
              void wrap(() => apiPost(endpoint, { message: gitMessage }));
            }}>Push</button>
          </div>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="card">
          <h2>认证设置</h2>
          <p className="hint">当前状态: {authStatus.enabled ? "已启用" : "未启用"} · 密码{authStatus.passwordConfigured ? "已设置" : "未设置"}</p>
          <div className="row">
            {!authStatus.enabled ? (
              <>
                <input className="input" type="password" placeholder="启用认证需要输入密码" value={enableAuthPassword} onChange={(e) => setEnableAuthPassword(e.target.value)} />
                <button type="button" className="btn" onClick={() => void toggleAuthEnabled(true)}>启用认证</button>
              </>
            ) : <button type="button" className="btn danger" onClick={() => void toggleAuthEnabled(false)}>关闭认证</button>}
            <button type="button" className="btn ghost" onClick={() => void wrap(refreshAuthStatus)}>刷新状态</button>
          </div>
          <h2>修改密码</h2>
          <div className="inline-form">
            <input className="input" type="password" placeholder="当前密码" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <input className="input" type="password" placeholder="新密码（至少 6 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button type="button" className="btn" onClick={() => void changePassword()}>提交修改</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
