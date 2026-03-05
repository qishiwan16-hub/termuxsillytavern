import React from "react";
import type { PanelKey, ResourceStatItem } from "../types";

interface HomeCenterRow {
  label: string;
  value: number;
  panel?: PanelKey;
}

interface HomePageProps {
  profileAvatar: string;
  profileName: string;
  profileInitials: string;
  projectName: string;
  projectRunning: boolean;
  queueHealth: number;
  version?: string;
  queueTotal: number;
  queueFailed: number;
  updatedAt?: string;
  homeCenterRows: HomeCenterRow[];
  homeStatsTop: ResourceStatItem[];
  hasResource: boolean;
  onOpenProfile: () => void;
  onRefresh: () => void;
  onOpenPanel: (panel: PanelKey) => void;
  formatDate: (value?: string) => string;
}

export function HomePage(props: HomePageProps): React.ReactNode {
  const resourceTotal = props.homeCenterRows.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="m-home-page">
      <section className="m-home-hero">
        <div className="m-home-hero-shell">
          <div className="m-home-hero-meta">
            <p className="m-home-hero-net">酒馆资源</p>
            <p className="m-home-hero-power">{props.projectRunning ? "在线" : "离线"}</p>
          </div>

          <div className="m-home-hero-top">
            <div className="m-home-user">
              <button type="button" className="m-profile-trigger" onClick={props.onOpenProfile} aria-label="打开个人资料">
                {props.profileAvatar ? <img src={props.profileAvatar} alt="头像" /> : <span>{props.profileInitials}</span>}
              </button>
              <div className="m-home-user-card">
                <h2 className="m-home-user-name m-break">{props.profileName || "未命名用户"}</h2>
                <p className="m-home-user-meta m-break">IP：{props.projectName || "未设置项目"}</p>
                <p className="m-home-user-stats">队列任务 {props.queueTotal} · 失败 {props.queueFailed}</p>
              </div>
            </div>
            <div className="m-home-hero-actions">
              <button type="button" className="m-home-action-btn m-home-action-btn-light" onClick={props.onRefresh}>
                Share
              </button>
              <button type="button" className="m-home-action-btn m-home-action-btn-dark" onClick={props.onOpenProfile}>
                Use Template
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="m-home-metrics">
        <div className="m-home-metric">
          <p className="m-home-metric-label">队列健康度</p>
          <p className="m-home-metric-value">
            {props.queueHealth}
            <span>%</span>
          </p>
        </div>

        <div className="m-home-metric">
          <p className="m-home-metric-label">资源总数</p>
          <p className="m-home-metric-value">{resourceTotal.toLocaleString("zh-CN")}</p>
        </div>
      </section>

      <article className="m-home-rec">
        <p className="m-home-rec-label">
          <span className="dot" />
          REC
        </p>
        <p className="m-home-rec-title">系统记录</p>
        <div className="m-home-rec-grid">
          <button type="button" onClick={() => props.onOpenPanel("git")}>
            <span>最近同步</span>
            <strong>{props.formatDate(props.updatedAt)}</strong>
          </button>
          <button type="button" onClick={() => props.onOpenPanel("settings")}>
            <span>项目版本</span>
            <strong>{props.version ?? "unknown"}</strong>
          </button>
          <button type="button" onClick={() => props.onOpenPanel("git")}>
            <span>队列任务</span>
            <strong>{props.queueTotal}</strong>
          </button>
          <button type="button" onClick={() => props.onOpenPanel("queue")}>
            <span>失败任务</span>
            <strong>{props.queueFailed}</strong>
          </button>
        </div>
      </article>

      <section className="m-home-cockpit">
        <article className="m-home-cockpit-card">
          <div className="m-home-cockpit-head">
            <p className="m-home-cockpit-eyebrow">资源管理</p>
            <span>分类入口</span>
          </div>
          <h3>酒馆资源</h3>
          {props.hasResource ? (
            <ul className="m-home-cockpit-list m-home-cockpit-list-action">
              {props.homeCenterRows.map((item) => (
                <li key={item.label}>
                  <button type="button" className="m-home-category-btn" onClick={() => props.onOpenPanel(item.panel ?? "resources")}>
                    <span>{item.label}</span>
                    <strong>{item.value.toLocaleString("zh-CN")}</strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-home-cockpit-empty">当前暂无资源</p>
          )}
        </article>

        <button type="button" className="m-home-cockpit-card" onClick={() => props.onOpenPanel("resources")}>
          <div className="m-home-cockpit-head">
            <p className="m-home-cockpit-eyebrow">分类数量</p>
            <span>查看</span>
          </div>
          <h3>酒馆分类</h3>
          {props.homeStatsTop.length > 0 ? (
            <ul className="m-home-cockpit-list">
              {props.homeStatsTop.map((item) => (
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

      <section className="m-home-cloud-strip">
        <button type="button" className="m-home-cloud-btn" onClick={() => props.onOpenPanel("cloud")}>
          <span className="m-home-cloud-title">云端存储</span>
          <span className="m-home-cloud-sub">云盘 ZIP / Git 仓库 双模式兼容</span>
        </button>
      </section>
    </section>
  );
}
