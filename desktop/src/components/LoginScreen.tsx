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
    <div className="flex flex-col h-screen bg-background">
      {/* Custom Titlebar */}
      <TitleBar />

      <div className="flex-1 flex items-center justify-center p-5">
        <div className="bg-card border border-border rounded-xl p-10 px-8 w-full max-w-[420px] flex flex-col gap-6 shadow-2xl">
        {/* Logo */}
        <div className="flex items-baseline gap-2 justify-center">
          <span className="text-[28px] font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            IORA
          </span>
          <span className="text-sm text-muted-foreground font-medium tracking-widest uppercase">
            Desktop
          </span>
        </div>
        <p className="text-center text-sm text-muted-foreground -mt-2.5">
          Anmelden, um fortzufahren
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">Benutzername</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Benutzername eingeben"
              className="px-3.5 py-2.5 rounded-md border border-border bg-background text-foreground text-sm w-full outline-none transition-all"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">Passwort</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort eingeben"
              className="px-3.5 py-2.5 rounded-md border border-border bg-background text-foreground text-sm w-full outline-none transition-all"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive text-destructive rounded-md px-3.5 py-2.5 text-sm">
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="px-5 py-2.5 rounded-md border-none bg-primary text-primary-foreground text-sm font-semibold transition-all w-full mt-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Anmelden…" : "Anmelden"}
          </button>
        </form>

        {/* Skip to Settings button */}
        {onSkipToSettings && (
          <button
            type="button"
            onClick={onSkipToSettings}
            className="px-5 py-2.5 rounded-md border border-border bg-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground hover:border-foreground/20 text-sm font-medium transition-all w-full cursor-pointer"
          >
            Einstellungen öffnen (ohne Login)
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
