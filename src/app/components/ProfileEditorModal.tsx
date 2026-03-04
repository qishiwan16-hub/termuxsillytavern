import React from "react";
import type { DirectoryEntry } from "../types";

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
  projectPathDraft: string;
  onProjectPathDraftChange: (value: string) => void;
  projectPathFavorites: string[];
  projectPathFavoriteValue: string;
  projectPathFavoriteActive: boolean;
  onSelectProjectPathFavorite: (value: string) => void;
  onToggleProjectPathFavorite: () => void;
  onSaveProjectPath: () => void;
  dirPickerOpen: boolean;
  dirPickerLoading: boolean;
  dirPickerRoot: string;
  dirPickerCurrent: string;
  dirPickerParent: string | null;
  dirPickerEntries: DirectoryEntry[];
  onOpenDirPicker: () => void;
  onCloseDirPicker: () => void;
  onNavigateDir: (absPath: string) => void;
  onChooseDir: (absPath: string) => void;
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
            <div className="m-project-path-row">
              <input
                className="m-input"
                value={props.projectPathDraft}
                onChange={(event) => props.onProjectPathDraftChange(event.target.value)}
                placeholder="/data/data/com.termux/files/home/SillyTavern/data/default-user"
              />
              <button type="button" className="m-folder-btn" onClick={props.onOpenDirPicker} aria-label="打开目录选择">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Z" />
                </svg>
              </button>
              <button
                type="button"
                className={`m-folder-btn m-favorite-btn${props.projectPathFavoriteActive ? " active" : ""}`}
                onClick={props.onToggleProjectPathFavorite}
                aria-label={props.projectPathFavoriteActive ? "取消收藏路径" : "收藏路径"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-3-6 3V4z" />
                </svg>
              </button>
            </div>
            <div className="m-project-favorite-row">
              <select
                className="m-input m-path-favorite-select"
                value={props.projectPathFavoriteValue}
                onChange={(event) => props.onSelectProjectPathFavorite(event.target.value)}
                disabled={props.projectPathFavorites.length === 0}
              >
                <option value="">选择收藏路径</option>
                {props.projectPathFavorites.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
            </div>
            <div className="m-actions-row">
              <button type="button" className="m-btn" onClick={props.onSaveProjectPath}>
                保存路径
              </button>
            </div>
            <p className="m-muted m-break">建议选择到 `data/default-user` 层级，资源会按该目录归类读取。</p>
          </div>

          {props.dirPickerOpen ? (
            <div className="m-dir-picker">
              <div className="m-dir-picker-head">
                <span className="m-muted">目录浏览器</span>
                <button type="button" className="m-btn m-btn-ghost" onClick={props.onCloseDirPicker}>
                  关闭
                </button>
              </div>
              <p className="m-muted m-break">根目录：{props.dirPickerRoot || "-"}</p>
              <p className="m-muted m-break">当前：{props.dirPickerCurrent || "-"}</p>
              <div className="m-actions-row">
                <button
                  type="button"
                  className="m-btn m-btn-ghost"
                  disabled={!props.dirPickerParent}
                  onClick={() => {
                    if (props.dirPickerParent) props.onNavigateDir(props.dirPickerParent);
                  }}
                >
                  上一级
                </button>
                <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onChooseDir(props.dirPickerCurrent)}>
                  选择当前目录
                </button>
              </div>
              {props.dirPickerLoading ? <p className="m-muted">正在读取目录...</p> : null}
              <ul className="m-dir-picker-list">
                {props.dirPickerEntries.map((entry: DirectoryEntry) => (
                  <li key={entry.absPath}>
                    <p className="m-break">{entry.name}</p>
                    <div className="m-actions-row">
                      <button type="button" className="m-btn m-btn-ghost" onClick={() => props.onNavigateDir(entry.absPath)}>
                        进入
                      </button>
                      <button type="button" className="m-btn" onClick={() => props.onChooseDir(entry.absPath)}>
                        选择
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
