import React from "react";
import type { Instance } from "../types";

interface ProfileEditorModalProps {
  open: boolean;
  profileAvatar: string;
  profileInitials: string;
  profileDraftName: string;
  onProfileDraftNameChange: (value: string) => void;
  onAvatarFileChange: (file: File | null) => void;
  onSaveProfile: () => void;
  fontScale: number;
  onFontScaleChange: (value: number) => void;
  instanceId: string;
  instances: Instance[];
  onInstanceChange: (instanceId: string) => void;
  currentInstancePath: string;
  authEnabled: boolean;
  authToggleBusy: boolean;
  requireEnablePassword: boolean;
  enablePassword: string;
  onEnablePasswordChange: (value: string) => void;
  onToggleLoginProtection: (enabled: boolean, password?: string) => void;
  currentPassword: string;
  newPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onChangePassword: () => void;
  onClose: () => void;
}

export function ProfileEditorModal(props: ProfileEditorModalProps): React.ReactNode {
  if (!props.open) return null;

  return (
    <div className="m-modal-mask" onClick={props.onClose}>
      <section className="m-profile-modal" onClick={(event) => event.stopPropagation()}>
        <div className="m-profile-header">
          <h3>个人资料</h3>
          <button type="button" className="m-btn m-btn-ghost" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <div className="m-profile-block m-profile-basic">
          <label className="m-profile-avatar-picker">
            {props.profileAvatar ? <img src={props.profileAvatar} alt="头像" /> : <span>{props.profileInitials}</span>}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => props.onAvatarFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="m-profile-name-editor">
            <input
              className="m-input"
              value={props.profileDraftName}
              onChange={(event) => props.onProfileDraftNameChange(event.target.value)}
              placeholder="资源管理器用户名"
            />
            <button type="button" className="m-btn" onClick={props.onSaveProfile}>
              保存资料
            </button>
          </div>
        </div>

        <div className="m-profile-block">
          <p className="m-muted">字体大小</p>
          <div className="m-font-scale-row">
            <input
              className="m-range"
              type="range"
              min={0.4}
              max={1.2}
              step={0.05}
              value={props.fontScale}
              onChange={(event) => props.onFontScaleChange(Number(event.target.value))}
            />
            <strong>{Math.round(props.fontScale * 100)}%</strong>
          </div>
          <div className="m-actions-row">
            <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onFontScaleChange(0.5)}>
              小号（50%）
            </button>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onFontScaleChange(0.75)}>
              中号（75%）
            </button>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onFontScaleChange(1)}>
              标准（100%）
            </button>
          </div>
        </div>

        <div className="m-profile-block">
          <p className="m-muted">酒馆项目</p>
          <div className="m-profile-project-box">
            <select className="m-input" value={props.instanceId} onChange={(event) => props.onInstanceChange(event.target.value)}>
              {props.instances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className="m-muted m-break">当前路径：{props.currentInstancePath}</p>
          </div>
        </div>

        <div className="m-profile-block">
          <p className="m-muted">认证开关</p>
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
        </div>

        <div className="m-profile-block">
          <p className="m-muted">修改密码</p>
          <div className="m-actions-row">
            <input
              className="m-input"
              type="password"
              value={props.currentPassword}
              onChange={(event) => props.onCurrentPasswordChange(event.target.value)}
              placeholder="当前密码"
            />
            <input
              className="m-input"
              type="password"
              value={props.newPassword}
              onChange={(event) => props.onNewPasswordChange(event.target.value)}
              placeholder="新密码"
            />
            <button type="button" className="m-btn" onClick={props.onChangePassword}>
              修改密码
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
