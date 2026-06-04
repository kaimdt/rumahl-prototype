"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

const tracks = [
  {
    id: "docker",
    label: "Docker",
    command: "docker compose up -d ora-home",
    eta: "5-10 min",
    note: "Best for homelab and NAS setups.",
  },
  {
    id: "linux",
    label: "Linux",
    command: "curl -fsSL https://ora.sh/install | bash",
    eta: "3-5 min",
    note: "One-line installer for Ubuntu and Debian.",
  },
  {
    id: "desktop",
    label: "Desktop",
    command: "winget install ORA.Home",
    eta: "2 min",
    note: "Windows, macOS and Linux desktop app.",
  },
];

export function QuickstartSteps() {
  const [activeTrack, setActiveTrack] = useState(tracks[0].id);
  const [copied, setCopied] = useState(false);

  const selected = useMemo(
    () => tracks.find((item) => item.id === activeTrack) ?? tracks[0],
    [activeTrack]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selected.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="glass-card p-6 md:p-7 mt-10">
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => setActiveTrack(track.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeTrack === track.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {track.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border/30 bg-card/40 p-4">
        <p className="text-xs text-muted-foreground mb-2">Install command</p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <code className="text-sm text-foreground font-mono break-all">{selected.command}</code>
          <button
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-border/40 text-xs text-foreground hover:bg-muted/30 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-border/30 bg-card/30 p-3">
          <p className="text-muted-foreground">Estimated setup time</p>
          <p className="text-foreground mt-1 font-medium">{selected.eta}</p>
        </div>
        <div className="rounded-xl border border-border/30 bg-card/30 p-3">
          <p className="text-muted-foreground">Best for</p>
          <p className="text-foreground mt-1 font-medium flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            {selected.note}
          </p>
        </div>
      </div>
    </div>
  );
}
