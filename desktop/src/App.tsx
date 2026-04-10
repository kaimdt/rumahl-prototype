import React, { useEffect, useState } from "react";
import { useLmStudio } from "./hooks/useLmStudio";
import { useAuth } from "./hooks/useAuth";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { SettingsForm } from "./components/SettingsForm";
import { LoginScreen } from "./components/LoginScreen";
import { IoraHomePanel } from "./components/IoraHomePanel";
import { TabBar, type TabId } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";

export default function App() {
  const { user, loading: authLoading, error: authError, login, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("settings"); // Default to settings

  const {
    config,
    models,
    status,
    clientInfo,
    loading,
    modelsLoading,
    error,
    lastChecked,
    testConnection,
    loadModels,
    saveConfig,
  } = useLmStudio();

  useEffect(() => {
    if (user) testConnection();
  }, [user, testConnection]);

  const lastCheckedLabel = lastChecked
    ? `Zuletzt geprüft: ${lastChecked.toLocaleTimeString("de-DE")}`
    : "";

  // Auth gate - Settings tab is always accessible, others require login
  const requiresAuth = activeTab !== "settings";

  if (authLoading) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            IORA
          </span>
        </div>
      </div>
    );
  }

  // Only show login screen if not on settings tab and not logged in
  if (!user && requiresAuth) {
    return <LoginScreen
      onLogin={login}
      onSkipToSettings={() => setActiveTab("settings")}
      error={authError}
      loading={authLoading}
    />;
  }

  const initials = user
    ? (user.display_name
        ? user.display_name.slice(0, 2).toUpperCase()
        : user.username.slice(0, 2).toUpperCase())
    : "??";

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Custom Titlebar */}
      <TitleBar />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-card/60 backdrop-blur-xl flex-shrink-0 min-h-[52px]">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            IORA
          </span>
          <span className="text-[11px] text-muted-foreground font-medium tracking-wider uppercase">
            Desktop
          </span>
        </div>
        <div className="flex items-center gap-2">
          {clientInfo && (
            <span
              className="text-[11px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 cursor-default"
              title={`Client-ID: ${clientInfo.client_id}`}
            >
              {clientInfo.client_name}
            </span>
          )}
          {user ? (
            <div className="flex items-center gap-1.5">
              <div
                className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 cursor-default"
                title={user.username}
              >
                {initials}
              </div>
              <span className="text-xs text-muted-foreground max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap">
                {user.display_name ?? user.username}
              </span>
              <button
                onClick={logout}
                className="bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer text-sm px-1 py-0.5 rounded leading-none transition-colors"
                title="Abmelden"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 1L11 11M11 1L1 11" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setActiveTab("ai")}
              className="px-3.5 py-1.5 rounded-md border border-border bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity"
            >
              Anmelden
            </button>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Error banner */}
      {error && activeTab === "ai" && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-5 py-2 text-sm flex-shrink-0">
          ⚠ {error}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-5">
        {activeTab === "ai" && (
          <>
            <div className="mb-4">
              <ConnectionStatus status={status} loading={loading} />
            </div>
            {config ? (
              <SettingsForm
                config={config}
                models={models}
                modelsLoading={modelsLoading}
                onSave={saveConfig}
                onLoadModels={loadModels}
              />
            ) : (
              <div className="text-center text-muted-foreground py-10">
                Lade Einstellungen…
              </div>
            )}
          </>
        )}

        {activeTab === "iora-home" && <IoraHomePanel />}

        {activeTab === "settings" && config && (
          <SettingsForm
            config={config}
            models={models}
            modelsLoading={modelsLoading}
            onSave={saveConfig}
            onLoadModels={loadModels}
          />
        )}
      </main>

      {/* Footer — only for AI tab */}
      {activeTab === "ai" && (
        <footer className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 bg-card/60 backdrop-blur-xl flex-shrink-0">
          <button
            onClick={testConnection}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-lg border border-border bg-transparent text-foreground cursor-pointer text-sm hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Teste…" : "Verbindung testen"}
          </button>
          <div className="flex items-center gap-3">
            {lastCheckedLabel && (
              <span className="text-[11px] text-muted-foreground">{lastCheckedLabel}</span>
            )}
            <span className="text-xs text-muted-foreground">v0.1.0</span>
          </div>
        </footer>
      )}
    </div>
  );
}
