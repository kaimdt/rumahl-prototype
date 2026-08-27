"use client";

import { useState } from "react";
import { KeyRound, LogIn } from "lucide-react";
import { adminApi, setToken } from "@/lib/api";
import { Button, Input } from "@/components/admin/ui";
import { useAdminTranslation } from "@/lib/admin-i18n";

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useAdminTranslation();
  const centralLoginUrl = process.env.NEXT_PUBLIC_CENTRAL_LOGIN_URL;
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
          {t("auth.title")}
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          {t("auth.description")}
        </p>
        {centralLoginUrl && (
          <a href={centralLoginUrl} className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            <LogIn className="h-4 w-4" />
            {t("auth.centralSignIn")}
          </a>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Input
            type="password"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder={t("auth.tokenPlaceholder")}
            autoFocus
            autoComplete="off"
          />
          {error && <p className="text-xs text-status-major">{error}</p>}
          <Button type="submit" disabled={busy || !token.trim()} className="w-full justify-center">
            {busy ? t("auth.verifying") : t("auth.signIn")}
          </Button>
        </form>
      </div>
    </div>
  );
}
