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
  const [activeTab, setActiveTab] = useState<TabId>("ai");

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
      <div style={styles.splash}>
        <span style={styles.logoText}>IORA</span>
      </div>
    );
  }

  // Only show login screen if not on settings tab and not logged in
  if (!user && requiresAuth) {
    return <LoginScreen onLogin={login} error={authError} loading={authLoading} />;
  }

  const initials = user
    ? (user.display_name
        ? user.display_name.slice(0, 2).toUpperCase()
        : user.username.slice(0, 2).toUpperCase())
    : "??";

  return (
    <div style={styles.root}>
      {/* Custom Titlebar */}
      <TitleBar />

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoText}>IORA</span>
          <span style={styles.logoSub}>Desktop</span>
        </div>
        <div style={styles.headerRight}>
          {clientInfo && (
            <span style={styles.clientBadge} title={`Client-ID: ${clientInfo.client_id}`}>
              {clientInfo.client_name}
            </span>
          )}
          <div style={styles.userArea}>
            <div style={styles.avatar} title={user.username}>
              {initials}
            </div>
            <span style={styles.username}>{user.display_name ?? user.username}</span>
            <button onClick={logout} style={styles.logoutBtn} title="Abmelden">
              ✕
            </button>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Error banner */}
      {error && activeTab === "ai" && (
        <div style={styles.errorBanner}>⚠ {error}</div>
      )}

      {/* Main content */}
      <main style={styles.main}>
        {activeTab === "ai" && (
          <>
            <div style={styles.connectionRow}>
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
              <div style={styles.loadingText}>Lade Einstellungen…</div>
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
        <footer style={styles.footer}>
          <button onClick={testConnection} disabled={loading} style={styles.testBtn}>
            {loading ? "Teste…" : "Verbindung testen"}
          </button>
          <div style={styles.footerRight}>
            {lastCheckedLabel && (
              <span style={styles.lastChecked}>{lastCheckedLabel}</span>
            )}
            <span style={styles.version}>v0.1.0</span>
          </div>
        </footer>
      )}
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  } as React.CSSProperties,
  splash: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "var(--color-bg)",
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
    minHeight: "52px",
  } as React.CSSProperties,
  logo: { display: "flex", alignItems: "baseline", gap: "6px" } as React.CSSProperties,
  logoText: {
    fontSize: "18px",
    fontWeight: 700,
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  } as React.CSSProperties,
  logoSub: {
    fontSize: "11px",
    color: "var(--color-muted)",
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  clientBadge: {
    fontSize: "11px",
    color: "var(--color-muted)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    padding: "2px 7px",
    cursor: "default",
  } as React.CSSProperties,
  userArea: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  } as React.CSSProperties,
  avatar: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    color: "white",
    fontSize: "11px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    cursor: "default",
  } as React.CSSProperties,
  username: {
    fontSize: "12px",
    color: "var(--color-muted)",
    maxWidth: "80px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  logoutBtn: {
    background: "transparent",
    border: "none",
    color: "var(--color-muted)",
    cursor: "pointer",
    fontSize: "13px",
    padding: "2px 4px",
    borderRadius: "4px",
    lineHeight: 1,
    transition: "color 0.15s ease",
  } as React.CSSProperties,
  connectionRow: {
    marginBottom: "16px",
  } as React.CSSProperties,
  errorBanner: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid var(--color-error)",
    color: "var(--color-error)",
    padding: "8px 20px",
    fontSize: "13px",
    flexShrink: 0,
  } as React.CSSProperties,
  main: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "20px",
  },
  loadingText: {
    textAlign: "center" as const,
    color: "var(--color-muted)",
    padding: "40px",
  } as React.CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderTop: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  } as React.CSSProperties,
  testBtn: {
    padding: "7px 14px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text)",
    cursor: "pointer",
    fontSize: "13px",
  } as React.CSSProperties,
  footerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  } as React.CSSProperties,
  lastChecked: {
    fontSize: "11px",
    color: "var(--color-muted)",
  } as React.CSSProperties,
  version: { fontSize: "12px", color: "var(--color-muted)" } as React.CSSProperties,
};
