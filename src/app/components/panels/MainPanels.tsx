import React, { useState } from "react";
import type {
  AppSettings,
  CharacterCardItem,
  PanelKey,
  PresetBasicSettings,
  PresetFileItem,
  QueueJob,
  ResourceResp,
  Source
} from "../../types";

interface PanelShellProps {
  activePanel: PanelKey | null;
  onClose: () => void;
  onRefresh: () => void;
  children: React.ReactNode;
}

export function PanelShell(props: PanelShellProps): React.ReactNode {
  if (!props.activePanel) return null;
  const title =
    props.activePanel === "resources"
      ? "资源管理"
      : props.activePanel === "character"
        ? "角色卡"
        : props.activePanel === "preset"
          ? "预设管理"
        : props.activePanel === "queue"
          ? "写入队列"
          : props.activePanel === "git"
            ? "Git 同步"
            : props.activePanel === "cloud"
              ? "云端存储"
              : "系统设置";

  return (
    <section className="m-panel-page">
      <header className="m-panel-top">
        <button type="button" className="m-btn m-btn-ghost" onClick={props.onClose}>
          返回首页
        </button>
        <h2>{title}</h2>
        <button type="button" className="m-btn" onClick={props.onRefresh}>
          刷新
        </button>
      </header>

      <div className="m-panel-content">{props.children}</div>
    </section>
  );
}

