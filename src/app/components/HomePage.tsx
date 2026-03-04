import React from "react";
import type { PanelKey, ResourceStatItem } from "../types";

interface HomeCenterRow {
  label: string;
  value: number;
}

interface HomePageProps {
  profileAvatar: string;
  profileName: string;
  profileInitials: string;
  projectName: string;
  projectRunning: boolean;
  queueHealth: number;
  resourceTotal: number;
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
  return (
    <section className="m-home-page">
      <section className="m-home-hero">
        <div className="m-home-hero-top">
          <div className="m-home-user">
            <button type="button" className="m-profile-trigger" onClick={props.onOpenProfile} aria-label="打开个人资料">
              {props.profileAvatar ? <img src={props.profileAvatar} alt="头像" /> : <span>{props.profileInitials}</span>}
            </button>
            <div className="m-home-user-text">
              <p className="m-home-owner">{props.profileName}</p>
              <h2 className="m-home-name">{props.projectName}</h2>
              <p className="m-home-sub">
                {props.projectRunning ? "当前酒馆项目（运行中）" : "当前酒馆项目（未运行）"}
              </p>
            </div>
          </div>
          <button type="button" className="m-home-close" onClick={props.onRefresh} aria-label="刷新">
            刷新
          </button>
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
          <p className="m-home-metric-value">{props.resourceTotal.toLocaleString("zh-CN")}</p>
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
        <button type="button" className="m-home-cockpit-card" onClick={() => props.onOpenPanel("resources")}>
          <div className="m-home-cockpit-head">
            <p className="m-home-cockpit-eyebrow">资源管理</p>
            <span>进入</span>
          </div>
          <h3>资源中心</h3>
          {props.hasResource ? (
            <ul className="m-home-cockpit-list">
              {props.homeCenterRows.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value.toLocaleString("zh-CN")}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-home-cockpit-empty">当前暂无资源</p>
          )}
        </button>

        <button type="button" className="m-home-cockpit-card" onClick={() => props.onOpenPanel("resources")}>
          <div className="m-home-cockpit-head">
            <p className="m-home-cockpit-eyebrow">分类数量</p>
            <span>查看</span>
          </div>
          <h3>资源分类</h3>
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
    </section>
  );
}
