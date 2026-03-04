import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  downloadZip
} from "./lib/api";

type TabKey = "instance" | "scan" | "vault" | "queue" | "git";

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
  type: string;
  children?: FileNode[];
}

interface QueueJob {
  id: string;
  type: string;
  status: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultItem {
  id: string;
  relPath: string;
  title: string;
  type: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
}

interface ScanResult {
  total: number;
  summary: Record<string, number>;
  items: Array<{ relPath: string; type: string; isDir: boolean }>;
}

interface LoadedFile {
  relPath: string;
  content: string;
  readOnly: boolean;
  size: number;
}

function isJsonFile(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".json");
}

function formatSize(size?: number): string {
  if (!size) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function TreeNodeList({
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
          <button
            type="button"
            className={node.isDir ? "tree-node dir" : "tree-node file"}
            onClick={() => onPick(node)}
          >
            <span>{node.isDir ? "[D]" : "[F]"}</span>
            <span>{node.name}</span>
          </button>
          {node.isDir && node.children && node.children.length > 0 ? (
            <TreeNodeList nodes={node.children} onPick={onPick} />
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
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [treeNodes, setTreeNodes] = useState<FileNode[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [vaultQuery, setVaultQuery] = useState("");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [editorValue, setEditorValue] = useState("");

  const [addName, setAddName] = useState("新实例");
  const [addRootPath, setAddRootPath] = useState("~/SillyTavern");

  const [vaultImportPath, setVaultImportPath] = useState("");
  const [vaultApplyDir, setVaultApplyDir] = useState("data/default-user/characters");
  const [vaultTagsDraft, setVaultTagsDraft] = useState<Record<string, string>>({});

  const [pluginGitRepo, setPluginGitRepo] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitMessage, setGitMessage] = useState("resource update");
  const [gitTarget, setGitTarget] = useState<"instance" | "vault">("instance");

  const selectedInstance = useMemo(
    () => instances.find((item) => item.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  );

  async function withBusy<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function loadInstances(): Promise<void> {
    const data = await apiGet<{ items: Instance[] }>("/api/instances");
    setInstances(data.items);
    if (!selectedInstanceId && data.items.length > 0) {
      setSelectedInstanceId(data.items[0].id);
    }
  }

  async function loadTree(instanceId: string): Promise<void> {
    const data = await apiGet<{ nodes: FileNode[] }>(`/api/instances/${instanceId}/tree`);
    setTreeNodes(data.nodes);
  }

  async function loadQueue(): Promise<void> {
    const data = await apiGet<{ items: QueueJob[] }>("/api/queue");
    setQueueJobs(data.items);
  }

  async function loadVault(): Promise<void> {
    const query = vaultQuery ? `?q=${encodeURIComponent(vaultQuery)}` : "";
    const data = await apiGet<{ items: VaultItem[] }>(`/api/vault/items${query}`);
    setVaultItems(data.items);
  }

  async function loadScan(instanceId: string): Promise<void> {
    const data = await apiPost<ScanResult>(`/api/instances/${instanceId}/scan`);
    setScanResult(data);
  }

  useEffect(() => {
    void withBusy(async () => {
      await Promise.all([loadInstances(), loadQueue(), loadVault()]);
      setMessage("初始化完成");
    });
  }, []);

  useEffect(() => {
    if (!selectedInstanceId) {
      return;
    }
    void withBusy(async () => {
      await loadTree(selectedInstanceId);
    });
  }, [selectedInstanceId]);

  async function openFile(relPath: string): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const data = await apiGet<LoadedFile>(
        `/api/instances/${selectedInstanceId}/file?path=${encodeURIComponent(relPath)}`
      );
      setFile(data);
      setEditorValue(data.content);
      setMessage(`已打开 ${relPath}`);
    });
  }

  async function saveFile(): Promise<void> {
    if (!selectedInstanceId || !file) {
      return;
    }
    await withBusy(async () => {
      const data = await apiPut<{ queued?: boolean; backupPath?: string }>(
        `/api/instances/${selectedInstanceId}/file`,
        {
          relPath: file.relPath,
          content: editorValue,
          queueIfRunning: true,
          createBackup: true
        }
      );
      if (data.queued) {
        setMessage("SillyTavern 运行中，写入已加入队列");
      } else {
        setMessage(`保存完成${data.backupPath ? "（已备份）" : ""}`);
      }
      await loadQueue();
      await loadTree(selectedInstanceId);
    });
  }

  async function addInstance(): Promise<void> {
    await withBusy(async () => {
      await apiPost("/api/instances", { name: addName, rootPath: addRootPath });
      await loadInstances();
      setMessage("实例已添加");
    });
  }

  async function importInstanceZip(fileObj: File): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const form = new FormData();
      form.append("file", fileObj);
      await apiPost(`/api/instances/${selectedInstanceId}/import/zip`, form);
      setMessage("ZIP 导入成功");
      await loadTree(selectedInstanceId);
    });
  }

  async function exportInstanceZip(): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      await downloadZip(
        `/api/instances/${selectedInstanceId}/export/zip`,
        {},
        `instance-${selectedInstanceId}.zip`
      );
      setMessage("导出完成");
    });
  }

  async function installPluginZip(fileObj: File): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const form = new FormData();
      form.append("file", fileObj);
      await apiPost(`/api/instances/${selectedInstanceId}/plugins/install`, form);
      setMessage("插件 ZIP 安装完成");
      await loadTree(selectedInstanceId);
    });
  }

  async function installPluginGit(): Promise<void> {
    if (!selectedInstanceId || !pluginGitRepo.trim()) {
      return;
    }
    await withBusy(async () => {
      await apiPost(`/api/instances/${selectedInstanceId}/plugins/install`, {
        repoUrl: pluginGitRepo.trim()
      });
      setMessage("插件 Git 安装完成");
      await loadTree(selectedInstanceId);
    });
  }

  async function importVaultZip(fileObj: File): Promise<void> {
    await withBusy(async () => {
      const form = new FormData();
      form.append("file", fileObj);
      await apiPost("/api/vault/import/zip", form);
      setMessage("Vault ZIP 导入完成");
      await loadVault();
    });
  }

  async function importVaultPath(): Promise<void> {
    if (!vaultImportPath.trim()) {
      return;
    }
    await withBusy(async () => {
      await apiPost("/api/vault/import/path", { sourcePath: vaultImportPath.trim(), tags: [] });
      setMessage("Vault 路径导入完成");
      setVaultImportPath("");
      await loadVault();
    });
  }

  async function applyVaultItem(itemId: string): Promise<void> {
    if (!selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      await apiPost(`/api/vault/items/${itemId}/apply`, {
        instanceId: selectedInstanceId,
        targetRelDir: vaultApplyDir,
        mode: "copy_once"
      });
      setMessage("素材已复制到实例目录");
      await loadTree(selectedInstanceId);
    });
  }

  async function updateVaultMeta(item: VaultItem): Promise<void> {
    const tags = (vaultTagsDraft[item.id] ?? item.tags.join(","))
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    await withBusy(async () => {
      await apiPatch(`/api/vault/items/${item.id}/meta`, {
        tags,
        favorite: item.favorite
      });
      setMessage("素材元数据已更新");
      await loadVault();
    });
  }

  async function toggleVaultFavorite(item: VaultItem): Promise<void> {
    await withBusy(async () => {
      await apiPatch(`/api/vault/items/${item.id}/meta`, {
        favorite: !item.favorite
      });
      await loadVault();
    });
  }

  async function deleteVaultItem(itemId: string): Promise<void> {
    await withBusy(async () => {
      await apiDelete(`/api/vault/items/${itemId}`);
      setMessage("素材已删除");
      await loadVault();
    });
  }

  async function runGitClone(): Promise<void> {
    if (!gitRepoUrl.trim()) {
      return;
    }
    if (gitTarget === "instance" && !selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const endpoint =
        gitTarget === "vault"
          ? "/api/vault/git/clone"
          : `/api/instances/${selectedInstanceId}/git/clone`;
      await apiPost(endpoint, {
        repoUrl: gitRepoUrl.trim(),
        branch: gitBranch.trim() || undefined
      });
      setMessage("Git clone 完成");
    });
  }

  async function runGitCommit(): Promise<void> {
    if (gitTarget === "instance" && !selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const endpoint =
        gitTarget === "vault"
          ? "/api/vault/git/commit"
          : `/api/instances/${selectedInstanceId}/git/commit`;
      const res = await apiPost<{ commit?: string }>(endpoint, {
        message: gitMessage
      });
      setMessage(`Git commit 完成: ${res.commit ?? "无变更"}`);
    });
  }

  async function runGitPull(): Promise<void> {
    if (gitTarget === "instance" && !selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const endpoint =
        gitTarget === "vault"
          ? "/api/vault/git/pull"
          : `/api/instances/${selectedInstanceId}/git/pull`;
      await apiPost(endpoint);
      setMessage("Git pull 完成");
      if (selectedInstanceId) {
        await loadTree(selectedInstanceId);
      }
    });
  }

  async function runGitPush(): Promise<void> {
    if (gitTarget === "instance" && !selectedInstanceId) {
      return;
    }
    await withBusy(async () => {
      const endpoint =
        gitTarget === "vault"
          ? "/api/vault/git/push"
          : `/api/instances/${selectedInstanceId}/git/push`;
      await apiPost(endpoint, {
        message: gitMessage
      });
      setMessage("Git push 完成");
    });
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Termux 私有目录 · 本机 127.0.0.1</p>
          <h1>ST 资源管理器 + Vault</h1>
          <p className="subtitle">不打开 SillyTavern 也能管理资源、插件、导入导出与素材库。</p>
        </div>
        <div className="status">{busy ? "执行中..." : message}</div>
      </header>

      <section className="card">
        <div className="row">
          <label>当前实例</label>
          <select
            value={selectedInstanceId}
            onChange={(e) => setSelectedInstanceId(e.target.value)}
            className="input"
          >
            <option value="">请选择</option>
            {instances.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.isRunning ? "运行中" : "未运行"})
              </option>
            ))}
          </select>
          <button type="button" className="btn ghost" onClick={() => void withBusy(loadInstances)}>
            刷新实例
          </button>
        </div>
        {selectedInstance ? (
          <p className="hint">
            路径: <code>{selectedInstance.rootPath}</code> · 布局: {selectedInstance.layoutType}
          </p>
        ) : null}
        <div className="inline-form">
          <input
            className="input"
            placeholder="实例名称"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
          />
          <input
            className="input"
            placeholder="实例根目录"
            value={addRootPath}
            onChange={(e) => setAddRootPath(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => void addInstance()}>
            新增实例
          </button>
        </div>
      </section>

      <nav className="tabs">
        {([
          ["instance", "实例文件"],
          ["scan", "资源扫描"],
          ["vault", "Vault 素材库"],
          ["queue", "写入队列"],
          ["git", "Git 同步"]
        ] as Array<[TabKey, string]>).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "instance" ? (
        <section className="grid-two">
          <article className="card panel">
            <div className="row space">
              <h2>文件树</h2>
              <button
                type="button"
                className="btn ghost"
                onClick={() => selectedInstanceId && void withBusy(() => loadTree(selectedInstanceId))}
              >
                刷新
              </button>
            </div>
            <div className="row">
              <label className="file-picker">
                导入 ZIP
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      void importInstanceZip(f);
                    }
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <button type="button" className="btn" onClick={() => void exportInstanceZip()}>
                导出 ZIP
              </button>
            </div>
            <div className="row">
              <label className="file-picker">
                安装插件 ZIP
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      void installPluginZip(f);
                    }
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <div className="inline-form">
              <input
                className="input"
                placeholder="插件 Git 仓库地址"
                value={pluginGitRepo}
                onChange={(e) => setPluginGitRepo(e.target.value)}
              />
              <button type="button" className="btn" onClick={() => void installPluginGit()}>
                安装 Git 插件
              </button>
            </div>
            <div className="tree-wrap">
              <TreeNodeList
                nodes={treeNodes}
                onPick={(node) => {
                  if (!node.isDir) {
                    void openFile(node.relPath);
                  }
                }}
              />
            </div>
          </article>

          <article className="card panel">
            <div className="row space">
              <h2>编辑器</h2>
              <button type="button" className="btn" disabled={!file || file.readOnly} onClick={() => void saveFile()}>
                保存
              </button>
            </div>
            {file ? (
              <>
                <p className="hint">
                  <code>{file.relPath}</code> · {formatSize(file.size)} ·{" "}
                  {file.readOnly ? "只读(大文件)" : "可编辑"}
                </p>
                <div className="editor-wrap">
                  <CodeMirror
                    value={editorValue}
                    height="420px"
                    editable={!file.readOnly}
                    extensions={isJsonFile(file.relPath) ? [jsonLang()] : []}
                    onChange={(value) => setEditorValue(value)}
                  />
                </div>
              </>
            ) : (
              <p className="hint">点击左侧文件后在这里查看/编辑内容。</p>
            )}
          </article>
        </section>
      ) : null}

      {tab === "scan" ? (
        <section className="card panel">
          <div className="row space">
            <h2>资源扫描</h2>
            <button
              type="button"
              className="btn"
              onClick={() => selectedInstanceId && void withBusy(() => loadScan(selectedInstanceId))}
            >
              开始扫描
            </button>
          </div>
          {scanResult ? (
            <>
              <p className="hint">总计: {scanResult.total}</p>
              <div className="chips">
                {Object.entries(scanResult.summary).map(([type, count]) => (
                  <span key={type} className="chip">
                    {type}: {count}
                  </span>
                ))}
              </div>
              <div className="list compact">
                {scanResult.items.slice(0, 300).map((item) => (
                  <div key={item.relPath} className="list-item">
                    <code>{item.relPath}</code>
                    <span>{item.type}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">点击“开始扫描”获取资源统计。</p>
          )}
        </section>
      ) : null}

      {tab === "vault" ? (
        <section className="card panel">
          <div className="row space">
            <h2>Vault 素材库</h2>
            <button type="button" className="btn ghost" onClick={() => void withBusy(loadVault)}>
              刷新
            </button>
          </div>
          <div className="inline-form">
            <input
              className="input"
              placeholder="搜索标题/标签/路径"
              value={vaultQuery}
              onChange={(e) => setVaultQuery(e.target.value)}
            />
            <button type="button" className="btn" onClick={() => void withBusy(loadVault)}>
              搜索
            </button>
          </div>
          <div className="row">
            <label className="file-picker">
              导入 Vault ZIP
              <input
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void importVaultZip(f);
                  }
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void withBusy(async () => {
                  await downloadZip("/api/vault/export/zip", {}, "vault-export.zip");
                  setMessage("Vault 导出完成");
                })
              }
            >
              导出 Vault ZIP
            </button>
          </div>
          <div className="inline-form">
            <input
              className="input"
              placeholder="从本机路径导入到 Vault（Termux 可见路径）"
              value={vaultImportPath}
              onChange={(e) => setVaultImportPath(e.target.value)}
            />
            <button type="button" className="btn" onClick={() => void importVaultPath()}>
              路径导入
            </button>
          </div>
          <div className="inline-form">
            <input
              className="input"
              placeholder="取用目标目录（相对实例根目录）"
              value={vaultApplyDir}
              onChange={(e) => setVaultApplyDir(e.target.value)}
            />
          </div>
          <div className="list">
            {vaultItems.map((item) => (
              <div key={item.id} className="vault-item">
                <div className="row space">
                  <strong>{item.title}</strong>
                  <div className="row">
                    <button type="button" className="btn ghost" onClick={() => void toggleVaultFavorite(item)}>
                      {item.favorite ? "已收藏" : "收藏"}
                    </button>
                    <button type="button" className="btn" onClick={() => void applyVaultItem(item.id)}>
                      一键取用
                    </button>
                    <button type="button" className="btn danger" onClick={() => void deleteVaultItem(item.id)}>
                      删除
                    </button>
                  </div>
                </div>
                <p className="hint">
                  <code>{item.relPath}</code> · {item.type}
                </p>
                <div className="inline-form">
                  <input
                    className="input"
                    value={vaultTagsDraft[item.id] ?? item.tags.join(",")}
                    onChange={(e) =>
                      setVaultTagsDraft((prev) => ({
                        ...prev,
                        [item.id]: e.target.value
                      }))
                    }
                    placeholder="标签，逗号分隔"
                  />
                  <button type="button" className="btn ghost" onClick={() => void updateVaultMeta(item)}>
                    更新标签
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "queue" ? (
        <section className="card panel">
          <div className="row space">
            <h2>写入队列</h2>
            <button type="button" className="btn ghost" onClick={() => void withBusy(loadQueue)}>
              刷新
            </button>
          </div>
          <div className="list">
            {queueJobs.length === 0 ? <p className="hint">暂无任务。</p> : null}
            {queueJobs.map((job) => (
              <div key={job.id} className="list-item">
                <div>
                  <strong>{job.type}</strong> · {job.status}
                  {job.reason ? ` · ${job.reason}` : ""}
                </div>
                <div className="row">
                  <small>{new Date(job.updatedAt).toLocaleString()}</small>
                  {(job.status === "pending" || job.status === "blocked") && (
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() =>
                        void withBusy(async () => {
                          await apiPost(`/api/queue/${job.id}/cancel`);
                          await loadQueue();
                        })
                      }
                    >
                      取消
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "git" ? (
        <section className="card panel">
          <h2>Git 导入导出</h2>
          <div className="row">
            <label>同步对象</label>
            <select
              className="input"
              value={gitTarget}
              onChange={(e) => setGitTarget(e.target.value as "instance" | "vault")}
            >
              <option value="instance">实例库</option>
              <option value="vault">Vault 素材库</option>
            </select>
          </div>
          <div className="inline-form">
            <input
              className="input"
              placeholder="远程仓库 URL"
              value={gitRepoUrl}
              onChange={(e) => setGitRepoUrl(e.target.value)}
            />
            <input
              className="input"
              placeholder="分支"
              value={gitBranch}
              onChange={(e) => setGitBranch(e.target.value)}
            />
            <button type="button" className="btn" onClick={() => void runGitClone()}>
              Clone
            </button>
          </div>
          <div className="inline-form">
            <input
              className="input"
              placeholder="提交信息"
              value={gitMessage}
              onChange={(e) => setGitMessage(e.target.value)}
            />
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => void runGitCommit()}>
              Commit
            </button>
            <button type="button" className="btn" onClick={() => void runGitPull()}>
              Pull
            </button>
            <button type="button" className="btn" onClick={() => void runGitPush()}>
              Push
            </button>
          </div>
          <p className="hint">Git 操作使用镜像仓库，不直接污染 SillyTavern 原目录的 .git。</p>
        </section>
      ) : null}
    </div>
  );
}