interface ResourcesPanelProps {
  source: Source;
  query: string;
  resources: ResourceResp;
  selectedIds: string[];
  onSourceChange: (value: Source) => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelectPage: () => void;
  onBatchApply: () => void;
  onBatchExport: () => void;
  onBatchDelete: () => void;
  onToggleSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

export function ResourcesPanel(props: ResourcesPanelProps): React.ReactNode {
  return (
    <section className="m-card">
      <h2>资源管理</h2>
      <div className="m-actions-row">
        <select className="m-input" value={props.source} onChange={(event) => props.onSourceChange(event.target.value as Source)}>
          <option value="all">全部</option>
          <option value="instance">酒馆项目</option>
          <option value="vault">Vault</option>
        </select>
        <input className="m-input" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="关键词" />
        <button type="button" className="m-btn" onClick={props.onSearch}>
          搜索
        </button>
      </div>
      <p className="m-muted">
        总数 {props.resources.total} · 酒馆项目 {props.resources.sourceSummary.instance} · Vault{" "}
        {props.resources.sourceSummary.vault}
      </p>

      <div className="m-actions-row">
        <button type="button" className="m-btn m-btn-ghost" onClick={props.onSelectPage}>
          选择本页
        </button>
        <button type="button" className="m-btn" onClick={props.onBatchApply}>
          批量取用
        </button>
        <button type="button" className="m-btn m-btn-ghost" onClick={props.onBatchExport}>
          导出 ZIP
        </button>
        <button type="button" className="m-btn m-btn-danger" onClick={props.onBatchDelete}>
          删除
        </button>
      </div>

      <ul className="m-list-clean">
        {props.resources.items.map((item) => (
          <li key={item.id} className="m-resource-card">
            <p className="m-muted">{item.title}</p>
            <p className="m-muted m-break">{item.relPath}</p>
            <div className="m-actions-row">
              <label className="m-check">
                <input
                  type="checkbox"
                  checked={props.selectedIds.includes(item.id)}
                  onChange={() => props.onToggleSelect(item.id)}
                />
                选择
              </label>
              {item.source === "vault" ? (
                <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onToggleFavorite(item.id)}>
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

interface CharacterPanelProps {
  baseRelDir: string;
  loading: boolean;
  cards: CharacterCardItem[];
  selectedRelPath: string;
  onRefresh: () => void;
  onEnterCard: (relPath: string) => void;
}

function toReadableSize(size?: number): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function toCardDisplayName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || filename;
}

export function CharacterPanel(props: CharacterPanelProps): React.ReactNode {
  return (
    <section className="m-card">
      <h2>角色卡管理</h2>
      <p className="m-muted m-break">目录：{props.baseRelDir ? `data/<user>/${props.baseRelDir}` : "未检测到 data/<user>/characters"}</p>
      <div className="m-actions-row">
        <button type="button" className="m-btn m-btn-ghost" onClick={props.onRefresh}>
          刷新角色卡
        </button>
        <span className="m-muted">可识别文件：{props.cards.length}</span>
      </div>

      <ul className="m-list-clean m-character-list m-character-list-full">
        {props.cards.length > 0 ? (
          props.cards.map((item) => {
            const displayName = toCardDisplayName(item.name);
            return (
              <li key={item.relPath}>
                <button
                  type="button"
                  className={`m-character-item-btn ${props.selectedRelPath === item.relPath ? "active" : ""}`}
                  onClick={() => props.onEnterCard(item.relPath)}
                >
                  {item.imageUrl ? (
                    <img className="m-character-cover" src={item.imageUrl} alt={`${displayName} 角色卡`} loading="lazy" />
                  ) : (
                    <div className="m-character-cover m-character-cover-placeholder" aria-hidden="true">
                      <span>NO IMAGE</span>
                    </div>
                  )}
                  <div className="m-character-info">
                    <div className="m-character-fields">
                      <p className="m-character-field-label">姓名 / NAME</p>
                      <p className="m-character-field-value m-break">{displayName}</p>
                      <p className="m-character-field-label">性别 / SEX</p>
                      <p className="m-character-field-value">{item.cardType}</p>
                      <p className="m-character-field-label">籍贯 / NATIVE</p>
                      <p className="m-character-field-value">{toReadableSize(item.size)}</p>
                    </div>
                    <span className="m-character-item-cta">点击进入</span>
                  </div>
                </button>
              </li>
            );
          })
        ) : (
          <li className="m-muted">{props.loading ? "正在读取角色卡目录..." : "当前目录暂无可识别角色卡文件"}</li>
        )}
      </ul>
    </section>
  );
}

interface PresetPanelProps {
  baseRelDir: string;
  files: PresetFileItem[];
  selectedRelPath: string;
  readOnly: boolean;
  rawError: string;
  settings: PresetBasicSettings;
  onRefresh: () => void;
  onSelectFile: (relPath: string) => void;
  onPatchSettings: (patch: Partial<PresetBasicSettings>) => void;
  onSave: () => void;
}

export function PresetPanel(props: PresetPanelProps): React.ReactNode {
  const selectedFileName = props.selectedRelPath.split("/").pop() ?? "";

  return (
    <section className="m-card">
      <h2>OpenAI 预设</h2>
      <p className="m-muted m-break">目录：{props.baseRelDir || "未找到 OpenAI Settings 目录"}</p>
      <div className="m-actions-row">
        <button type="button" className="m-btn m-btn-ghost" onClick={props.onRefresh}>
          刷新预设
        </button>
        <button
          type="button"
          className="m-btn"
          onClick={props.onSave}
          disabled={!props.selectedRelPath || Boolean(props.rawError) || props.readOnly}
        >
          保存预设
        </button>
      </div>

      <div className="m-preset-layout">
        <article className="m-preset-pane">
          <p className="m-muted">预设条目</p>
          <ul className="m-list-clean m-preset-file-list">
            {props.files.length > 0 ? (
              props.files.map((item) => (
                <li key={item.relPath}>
                  <button
                    type="button"
                    className={`m-preset-file-btn ${props.selectedRelPath === item.relPath ? "active" : ""}`}
                    onClick={() => props.onSelectFile(item.relPath)}
                  >
                    <span className="m-break">{item.name}</span>
                    <strong>{typeof item.size === "number" ? `${Math.max(1, Math.round(item.size / 1024))} KB` : "-"}</strong>
                  </button>
                </li>
              ))
            ) : (
              <li className="m-muted">当前目录没有预设文件</li>
            )}
          </ul>
        </article>

        <article className="m-preset-pane">
          <p className="m-muted">基本设置{selectedFileName ? ` · ${selectedFileName}` : ""}</p>
          <div className="m-preset-setting-grid">
            <label>
              Temperature
              <input
                className="m-input"
                value={props.settings.temperature}
                onChange={(event) => props.onPatchSettings({ temperature: event.target.value })}
              />
            </label>
            <label>
              Top P
              <input
                className="m-input"
                value={props.settings.topP}
                onChange={(event) => props.onPatchSettings({ topP: event.target.value })}
              />
            </label>
            <label>
              Frequency Penalty
              <input
                className="m-input"
                value={props.settings.frequencyPenalty}
                onChange={(event) => props.onPatchSettings({ frequencyPenalty: event.target.value })}
              />
            </label>
            <label>
              Presence Penalty
              <input
                className="m-input"
                value={props.settings.presencePenalty}
                onChange={(event) => props.onPatchSettings({ presencePenalty: event.target.value })}
              />
            </label>
            <label>
              Max Context
              <input
                className="m-input"
                value={props.settings.maxContext}
                onChange={(event) => props.onPatchSettings({ maxContext: event.target.value })}
              />
            </label>
            <label>
              Max Response Tokens
              <input
                className="m-input"
                value={props.settings.maxResponseTokens}
                onChange={(event) => props.onPatchSettings({ maxResponseTokens: event.target.value })}
              />
            </label>
          </div>

          <label className="m-check">
            <input
              type="checkbox"
              checked={props.settings.streaming}
              onChange={(event) => props.onPatchSettings({ streaming: event.target.checked })}
            />
            启用流式输出
          </label>

        </article>
      </div>
    </section>
  );
}

interface QueuePanelProps {
  queue: QueueJob[];
}

export function QueuePanel(props: QueuePanelProps): React.ReactNode {
  return (
    <section className="m-card">
      <h2>写入队列</h2>
      <ul className="m-list-clean">
        {props.queue.map((job) => (
          <li key={job.id} className="m-resource-card">
            <p className="m-muted">
              {job.type} · {job.status} · {job.reason ?? "-"}
            </p>
            <p className="m-muted">{new Date(job.updatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface GitPanelProps {
  gitResult: string;
  onPullProject: () => void;
  onPullVault: () => void;
}

export function GitPanel(props: GitPanelProps): React.ReactNode {
  return (
    <section className="m-card">
      <h2>Git 同步</h2>
      <div className="m-actions-row">
        <button type="button" className="m-btn" onClick={props.onPullProject}>
          拉取项目
        </button>
        <button type="button" className="m-btn m-btn-ghost" onClick={props.onPullVault}>
          拉取 Vault
        </button>
      </div>
      <pre className="m-muted m-pre">{props.gitResult || "暂无输出"}</pre>
    </section>
  );
}

interface SettingsPanelProps {
  settings: AppSettings | null;
  authEnabled: boolean;
  authToggleBusy: boolean;
  requireEnablePassword: boolean;
  enablePassword: string;
  onEnablePasswordChange: (value: string) => void;
  onToggleLoginProtection: (enabled: boolean, password?: string) => void;
  onOpenProfile: () => void;
  onPatchSettings: (patch: Partial<AppSettings>) => void;
  onOpenLegacy: () => void;
}

export function SettingsPanel(props: SettingsPanelProps): React.ReactNode {
  return (
    <section className="m-card">
      <h2>系统设置</h2>
      <div className="m-setting-auth-box">
        <p className="m-muted">登录保护</p>
        <div className="m-setting-auth-row">
          <label className="m-check">
            <input
              type="checkbox"
              checked={props.authEnabled}
              disabled={props.authToggleBusy}
              onChange={(event) => props.onToggleLoginProtection(event.target.checked)}
            />
            登录需要密码
          </label>
          <span className="m-muted">{props.authEnabled ? "已开启" : "已关闭"}</span>
        </div>
        {!props.authEnabled && props.requireEnablePassword ? (
          <div className="m-actions-row">
            <input
              className="m-input"
              type="password"
              value={props.enablePassword}
              onChange={(event) => props.onEnablePasswordChange(event.target.value)}
              placeholder="输入当前密码后启用"
            />
            <button
              type="button"
              className="m-btn"
              disabled={props.authToggleBusy}
              onClick={() => props.onToggleLoginProtection(true, props.enablePassword)}
            >
              确认启用
            </button>
          </div>
        ) : null}
        <button type="button" className="m-link-btn" onClick={props.onOpenProfile}>
          修改密码与用户资料
        </button>
      </div>

      <div className="m-actions-row">
        <label className="m-check">
          <input
            type="checkbox"
            checked={props.settings?.autoOpenBrowser ?? false}
            onChange={(event) => props.onPatchSettings({ autoOpenBrowser: event.target.checked })}
          />
          自动打开浏览器
        </label>
        <label className="m-check">
          <input
            type="checkbox"
            checked={props.settings?.autoUpdateRepo ?? true}
            onChange={(event) => props.onPatchSettings({ autoUpdateRepo: event.target.checked })}
          />
          自动更新仓库
        </label>
        <label className="m-check">
          <input
            type="checkbox"
            checked={props.settings?.legacyUiEnabled ?? true}
            onChange={(event) => props.onPatchSettings({ legacyUiEnabled: event.target.checked })}
          />
          显示旧版入口
        </label>
      </div>

      <button type="button" className="m-btn m-btn-ghost" onClick={props.onOpenLegacy}>
        打开旧版界面
      </button>
    </section>
  );
}

interface CloudPanelProps {
  hasInstance: boolean;
  instanceName: string;
  cloudResult: string;
  onExportProjectZip: () => void;
  onImportProjectZip: (file: File, targetRelDir: string) => void;
  onExportVaultZip: () => void;
  onImportVaultZip: (file: File, tags: string) => void;
  onProjectClone: (repoUrl: string, branch: string) => void;
  onProjectPull: () => void;
  onProjectPush: (message: string) => void;
  onVaultClone: (repoUrl: string, branch: string) => void;
  onVaultPull: () => void;
  onVaultPush: (message: string) => void;
}

export function CloudPanel(props: CloudPanelProps): React.ReactNode {
  const [mode, setMode] = useState<"drive" | "git">("drive");
  const [projectImportDir, setProjectImportDir] = useState("");
  const [vaultTags, setVaultTags] = useState("");
  const [projectRepoUrl, setProjectRepoUrl] = useState("");
  const [projectBranch, setProjectBranch] = useState("");
  const [projectMessage, setProjectMessage] = useState("cloud sync");
  const [vaultRepoUrl, setVaultRepoUrl] = useState("");
  const [vaultBranch, setVaultBranch] = useState("");
  const [vaultMessage, setVaultMessage] = useState("vault cloud sync");

  return (
    <section className="m-card">
      <h2>云端存储</h2>
      <div className="m-cloud-mode">
        <button type="button" className={`m-btn ${mode === "drive" ? "" : "m-btn-ghost"}`} onClick={() => setMode("drive")}>
          云盘
        </button>
        <button type="button" className={`m-btn ${mode === "git" ? "" : "m-btn-ghost"}`} onClick={() => setMode("git")}>
          Git 仓库
        </button>
      </div>

      {mode === "drive" ? (
        <div className="m-cloud-grid">
          <article className="m-cloud-card">
            <h3>云盘同步 · 酒馆项目</h3>
            <p className="m-muted">适合走 ZIP 备份到网盘，支持导出和导入。</p>
            <input
              className="m-input"
              value={projectImportDir}
              onChange={(event) => setProjectImportDir(event.target.value)}
              placeholder="导入目标目录（可空）"
            />
            <div className="m-actions-row">
              <button type="button" className="m-btn" onClick={props.onExportProjectZip} disabled={!props.hasInstance}>
                导出项目 ZIP
              </button>
              <label className="m-file-btn">
                导入项目 ZIP
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    props.onImportProjectZip(file, projectImportDir);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </article>

          <article className="m-cloud-card">
            <h3>云盘同步 · Vault</h3>
            <p className="m-muted">适合素材库整体备份到网盘，支持导出和导入。</p>
            <input
              className="m-input"
              value={vaultTags}
              onChange={(event) => setVaultTags(event.target.value)}
              placeholder="导入时附加标签（逗号分隔）"
            />
            <div className="m-actions-row">
              <button type="button" className="m-btn" onClick={props.onExportVaultZip}>
                导出 Vault ZIP
              </button>
              <label className="m-file-btn">
                导入 Vault ZIP
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    props.onImportVaultZip(file, vaultTags);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </article>
        </div>
      ) : (
        <div className="m-cloud-grid">
          <article className="m-cloud-card">
            <h3>Git 仓库 · 酒馆项目</h3>
            <p className="m-muted">当前项目：{props.instanceName}</p>
            <input
              className="m-input"
              value={projectRepoUrl}
              onChange={(event) => setProjectRepoUrl(event.target.value)}
              placeholder="仓库地址（https://...git）"
            />
            <input
              className="m-input"
              value={projectBranch}
              onChange={(event) => setProjectBranch(event.target.value)}
              placeholder="分支（可空）"
            />
            <input
              className="m-input"
              value={projectMessage}
              onChange={(event) => setProjectMessage(event.target.value)}
              placeholder="推送说明"
            />
            <div className="m-actions-row">
              <button type="button" className="m-btn" disabled={!props.hasInstance} onClick={() => props.onProjectClone(projectRepoUrl, projectBranch)}>
                连接仓库
              </button>
              <button type="button" className="m-btn m-btn-ghost" disabled={!props.hasInstance} onClick={props.onProjectPull}>
                拉取
              </button>
              <button type="button" className="m-btn m-btn-ghost" disabled={!props.hasInstance} onClick={() => props.onProjectPush(projectMessage)}>
                推送
              </button>
            </div>
          </article>

          <article className="m-cloud-card">
            <h3>Git 仓库 · Vault</h3>
            <p className="m-muted">用于同步你的素材仓库。</p>
            <input
              className="m-input"
              value={vaultRepoUrl}
              onChange={(event) => setVaultRepoUrl(event.target.value)}
              placeholder="仓库地址（https://...git）"
            />
            <input
              className="m-input"
              value={vaultBranch}
              onChange={(event) => setVaultBranch(event.target.value)}
              placeholder="分支（可空）"
            />
            <input
              className="m-input"
              value={vaultMessage}
              onChange={(event) => setVaultMessage(event.target.value)}
              placeholder="推送说明"
            />
            <div className="m-actions-row">
              <button type="button" className="m-btn" onClick={() => props.onVaultClone(vaultRepoUrl, vaultBranch)}>
                连接仓库
              </button>
              <button type="button" className="m-btn m-btn-ghost" onClick={props.onVaultPull}>
                拉取
              </button>
              <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onVaultPush(vaultMessage)}>
                推送
              </button>
            </div>
          </article>
        </div>
      )}

      <pre className="m-muted m-pre">{props.cloudResult || "暂无云端同步输出"}</pre>
    </section>
  );
}
