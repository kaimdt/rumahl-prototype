import React from "react";
import type { ConnectionResult } from "../lib/tauri";

interface Props {
  status: ConnectionResult;
  loading: boolean;
}

export function ConnectionStatus({ status, loading }: Props) {
  if (loading) {
    return (
      <div style={styles.container}>
        <span style={styles.dot("warning")} />
        <span style={styles.text}>Verbinde…</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <span style={styles.dot(status.connected ? "success" : "error")} />
      <span style={styles.text}>
        {status.connected
          ? "Verbunden mit LM Studio"
          : status.error || "Nicht verbunden"}
      </span>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "var(--radius)",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
  } as React.CSSProperties,
  dot: (color: "success" | "error" | "warning") =>
    ({
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      flexShrink: 0,
      backgroundColor:
        color === "success"
          ? "var(--color-success)"
          : color === "error"
          ? "var(--color-error)"
          : "var(--color-warning)",
      boxShadow: `0 0 6px ${
        color === "success"
          ? "var(--color-success)"
          : color === "error"
          ? "var(--color-error)"
          : "var(--color-warning)"
      }`,
    } as React.CSSProperties),
  text: {
    fontSize: "13px",
    color: "var(--color-muted)",
  } as React.CSSProperties,
};
