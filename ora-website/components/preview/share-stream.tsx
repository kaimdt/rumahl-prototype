"use client";

import { OsWindow } from "./os-window";
import {
  Monitor, Smartphone, Tv, Send, Check,
} from "lucide-react";
import { ShareNetwork, VideoCamera, Devices } from "@phosphor-icons/react";

const devices = [
  { n: "Living Room TV", i: Tv, active: false },
  { n: "Phone", i: Smartphone, active: true },
  { n: "Laptop", i: Monitor, active: false },
];

/** rumahl Share — device-to-device file sharing in the local network. */
export function SharePreview() {
  return (
    <OsWindow title="rumahl Share" status="local network · 3 devices">
      <div className="p-5">
        <div className="rounded-xl border border-border/60 bg-[hsl(var(--surface))] p-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShareNetwork size={22} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground truncate">Sunset_Beach.jpg</p>
            <p className="text-[10px] text-muted-foreground font-mono">6.8 MB · ready to send</p>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-medium text-success">
            <Check className="h-3 w-3" /> Encrypted
          </span>
        </div>

        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Nearby devices
        </p>
        <div className="mt-2 space-y-1.5">
          {devices.map((d) => (
            <div
              key={d.n}
              className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                d.active
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/60 hover:border-border"
              }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  d.active ? "bg-primary text-white" : "bg-[hsl(var(--surface))] text-muted-foreground"
                }`}
              >
                <Devices size={18} weight="duotone" />
              </div>
              <span className="text-xs font-medium text-foreground">{d.n}</span>
              {d.active && (
                <span className="ml-auto rounded-md bg-foreground px-2.5 py-1 text-[10px] font-semibold text-background flex items-center gap-1">
                  <Send className="h-3 w-3" /> Send
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </OsWindow>
  );
}

/** rumahl Streaming — live camera / screen stream with device selector. */
export function StreamPreview() {
  return (
    <OsWindow title="rumahl Streaming" status="live · 1080p">
      <div className="p-5">
        <div className="relative aspect-video overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-[#1e293b] to-[#0f172a]">
          {/* Simulated camera view */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative h-24 w-24">
              <div className="absolute inset-0 rounded-full border border-white/10" />
              <div className="absolute inset-3 rounded-full border border-white/10" />
              <div className="absolute inset-0 flex items-center justify-center text-white/30">
                <VideoCamera size={36} weight="duotone" />
              </div>
            </div>
          </div>
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-mono text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            REC · Front door
          </span>
          <span className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-mono text-white/80">
            24 FPS
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Stream to
          </span>
          {["Living Room TV", "Phone", "Chromecast"].map((d, i) => (
            <span
              key={d}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                i === 0
                  ? "bg-foreground text-background"
                  : "border border-border/70 text-muted-foreground"
              }`}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </OsWindow>
  );
}
