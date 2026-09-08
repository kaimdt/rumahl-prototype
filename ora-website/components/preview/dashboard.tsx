import { OsWindow } from "./os-window";
import { LightWidget } from "@/components/light-widget";
import { ClimateWidget } from "@/components/climate-widget";
import { HardDrive, Zap, ShieldCheck } from "lucide-react";

/**
 * Dashboard preview — real rumahl widgets + system tiles.
 * These widgets are the actual rumahl OS components (interactive).
 */
export function DashboardPreview() {
  return (
    <OsWindow title="Dashboard · Home" status="live widgets">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
        <LightWidget />
        <ClimateWidget />
        <div className="rounded-2xl border border-border/50 bg-[hsl(var(--surface))] p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground mb-3">
            <HardDrive className="h-3.5 w-3.5" /> Storage
          </div>
          <p className="text-xl font-bold text-foreground font-mono">1.2 <span className="text-sm font-medium text-muted-foreground">/ 4 TB</span></p>
          <div className="mt-2 h-1 rounded-full bg-border/70 overflow-hidden">
            <div className="h-full w-[30%] rounded-full bg-primary" />
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-[hsl(var(--surface))] p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground mb-3">
            <Zap className="h-3.5 w-3.5" /> Energy today
          </div>
          <p className="text-xl font-bold text-foreground font-mono">8.4 <span className="text-sm font-medium text-muted-foreground">kWh</span></p>
          <p className="mt-1 text-[11px] text-success flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> 61% from solar
          </p>
        </div>
      </div>
    </OsWindow>
  );
}
