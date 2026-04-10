import React, { useState } from "react";
import { TitleBar } from "./TitleBar";

interface Props {
  onLogin: (username: string, password: string) => Promise<void>;
  onSkipToSettings?: () => void;
  error: string | null;
  loading: boolean;
}

export function LoginScreen({ onLogin, onSkipToSettings, error, loading }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    await onLogin(username, password);
  };

  return (
    <div style={styles.root}>
      {/* Custom Titlebar */}
      <TitleBar />

      <div style={styles.content}>
        <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <span style={styles.logoText}>IORA</span>
          <span style={styles.logoSub}>Desktop</span>
        </div>
        <p style={styles.subtitle}>Anmelden, um fortzufahren</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Benutzername</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Benutzername eingeben"
              style={styles.input}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Passwort</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort eingeben"
              style={styles.input}
              autoComplete="current-password"
            />
          </div>

          {error && <div style={styles.error}>⚠ {error}</div>}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              ...styles.btn,
              opacity: loading || !username || !password ? 0.6 : 1,
              cursor: loading || !username || !password ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Anmelden…" : "Anmelden"}
          </button>
        </form>

        {/* Skip to Settings button */}
        {onSkipToSettings && (
          <button
            type="button"
            onClick={onSkipToSettings}
            style={styles.skipBtn}
          >
            Einstellungen öffnen (ohne Login)
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "hsl(var(--background))",
  } as React.CSSProperties,
  content: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  } as React.CSSProperties,
  card: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    padding: "40px 32px",
    width: "100%",
    maxWidth: "420px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    boxShadow: "0 4px 24px rgba(0, 0, 0, 0.25)",
  } as React.CSSProperties,
  logoWrap: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    justifyContent: "center",
  } as React.CSSProperties,
  logoText: {
    fontSize: "28px",
    fontWeight: 700,
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  } as React.CSSProperties,
  logoSub: {
    fontSize: "13px",
    color: "var(--color-muted)",
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  subtitle: {
    textAlign: "center" as const,
    fontSize: "13px",
    color: "var(--color-muted)",
    marginTop: "-10px",
  } as React.CSSProperties,
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  } as React.CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  } as React.CSSProperties,
  label: {
    fontSize: "13px",
    fontWeight: 500,
    color: "hsl(var(--muted-foreground))",
  } as React.CSSProperties,
  input: {
    padding: "10px 14px",
    borderRadius: "calc(var(--radius) - 2px)",
    border: "1px solid hsl(var(--border))",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    fontSize: "14px",
    width: "100%",
    outline: "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  } as React.CSSProperties,
  error: {
    background: "hsl(var(--destructive) / 0.1)",
    border: "1px solid hsl(var(--destructive))",
    color: "hsl(var(--destructive))",
    borderRadius: "calc(var(--radius) - 2px)",
    padding: "10px 14px",
    fontSize: "13px",
  } as React.CSSProperties,
  btn: {
    padding: "11px 20px",
    borderRadius: "calc(var(--radius) - 2px)",
    border: "none",
    background: "hsl(var(--primary))",
    color: "hsl(var(--primary-foreground))",
    fontSize: "14px",
    fontWeight: 600,
    transition: "background 0.15s ease, opacity 0.15s ease",
    width: "100%",
    marginTop: "6px",
  } as React.CSSProperties,
  skipBtn: {
    padding: "10px 20px",
    borderRadius: "calc(var(--radius) - 2px)",
    border: "1px solid hsl(var(--border))",
    background: "transparent",
    color: "hsl(var(--muted-foreground))",
    fontSize: "13px",
    fontWeight: 500,
    transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
    width: "100%",
    cursor: "pointer",
  } as React.CSSProperties,
};
