import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * OS window frame — matches the rumahl OS window chrome:
 * neutral traffic lights, slim titlebar, mono status slot.
 */
export function OsWindow({
  title,
  status,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  status?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_hsl(var(--border)/0.5)_inset,0_24px_48px_-24px_hsl(220_30%_20%/0.18)]",
        className
      )}
    >
      <div className="flex items-center gap-3 border-b border-border/60 bg-[hsl(var(--surface))] px-4 h-10">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-border/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-border/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-border/70" />
        </div>
        <span className="text-xs font-medium text-foreground/70 truncate">{title}</span>
        {status && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/80">{status}</span>
        )}
      </div>
      <div className={cn("bg-card", bodyClassName)}>{children}</div>
    </div>
  );
}

/**
 * App-icon tile — renders exactly like rumahl OS app icons:
 * remote `img` icons are shown transparent with object-contain (iconPad),
 * apps without an icon get the accent-gradient + duotone icon treatment.
 */
export function AppTile({
  icon: Icon,
  name,
  color,
  img,
  iconPad,
  className,
}: {
  icon: React.ElementType;
  name: string;
  color: string;
  /** Echte Icon-URL (z. B. /os/Home.png) — wie iconUrl im OS */
  img?: string;
  /** Wie iconPad im OS: kleiner skalieren, damit Ecken nicht abgeschnitten werden */
  iconPad?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1.15rem]",
          img ? "bg-transparent" : "text-white shadow-sm"
        )}
        style={
          img
            ? undefined
            : {
                background: `linear-gradient(145deg, ${color}, ${color}cc)`,
              }
        }
      >
        {img ? (
          <img
            src={img}
            alt={name}
            loading="lazy"
            className={cn("h-full w-full object-contain", iconPad ? "p-2.5" : "p-1")}
          />
        ) : (
          <Icon className="h-6 w-6" strokeWidth={1.8} />
        )}
      </div>
      <span className="text-[11px] font-medium text-foreground/80 text-center leading-tight max-w-[76px] truncate">
        {name}
      </span>
    </div>
  );
}
