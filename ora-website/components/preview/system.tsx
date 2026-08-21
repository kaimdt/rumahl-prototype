import { OsWindow } from "./os-window";
import { Check } from "lucide-react";

/** Installation terminal — one-liner installer, honest platforms. */
export function InstallPreview() {
  return (
    <OsWindow title="Terminal · install" status="rumahl@host:~">
      <div className="p-4 font-mono text-[11px] leading-relaxed space-y-2.5 bg-[#0f172a] text-slate-300">
        <div><span className="text-sky-400">$</span> curl -fsSL https://rumahl.com/install | bash</div>
        <div className="pl-3 border-l-2 border-emerald-500/30 text-slate-400">
          <span className="text-emerald-400">✓</span> Detected: Raspberry Pi 5 · 8 GB<br />
          <span className="text-emerald-400">✓</span> Installing rumahl OS 1.1 …<br />
          <span className="text-emerald-400">✓</span> Starting services
        </div>
        <div className="pl-3 text-slate-300">
          <span className="text-amber-400">ℹ</span> Open <span className="text-sky-300">http://rumahl.local</span> to finish setup
        </div>
        <div><span className="text-sky-400">$</span> <span className="animate-pulse">▊</span></div>
      </div>
    </OsWindow>
  );
}

/** System & security — settings list with storage/security state. */
export function SystemPreview() {
  const rows = [
    { n: "Storage", v: "1.2 / 4 TB", ok: true },
    { n: "Memory", v: "3.2 / 8 GB", ok: true },
    { n: "Updates", v: "up to date", ok: true },
    { n: "Session lock", v: "enabled", ok: true },
    { n: "Two-factor auth", v: "enabled", ok: true },
  ];
  return (
    <OsWindow title="System Settings" status="rumahl-os 1.1">
      <div className="p-4">
        <div className="rounded-xl border border-border/60 divide-y divide-border/50">
          {rows.map((r) => (
            <div key={r.n} className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-xs font-medium text-foreground">{r.n}</span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                {r.ok && <Check className="h-3 w-3 text-success" />}
                {r.v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </OsWindow>
  );
}
