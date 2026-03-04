import React from "react";
import type { AppSettings, PanelKey, QueueJob, ResourceResp, Source } from "../../types";

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
      : props.activePanel === "queue"
        ? "写入队列"
        : props.activePanel === "git"
          ? "Git 同步"
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
