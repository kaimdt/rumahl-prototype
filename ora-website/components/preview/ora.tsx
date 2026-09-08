import { OsWindow } from "./os-window";
import { Sparkles, FolderOpen, ImageIcon, Check, ArrowDown } from "lucide-react";

/** ORA — command → system action → visible result. */
export function OraPreview() {
  return (
    <OsWindow title="ORA · rumahl Assistant" status="local model · ollama">
      <div className="p-5 space-y-4">
        {/* Command */}
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-[hsl(var(--surface))] px-3.5 py-2.5">
            <p className="text-xs text-foreground/90">
              Find the photos from our beach trip last summer
            </p>
          </div>
        </div>

        {/* Action */}
        <div className="flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] font-medium text-primary">
            <ArrowDown className="h-3 w-3" />
            ORA searched your library
          </div>
        </div>

        {/* Result */}
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--surface))] text-primary">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 rounded-2xl rounded-tl-sm border border-border/60 bg-card px-3.5 py-2.5">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" />
              Found 24 photos
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Created album <span className="font-medium text-foreground/80">Beach Trip 2025</span>{" "}
              in Photos — ready to share.
            </p>
            <div className="mt-2.5 flex items-center gap-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/20 text-amber-600">
                <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              </div>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/20 text-cyan-600">
                <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              </div>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/20 text-emerald-600">
                <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              </div>
              <span className="ml-1 inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-foreground/70">
                <FolderOpen className="h-3 w-3" /> Open album
              </span>
            </div>
          </div>
        </div>
      </div>
    </OsWindow>
  );
}

/** Automation editor — IF / AND / THEN blocks, ORA-generated. */
export function AutomationPreview() {
  const block = (label: string, value: string, tone: "neutral" | "accent" | "action") => (
    <div className="flex-1 rounded-xl border border-border/60 bg-card p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </p>
      <p
        className={`text-xs font-semibold ${
          tone === "accent" ? "text-primary" : tone === "action" ? "text-success" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );

  return (
    <OsWindow title="Automation Editor" status="trigger · condition · action">
      <div className="p-5">
        <div className="flex flex-col gap-1.5">
          {block("IF", "Front door opens", "neutral")}
          {block("AND", "Nobody is home", "accent")}
          {block("THEN", "Turn hallway lights on", "action")}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2.5">
          <p className="text-[11px] text-foreground/80">
            <span className="font-semibold text-primary">ORA</span> created this automation from
            your request: <span className="font-medium">&ldquo;lights when I come home&rdquo;</span>
          </p>
          <span className="shrink-0 rounded-md bg-foreground px-2.5 py-1 text-[10px] font-semibold text-background">
            Enable
          </span>
        </div>
      </div>
    </OsWindow>
  );
}
