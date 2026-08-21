import { OsWindow, AppTile } from "./os-window";
import { Info, ShieldCheck, WifiHigh, Bot } from "lucide-react";

/**
 * rumahl App Store — rendered with the REAL system app icons where they
 * exist; apps without an icon use the exact OS fallback treatment
 * (accent gradient + duotone icon), same as installed apps in rumahl.
 */
const storeApps = [
  { n: "Home", c: "System", img: "/os/Home.png", icon: Info, color: "oklch(0.68 0.17 155)" },
  { n: "Files", c: "System", img: "/os/folder.png", icon: Info, color: "oklch(0.68 0.16 80)", pad: true },
  { n: "Photos", c: "System", img: "/os/Images.png", icon: Info, color: "oklch(0.62 0.15 260)" },
  { n: "Store", c: "System", img: "/os/appstore.png", icon: Info, color: "oklch(0.65 0.2 285)" },
  { n: "NAS", c: "System", img: "/os/NasApp.png", icon: Info, color: "oklch(0.68 0.16 205)" },
  { n: "Settings", c: "System", img: "/os/Settings.png", icon: Info, color: "oklch(0.64 0.08 245)" },
  { n: "Security", c: "System", img: undefined, icon: ShieldCheck, color: "oklch(0.68 0.17 155)" },
  { n: "Network", c: "System", img: undefined, icon: WifiHigh, color: "oklch(0.67 0.16 205)" },
  { n: "ORA", c: "Intelligence", img: undefined, icon: Bot, color: "oklch(0.67 0.19 305)" },
];

const categories = ["All", "System", "Media", "Files", "Intelligence", "Privacy"];

export function AppStorePreview() {
  return (
    <OsWindow title="rumahl Store" status="store.rumahl.com">
      <div className="p-5">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-[hsl(var(--surface))] px-3.5 py-2.5">
          <span className="text-xs text-muted-foreground">⌕</span>
          <span className="text-xs text-muted-foreground/70">Search the store…</span>
        </div>

        {/* Categories */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {categories.map((c, idx) => (
            <span
              key={c}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                idx === 0
                  ? "bg-foreground text-background"
                  : "border border-border/70 text-muted-foreground"
              }`}
            >
              {c}
            </span>
          ))}
        </div>

        {/* Featured banner */}
        <div className="mt-5 flex items-center justify-between rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 via-transparent to-transparent px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/os/appstore.png" alt="Store" className="h-10 w-10 object-contain" />
            <div>
              <p className="text-sm font-bold text-foreground">rumahl Store</p>
              <p className="text-[11px] text-muted-foreground">Apps for your home · one-click installs</p>
            </div>
          </div>
          <span className="rounded-lg bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background">
            Open
          </span>
        </div>

        {/* App grid */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {storeApps.map((a) => (
            <div
              key={a.n}
              className="flex flex-col gap-2.5 rounded-xl border border-border/60 p-3 hover:border-border transition-colors"
            >
              <AppTile icon={a.icon} name="" color={a.color} img={a.img} iconPad={a.pad} className="items-start" />
              <div className="-mt-1">
                <p className="text-xs font-semibold text-foreground truncate">{a.n}</p>
                <p className="text-[10px] text-muted-foreground">{a.c}</p>
              </div>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-[10px] font-medium text-primary">Install</span>
                <span className="text-[9px] text-muted-foreground/70 font-mono">installed</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </OsWindow>
  );
}
