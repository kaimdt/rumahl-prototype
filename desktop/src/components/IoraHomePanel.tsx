import React from "react";
import { useIoraHome } from "../hooks/useIoraHome";

export function IoraHomePanel() {
  const { status, loading, refresh } = useIoraHome();

  const dot = (online: boolean) => ({
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    flexShrink: 0 as const,
    backgroundColor: online ? "var(--color-success)" : "var(--color-error)",
    boxShadow: `0 0 6px ${online ? "var(--color-success)" : "var(--color-error)"}`,
  } as React.CSSProperties);

  return (
    <div style={styles.root}>
      {/* Connection status */}
      <div style={styles.statusCard}>
        <div style={styles.statusRow}>
          <span style={dot(status?.online ?? false)} />
          <span style={styles.statusText}>
            {loading
              ? "Verbinde…"
              : status?.online
              ? "IORA Home erreichbar"
              : "IORA Home nicht erreichbar"}
          </span>
        </div>
        {status && (
          <span style={styles.urlLabel}>{status.url}</span>
        )}
      </div>

      {/* HA Connection */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>Home Assistant</div>
        <div style={styles.statusRow}>
          <span style={dot(status?.ha_connected ?? false)} />
          <span style={styles.cardValue}>
            {status?.ha_connected ? "Verbunden" : "Nicht verbunden"}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <span style={styles.statValue}>
            {status ? status.entity_count : "–"}
          </span>
          <span style={styles.statLabel}>Entitäten gesamt</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statValue}>
            {status ? status.person_count : "–"}
          </span>
          <span style={styles.statLabel}>Personen</span>
        </div>
      </div>

      {/* Reconnect button */}
      <button
        onClick={refresh}
        disabled={loading}
        style={{
          ...styles.btn,
          opacity: loading ? 0.6 : 1,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Aktualisiere…" : "⟳ Aktualisieren"}
      </button>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "20px",
  } as React.CSSProperties,
  statusCard: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  } as React.CSSProperties,
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,
  statusText: {
    fontSize: "14px",
    fontWeight: 500,
    color: "var(--color-text)",
  } as React.CSSProperties,
  urlLabel: {
    fontSize: "11px",
    color: "var(--color-muted)",
    paddingLeft: "20px",
  } as React.CSSProperties,
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  } as React.CSSProperties,
  cardHeader: {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--color-primary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  } as React.CSSProperties,
  cardValue: {
    fontSize: "14px",
    color: "var(--color-text)",
  } as React.CSSProperties,
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  } as React.CSSProperties,
  statCard: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    alignItems: "center",
  } as React.CSSProperties,
  statValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: "var(--color-primary)",
  } as React.CSSProperties,
  statLabel: {
    fontSize: "12px",
    color: "var(--color-muted)",
    textAlign: "center" as const,
  } as React.CSSProperties,
  btn: {
    padding: "9px 18px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text)",
    fontSize: "13px",
    fontWeight: 500,
    transition: "background 0.15s ease",
    alignSelf: "flex-start" as const,
  } as React.CSSProperties,
};
