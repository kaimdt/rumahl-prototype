"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { adminApi, setToken } from "@/lib/api";
import { Button, Input } from "@/components/admin/ui";

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.verify(token.trim());
      setToken(token.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid token");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-5 py-24">
      <div className="surface-card p-8">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary-accent/10 text-primary">
          <KeyRound className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-center text-foreground mb-2">
          Admin access
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Enter the admin token configured in the backend to manage
          components, incidents and notifications.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <Input
            type="password"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder="Admin token"
            autoFocus
            autoComplete="off"
          />
          {error && <p className="text-xs text-status-major">{error}</p>}
          <Button type="submit" disabled={busy || !token.trim()} className="w-full justify-center">
            {busy ? "Verifying…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
