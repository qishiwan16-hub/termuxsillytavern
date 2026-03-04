import React from "react";
import type { AuthMode } from "../types";

interface AuthGateProps {
  mode: AuthMode;
  setupPassword: string;
  loginPassword: string;
  toast: string;
  onSetupPasswordChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onSetup: () => void;
  onLogin: () => void;
  style?: React.CSSProperties;
}

export function AuthGate(props: AuthGateProps): React.ReactNode {
  if (props.mode === "ready") return null;

  return (
    <div className="m-auth-wrap" style={props.style}>
      <section className="m-auth-card">
        <h2>ST 资源管理器</h2>
        {props.mode === "checking" ? <p className="m-muted">初始化中...</p> : null}
        {props.mode === "setup" ? (
          <>
            <input
              className="m-input"
              type="password"
              value={props.setupPassword}
              onChange={(event) => props.onSetupPasswordChange(event.target.value)}
              placeholder="设置密码"
            />
            <button type="button" className="m-btn" onClick={props.onSetup}>
              完成设置
            </button>
          </>
        ) : null}
        {props.mode === "login" ? (
          <>
            <input
              className="m-input"
              type="password"
              value={props.loginPassword}
              onChange={(event) => props.onLoginPasswordChange(event.target.value)}
              placeholder="输入密码"
            />
            <button type="button" className="m-btn" onClick={props.onLogin}>
              登录
            </button>
          </>
        ) : null}
        <p className="m-muted">{props.toast}</p>
      </section>
    </div>
  );
}
