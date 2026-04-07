import React, { useState } from "react";

interface Props {
  onLogin: (username: string, password: string) => Promise<void>;
  error: string | null;
  loading: boolean;
}

export function LoginScreen({ onLogin, error, loading }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    await onLogin(username, password);
  };

  return (
    <div style={styles.root}>
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
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "var(--color-bg)",
    padding: "20px",
  } as React.CSSProperties,
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "32px 28px",
    width: "100%",
    maxWidth: "360px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
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
    color: "var(--color-muted)",
  } as React.CSSProperties,
  input: {
    padding: "9px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    fontSize: "14px",
    width: "100%",
    outline: "none",
  } as React.CSSProperties,
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid var(--color-error)",
    color: "var(--color-error)",
    borderRadius: "var(--radius)",
    padding: "8px 12px",
    fontSize: "13px",
  } as React.CSSProperties,
  btn: {
    padding: "10px 20px",
    borderRadius: "var(--radius)",
    border: "none",
    background: "var(--color-primary)",
    color: "white",
    fontSize: "14px",
    fontWeight: 600,
    transition: "background 0.15s ease",
    width: "100%",
    marginTop: "4px",
  } as React.CSSProperties,
};
