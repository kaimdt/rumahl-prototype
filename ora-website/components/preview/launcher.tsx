import { OsWindow, AppTile } from "./os-window";
import { Info, Terminal } from "lucide-react";

/**
 * rumahl OS launcher — rendered with the REAL system app icons
 * from the rumahl OS frontend (frontend/public/icons), same
 * iconUrl + object-contain treatment as the OS launcher grid.
 */
const apps = [
  { name: "Home", img: "/os/Home.png", icon: Info, color: "oklch(0.68 0.17 155)" },
  { name: "Files", img: "/os/folder.png", icon: Info, color: "oklch(0.68 0.16 80)", pad: true },
  { name: "Photos", img: "/os/Images.png", icon: Info, color: "oklch(0.62 0.15 260)" },
  { name: "Media", img: "/os/video_folder.png", icon: Info, color: "oklch(0.66 0.17 250)", pad: true },
  { name: "Music", img: "/os/music_folder.png", icon: Info, color: "oklch(0.66 0.17 250)", pad: true },
  { name: "Store", img: "/os/appstore.png", icon: Info, color: "oklch(0.65 0.2 285)" },
  { name: "NAS", img: "/os/NasApp.png", icon: Info, color: "oklch(0.68 0.16 205)" },
  { name: "Notes", img: "/os/document_folder.png", icon: Info, color: "oklch(0.66 0.16 45)", pad: true },
  { name: "Info", img: undefined, icon: Info, color: "oklch(0.67 0.16 205)" },
  { name: "Terminal", img: undefined, icon: Terminal, color: "oklch(0.6 0.14 40)" },
];

export function LauncherPreview() {
  return (
    <OsWindow title="Launcher" status="rumahl-os · desktop">
      <div className="p-5">
        <div className="mx-auto mb-5 max-w-xs">
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-[hsl(var(--surface))] px-3.5 py-2">
            <span className="text-[11px] text-muted-foreground">⌕</span>
            <span className="text-xs text-muted-foreground/70">Search apps…</span>
            <span className="ml-auto rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
              ⌘K
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-5 gap-x-2 gap-y-5">
          {apps.map((a) => (
            <AppTile
              key={a.name}
              icon={a.icon}
              name={a.name}
              color={a.color}
              img={a.img}
              iconPad={a.pad}
            />
          ))}
        </div>

        {/* Dock — echte Icons, wie im OS */}
        <div className="mt-6 flex justify-center">
          <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-[hsl(var(--surface))] px-3 py-2.5">
            {apps.slice(0, 7).map((a) =>
              a.img ? (
                <div
                  key={a.name}
                  className="flex h-9 w-9 items-center justify-center overflow-hidden"
                >
                  <img src={a.img} alt={a.name} className="h-full w-full object-contain p-0.5" />
                </div>
              ) : (
                <div
                  key={a.name}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                  style={{ background: `linear-gradient(145deg, ${a.color}, ${a.color}cc)` }}
                >
                  <a.icon className="h-4.5 w-4.5" strokeWidth={1.8} />
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </OsWindow>
  );
}
