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
  onOpenPanel: (panel: PanelKey) => void;
  formatDate: (value?: string) => string;
}

export function HomePage(props: HomePageProps): React.ReactNode {
  const resourceTotal = props.homeCenterRows.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="m-home-page">
      <section className="m-home-hero">
        <div className="m-home-hero-shell hero-card">
          <div className="m-home-hero-main hero-main">
            <div className="m-home-hero-copy">
              <p className="m-home-hero-kicker">{props.projectRunning ? "\u5728\u7ebf" : "\u79bb\u7ebf"}</p>
              <h2 className="m-home-user-name m-break">{props.profileName || "\u672a\u547d\u540d\u7528\u6237"}</h2>
              <p className="m-home-user-meta m-break">{"IP\uff1a"}{props.projectName || "\u672a\u8bbe\u7f6e\u9879\u76ee"}</p>
            </div>

            <button
              type="button"
              className="m-profile-trigger m-home-hero-avatar hero-avatar"
              onClick={props.onOpenProfile}
              aria-label="\u6253\u5f00\u4e2a\u4eba\u8d44\u6599"
            >
              {props.profileAvatar ? <img src={props.profileAvatar} alt="\u5934\u50cf" /> : <span>{props.profileInitials}</span>}
            </button>
          </div>

          <div className="m-home-hero-meta hero-meta">
            <span className="m-home-hero-pill">{"\u961f\u5217\u4efb\u52a1 "}{props.queueTotal}</span>
            <span className="m-home-hero-pill">{"\u5931\u8d25 "}{props.queueFailed}</span>
          </div>
        </div>
      </section>

      <section className="m-home-metrics">
        <div className="m-home-metric">
          <p className="m-home-metric-label">{"\u961f\u5217\u5065\u5eb7\u5ea6"}</p>
          <p className="m-home-metric-value">
            {props.queueHealth}
            <span>%</span>
          </p>
        </div>

        <div className="m-home-metric">
          <p className="m-home-metric-label">{"\u8d44\u6e90\u603b\u6570"}</p>
          <p className="m-home-metric-value">{resourceTotal.toLocaleString("zh-CN")}</p>
        </div>
      </section>

      <article className="m-home-rec">
        <p className="m-home-rec-label">
          <span className="dot" />
          REC
        </p>
        <p className="m-home-rec-title">{"\u7cfb\u7edf\u8bb0\u5f55"}</p>
        <div className="m-home-rec-grid">
          <button type="button" onClick={() => props.onOpenPanel("git")}>
            <span>{"\u6700\u8fd1\u540c\u6b65"}</span>
            <strong>{props.formatDate(props.updatedAt)}</strong>
          </button>
          <button type="button" onClick={() => props.onOpenPanel("settings")}>
            <span>{"\u9879\u76ee\u7248\u672c"}</span>
            <strong>{props.version ?? "unknown"}</strong>
          </button>
          <button type="button" onClick={() => props.onOpenPanel("git")}>
            <span>{"\u961f\u5217\u4efb\u52a1"}</span>
            <strong>{props.queueTotal}</strong>
          </button>
          <button type="button" onClick={() => props.onOpenPanel("queue")}>
            <span>{"\u5931\u8d25\u4efb\u52a1"}</span>
            <strong>{props.queueFailed}</strong>
          </button>
        </div>
      </article>

      <section className="m-home-cockpit">
        <article className="m-home-cockpit-card">
          <div className="m-home-cockpit-head">
            <p className="m-home-cockpit-eyebrow">{"\u8d44\u6e90\u7ba1\u7406"}</p>
            <span>{"\u5206\u7c7b\u5165\u53e3"}</span>
          </div>
          <h3>{"\u9152\u9986\u8d44\u6e90"}</h3>
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
            <p className="m-home-cockpit-empty">{"\u5f53\u524d\u6682\u65e0\u8d44\u6e90"}</p>
          )}
        </article>

        <button type="button" className="m-home-cockpit-card" onClick={() => props.onOpenPanel("resources")}>
          <div className="m-home-cockpit-head">
            <p className="m-home-cockpit-eyebrow">{"\u5206\u7c7b\u6570\u91cf"}</p>
            <span>{"\u67e5\u770b"}</span>
          </div>
          <h3>{"\u9152\u9986\u5206\u7c7b"}</h3>
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
            <p className="m-home-cockpit-empty">{"\u6682\u65e0\u8bb0\u5f55"}</p>
          )}
        </button>
      </section>

      <section className="m-home-cloud-strip">
        <button type="button" className="m-home-cloud-btn" onClick={() => props.onOpenPanel("cloud")}>
          <span className="m-home-cloud-title">{"\u4e91\u7aef\u5b58\u50a8"}</span>
          <span className="m-home-cloud-sub">{"\u4e91\u76d8 ZIP / Git \u4ed3\u5e93 \u53cc\u6a21\u5f0f\u517c\u5bb9"}</span>
        </button>
      </section>
    </section>
  );
}
