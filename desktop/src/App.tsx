import React, { useEffect } from "react";
import { useLmStudio } from "./hooks/useLmStudio";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { SettingsForm } from "./components/SettingsForm";

export default function App() {
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

  // Perform a live connection test on first open
  useEffect(() => {
    testConnection();
  }, [testConnection]);

  const lastCheckedLabel = lastChecked
    ? `Zuletzt geprüft: ${lastChecked.toLocaleTimeString("de-DE")}`
    : "";

  return (
    <div style={styles.root}>
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
          <ConnectionStatus status={status} loading={loading} />
        </div>
      </header>

      {/* Error banner */}
      {error && <div style={styles.errorBanner}>⚠ {error}</div>}

      {/* Main content */}
      <main style={styles.main}>
        {config ? (
          <SettingsForm
            config={config}
            models={models}
            modelsLoading={modelsLoading}
            onSave={saveConfig}
            onLoadModels={loadModels}
          />
        ) : (
          <div style={styles.loading}>Lade Einstellungen…</div>
        )}
      </main>

      {/* Footer */}
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
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  } as React.CSSProperties,
  logo: { display: "flex", alignItems: "baseline", gap: "6px" } as React.CSSProperties,
  logoText: {
    fontSize: "20px",
    fontWeight: 700,
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  } as React.CSSProperties,
  logoSub: {
    fontSize: "12px",
    color: "var(--color-muted)",
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,
  clientBadge: {
    fontSize: "11px",
    color: "var(--color-muted)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    padding: "2px 8px",
    cursor: "default",
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
    padding: "24px 20px",
  },
  loading: {
    textAlign: "center" as const,
    color: "var(--color-muted)",
    padding: "40px",
  } as React.CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px",
    borderTop: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  } as React.CSSProperties,
  testBtn: {
    padding: "7px 16px",
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
