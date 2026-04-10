import React from "react";
import type { ConnectionResult } from "../lib/tauri";

interface Props {
  status: ConnectionResult;
  loading: boolean;
}

export function ConnectionStatus({ status, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-yellow-500 shadow-[0_0_6px_rgb(234,179,8)]" />
        <span className="text-sm text-muted-foreground">Verbinde…</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
      <span
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          status.connected
            ? "bg-green-500 shadow-[0_0_6px_rgb(34,197,94)]"
            : "bg-red-500 shadow-[0_0_6px_rgb(239,68,68)]"
        }`}
      />
      <span className="text-sm text-muted-foreground">
        {status.connected
          ? "Verbunden mit LM Studio"
          : status.error || "Nicht verbunden"}
      </span>
    </div>
  );
}
