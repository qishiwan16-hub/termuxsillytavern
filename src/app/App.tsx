import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiGet,
  apiPatch,
  apiPost,
  clearAuthToken,
  downloadZip,
  getAuthToken,
  setAuthToken
} from "../lib/api";
import {
  FONT_SCALE_KEY,
  HIDDEN_HOME_STAT_KEYS,
  PROFILE_AVATAR_KEY,
  PROFILE_NAME_KEY,
  RESOURCE_TYPE_LABELS,
  initials,
  toShortDate,
  toVaultId
} from "./ui-config";
import { AuthGate } from "./components/AuthGate";
import { HomePage } from "./components/HomePage";
import { ProfileEditorModal } from "./components/ProfileEditorModal";
import { GitPanel, PanelShell, QueuePanel, ResourcesPanel, SettingsPanel } from "./components/panels/MainPanels";
import type {
  AppSettings,
  AuthMode,
  AuthStatus,
  Dashboard,
  Instance,
  PanelKey,
  QueueJob,
  ResourceResp,
  ResourceStatItem,
  Source
} from "./types";

const LegacyApp = lazy(() => import("../LegacyApp").then((mod) => ({ default: mod.LegacyApp })));

export function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("checking");
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ enabled: false, passwordConfigured: false });
  const [setupPassword, setSetupPassword] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [enablePassword, setEnablePassword] = useState("");
  const [requireEnablePassword, setRequireEnablePassword] = useState(false);
  const [authToggleBusy, setAuthToggleBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [profileName, setProfileName] = useState("管理员");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("管理员");
  const [fontScale, setFontScale] = useState(0.5);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [resources, setResources] = useState<ResourceResp>({
    items: [],
    total: 0,
    sourceSummary: { instance: 0, vault: 0 }
  });
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gitResult, setGitResult] = useState("");
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [legacyMode, setLegacyMode] = useState(false);
  const [toast, setToast] = useState("");

  const currentInstance = useMemo(() => instances.find((item) => item.id === instanceId), [instances, instanceId]);
  const selectedItems = useMemo(
    () => resources.items.filter((item) => selectedIds.includes(item.id)),
    [resources.items, selectedIds]
  );
  const queueHealth = useMemo(() => {
    const total = dashboard?.queueStats.total ?? 0;
    const blocked = dashboard?.queueStats.blocked ?? 0;
    const failed = dashboard?.queueStats.failed ?? 0;
    if (total === 0) return 100;
    const healthy = Math.max(0, total - blocked - failed);
    return Math.round((healthy / total) * 100);
  }, [dashboard]);
  const homeStats = useMemo<ResourceStatItem[]>(() => {
    const stats = dashboard?.resourceStats ?? {};
    const base = RESOURCE_TYPE_LABELS.map((item) => ({
      key: item.key,
      label: item.label,
      value: stats[item.key] ?? 0
    }));
    const extra = Object.keys(stats)
      .filter((key) => !RESOURCE_TYPE_LABELS.some((item) => item.key === key))
      .filter((key) => !HIDDEN_HOME_STAT_KEYS.has(key))
      .map((key) => ({
        key,
        label: key,
        value: stats[key] ?? 0
      }))
      .filter((item) => item.value > 0);
    return [...base, ...extra];
  }, [dashboard]);
  const homeStatsNonZero = useMemo(() => homeStats.filter((item) => item.value > 0), [homeStats]);
  const homeStatsTop = useMemo(
    () => [...homeStats].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN")).slice(0, 6),
    [homeStats]
  );
  const homeCenterRows = useMemo(() => {
    const stats = dashboard?.resourceStats ?? {};
    return [
      { label: "资源总数", value: dashboard?.selectedInstance?.resourceTotal ?? 0 },
      { label: "角色卡", value: stats.character ?? 0 },
      { label: "世界书", value: stats.world ?? 0 },
      { label: "预设", value: stats.preset ?? 0 },
      { label: "聊天记录", value: stats.chat ?? 0 },
      { label: "全局扩展", value: stats.prompt ?? 0 },
      { label: "主题美化", value: stats.theme ?? 0 }
    ];
  }, [dashboard]);
  const appStyle = useMemo(
    () =>
      ({
        "--m-font-scale": String(fontScale)
      }) as React.CSSProperties,
    [fontScale]
  );

  useEffect(() => {
    const savedName = localStorage.getItem(PROFILE_NAME_KEY)?.trim();
    const savedAvatar = localStorage.getItem(PROFILE_AVATAR_KEY) ?? "";
    const savedScale = Number(localStorage.getItem(FONT_SCALE_KEY));
    if (savedName) {
      setProfileName(savedName);
      setProfileDraftName(savedName);
    }
    if (savedAvatar) {
      setProfileAvatar(savedAvatar);
    }
    if (!Number.isNaN(savedScale) && savedScale >= 0.4 && savedScale <= 1.2) {
      setFontScale(savedScale);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthToken();
        setAuthMode("login");
      }
      setToast(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  async function loadAll(options?: { instanceId?: string; source?: Source; query?: string }): Promise<void> {
    const preferredInstanceId = options?.instanceId ?? instanceId;
    const nextSource = options?.source ?? source;
    const nextQuery = options?.query ?? query;

    const instancesResp = await safe(() => apiGet<{ items: Instance[] }>("/api/instances"));
    if (!instancesResp) return;
    setInstances(instancesResp.items);

    const nextId = instancesResp.items.some((item) => item.id === preferredInstanceId)
      ? preferredInstanceId
      : (instancesResp.items[0]?.id ?? "");
    setInstanceId(nextId);

    const dashboardResp = await safe(
      () => apiGet<Dashboard>(`/api/dashboard/summary${nextId ? `?instanceId=${encodeURIComponent(nextId)}` : ""}`)
    );
    if (dashboardResp) setDashboard(dashboardResp);

    const resourcesResp = await safe(() =>
      apiGet<ResourceResp>(
        `/api/resources?source=${nextSource}&instanceId=${encodeURIComponent(nextId)}&q=${encodeURIComponent(nextQuery)}&offset=0&limit=50&refreshMode=incremental&includeDirs=false`
      )
    );
    if (resourcesResp) setResources(resourcesResp);

    const queueResp = await safe(() => apiGet<{ items: QueueJob[] }>("/api/queue"));
    if (queueResp) setQueue(queueResp.items);

    const settingsResp = await safe(() => apiGet<AppSettings>("/api/app-settings"));
    if (settingsResp) setSettings(settingsResp);
  }

  useEffect(() => {
    void (async () => {
      const status = await safe(() => apiGet<AuthStatus>("/api/auth/status"));
      if (!status) {
        setAuthMode("login");
        return;
      }
      setAuthStatus(status);
      if (!status.passwordConfigured) {
        setAuthMode("setup");
        return;
      }
      if (status.enabled && !getAuthToken()) {
        setAuthMode("login");
        return;
      }
      setAuthMode("ready");
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile(): Promise<void> {
    const name = profileDraftName.trim() || "管理员";
    setProfileName(name);
    setProfileDraftName(name);
    localStorage.setItem(PROFILE_NAME_KEY, name);
    if (profileAvatar) {
      localStorage.setItem(PROFILE_AVATAR_KEY, profileAvatar);
    } else {
      localStorage.removeItem(PROFILE_AVATAR_KEY);
    }
    setToast("资料已保存");
  }

  async function updateAvatar(file: File | null): Promise<void> {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfileAvatar(String(reader.result ?? ""));
    };
    reader.onerror = () => {
      setToast("头像读取失败");
    };
    reader.readAsDataURL(file);
  }

  function updateFontScale(nextScale: number): void {
    const value = Number.isFinite(nextScale) ? Math.min(1.2, Math.max(0.4, nextScale)) : 0.5;
    setFontScale(value);
    localStorage.setItem(FONT_SCALE_KEY, String(value));
  }

  async function toggleLoginProtection(nextEnabled: boolean, password?: string): Promise<void> {
    if (authToggleBusy) return;
    setAuthToggleBusy(true);
    try {
      const result = await apiPost<{ enabled: boolean; passwordConfigured: boolean; token?: string | null }>(
        "/api/auth/set-enabled",
        {
          enabled: nextEnabled,
          password: password || undefined
        }
      );
      setAuthStatus({ enabled: result.enabled, passwordConfigured: result.passwordConfigured });
      if (result.token) {
        setAuthToken(result.token);
      }
      if (!result.enabled) {
        clearAuthToken();
      }
      setEnablePassword("");
      setRequireEnablePassword(false);
      setToast(result.enabled ? "已启用登录密码" : "已关闭登录密码");
    } catch (error) {
      if (error instanceof ApiError) {
        if (nextEnabled && (error.status === 400 || error.status === 401)) {
          setRequireEnablePassword(true);
        }
        if (error.status === 401) {
          clearAuthToken();
        }
        setToast(error.message);
      } else {
        setToast(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setAuthToggleBusy(false);
    }
  }

  async function changePassword(): Promise<void> {
    await safe(async () => {
      await apiPost("/api/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setToast("密码已修改");
    });
  }

  function toggleSelectedId(id: string): void {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function batchApply(): Promise<void> {
    await safe(async () => {
      if (!instanceId || selectedItems.length === 0) return;
      await apiPost("/api/resources/batch/apply", {
        instanceId,
        targetRelDir: "data/default-user/characters",
        mode: "copy_once",
        items: selectedItems.map((item) =>
          item.source === "vault"
            ? { source: "vault", id: toVaultId(item.id) }
            : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }
        )
      });
      setToast("批量取用完成");
      await loadAll();
    });
  }

  async function batchExport(): Promise<void> {
    await safe(async () => {
      if (selectedItems.length === 0) return;
      await downloadZip(
        "/api/resources/batch/export/zip",
        {
          items: selectedItems.map((item) =>
            item.source === "vault"
              ? { source: "vault", id: toVaultId(item.id) }
              : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }
          )
        },
        `resources-${Date.now()}.zip`
      );
    });
  }

  async function batchDelete(): Promise<void> {
    await safe(async () => {
      if (selectedItems.length === 0) return;
      await apiPost("/api/resources/batch/delete", {
        items: selectedItems.map((item) =>
          item.source === "vault"
            ? { source: "vault", id: toVaultId(item.id) }
            : { source: "instance", instanceId: item.instanceId, relPath: item.relPath }
        )
      });
      setToast("已移入回收站");
      await loadAll();
    });
  }

  async function toggleFavorite(resourceId: string): Promise<void> {
    const target = resources.items.find((item) => item.id === resourceId);
    if (!target || target.source !== "vault") return;
    await safe(async () => {
      await apiPatch(`/api/vault/items/${toVaultId(target.id)}/meta`, { favorite: !target.favorite });
      await loadAll();
    });
  }

  async function pullProject(): Promise<void> {
    await safe(async () => {
      if (!instanceId) return;
      const result = await apiPost(`/api/instances/${instanceId}/git/pull`, {});
      setGitResult(JSON.stringify(result, null, 2));
      await loadAll();
    });
  }

  async function pullVault(): Promise<void> {
    await safe(async () => {
      const result = await apiPost("/api/vault/git/pull", {});
      setGitResult(JSON.stringify(result, null, 2));
      await loadAll();
    });
  }

  async function patchSettings(patch: Partial<AppSettings>): Promise<void> {
    await safe(async () => {
      const result = await apiPatch<AppSettings>("/api/app-settings", patch);
      setSettings(result);
    });
  }

  async function setupAuth(): Promise<void> {
    await safe(async () => {
      const result = await apiPost<{ token: string }>("/api/auth/setup", { password: setupPassword });
      if (result.token) setAuthToken(result.token);
      setAuthMode("ready");
      await loadAll();
    });
  }

  async function loginAuth(): Promise<void> {
    await safe(async () => {
      const result = await apiPost<{ token: string | null }>("/api/auth/login", { password: loginPassword });
      if (result.token) setAuthToken(result.token);
      setAuthMode("ready");
      await loadAll();
    });
  }

  function refreshAll(): void {
    void loadAll();
    setToast("已刷新");
  }

  const currentPath = currentInstance?.rootPath ?? "/data/data/com.termux/files/home/SillyTavern";
  const panelBody =
    activePanel === "resources" ? (
      <ResourcesPanel
        source={source}
        query={query}
        resources={resources}
        selectedIds={selectedIds}
        onSourceChange={setSource}
        onQueryChange={setQuery}
        onSearch={() => void loadAll({ source, query, instanceId })}
        onSelectPage={() => setSelectedIds(resources.items.map((item) => item.id))}
        onBatchApply={() => void batchApply()}
        onBatchExport={() => void batchExport()}
        onBatchDelete={() => void batchDelete()}
        onToggleSelect={toggleSelectedId}
        onToggleFavorite={(id) => void toggleFavorite(id)}
      />
    ) : activePanel === "queue" ? (
      <QueuePanel queue={queue} />
    ) : activePanel === "git" ? (
      <GitPanel gitResult={gitResult} onPullProject={() => void pullProject()} onPullVault={() => void pullVault()} />
    ) : activePanel === "settings" ? (
      <SettingsPanel
        settings={settings}
        authEnabled={authStatus.enabled}
        authToggleBusy={authToggleBusy}
        requireEnablePassword={requireEnablePassword}
        enablePassword={enablePassword}
        onEnablePasswordChange={setEnablePassword}
        onToggleLoginProtection={(enabled, password) => void toggleLoginProtection(enabled, password)}
        onOpenProfile={() => setShowProfileEditor(true)}
        onPatchSettings={(patch) => void patchSettings(patch)}
        onOpenLegacy={() => setLegacyMode(true)}
      />
    ) : null;

  if (legacyMode) {
    return (
      <>
        <div className="m-app" style={appStyle}>
          <section className="m-card">
            <h2>旧版模式</h2>
            <button type="button" className="m-btn" onClick={() => setLegacyMode(false)}>
              返回
            </button>
          </section>
        </div>
        <Suspense
          fallback={
            <div className="m-app" style={appStyle}>
              <section className="m-card">正在加载旧版界面...</section>
            </div>
          }
        >
          <LegacyApp />
        </Suspense>
      </>
    );
  }

  if (authMode !== "ready") {
    return (
      <AuthGate
        mode={authMode}
        setupPassword={setupPassword}
        loginPassword={loginPassword}
        toast={toast}
        onSetupPasswordChange={setSetupPassword}
        onLoginPasswordChange={setLoginPassword}
        onSetup={() => void setupAuth()}
        onLogin={() => void loginAuth()}
        style={appStyle}
      />
    );
  }

  return (
    <div className="m-app" style={appStyle}>
      <HomePage
        profileAvatar={profileAvatar}
        profileName={profileName}
        profileInitials={initials(profileName)}
        projectName={currentInstance?.name ?? "默认项目"}
        projectRunning={Boolean(currentInstance?.isRunning)}
        queueHealth={queueHealth}
        resourceTotal={dashboard?.selectedInstance?.resourceTotal ?? 0}
        version={dashboard?.selectedInstance?.version ?? "unknown"}
        queueTotal={dashboard?.queueStats.total ?? 0}
        queueFailed={dashboard?.queueStats.failed ?? 0}
        updatedAt={dashboard?.queueStats.updatedAt}
        homeCenterRows={homeCenterRows}
        homeStatsTop={homeStatsTop}
        hasResource={homeStatsNonZero.length > 0}
        onOpenProfile={() => setShowProfileEditor(true)}
        onRefresh={refreshAll}
        onOpenPanel={setActivePanel}
        formatDate={toShortDate}
      />

      <PanelShell activePanel={activePanel} onClose={() => setActivePanel(null)} onRefresh={refreshAll}>
        {panelBody}
      </PanelShell>

      <ProfileEditorModal
        open={showProfileEditor}
        profileAvatar={profileAvatar}
        profileInitials={initials(profileName)}
        profileDraftName={profileDraftName}
        onProfileDraftNameChange={setProfileDraftName}
        onAvatarFileChange={(file) => void updateAvatar(file)}
        onSaveProfile={() => void saveProfile()}
        fontScale={fontScale}
        onFontScaleChange={updateFontScale}
        instanceId={instanceId}
        instances={instances}
        onInstanceChange={(nextId) => {
          setInstanceId(nextId);
          void loadAll({ instanceId: nextId });
        }}
        currentInstancePath={currentPath}
        authEnabled={authStatus.enabled}
        authToggleBusy={authToggleBusy}
        requireEnablePassword={requireEnablePassword}
        enablePassword={enablePassword}
        onEnablePasswordChange={setEnablePassword}
        onToggleLoginProtection={(enabled, password) => void toggleLoginProtection(enabled, password)}
        currentPassword={currentPassword}
        newPassword={newPassword}
        onCurrentPasswordChange={setCurrentPassword}
        onNewPasswordChange={setNewPassword}
        onChangePassword={() => void changePassword()}
        onClose={() => setShowProfileEditor(false)}
      />

      {toast ? <div className="m-toast">{toast}</div> : null}
    </div>
  );
}
