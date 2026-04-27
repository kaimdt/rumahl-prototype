import { useState, useEffect, type CSSProperties } from "react";
import { ArrowClockwise, Gear } from '@phosphor-icons/react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const maximized = await window.isMaximized();
      setIsMaximized(maximized);

      const { listen } = await import("@tauri-apps/api/event");
      const unlistenFn = await listen("tauri://window-event", (event) => {
        if (event.payload === "resized" || event.payload === "fullscreened") {
          window.isMaximized().then(setIsMaximized).catch(() => {});
        }
      });
      unlisten = unlistenFn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const dispatch = (type: string) => {
    window.dispatchEvent(new CustomEvent(type))
  }

  const handleWindowAction = async (action: "minimize" | "maximize" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      if (action === "minimize") {
        await window.minimize();
      } else if (action === "maximize") {
        const maximized = await window.isMaximized();
        if (maximized) {
          await window.unmaximize();
          setIsMaximized(false);
        } else {
          await window.maximize();
          setIsMaximized(true);
        }
      } else if (action === "close") {
        await window.hide();
      }
    } catch (error) {
      console.error(`Failed to ${action} window:`, error);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-14 px-4 gap-3 bg-transparent border-b border-white/10 backdrop-blur-3xl z-[9999]"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <div className="flex items-center gap-3 rounded-3xl bg-white/10 px-3 py-2 text-foreground/80 shadow-inner shadow-white/5" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
        <span className="h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(59,130,246,0.45)]" />
        <div className="leading-none">
          <div className="text-sm font-semibold tracking-[0.28em] uppercase">IORA</div>
          <div className="text-[10px] text-foreground/50 uppercase tracking-[0.24em]">Desktop</div>
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
        <button
          type="button"
          aria-label="Reload Remote Home"
          onClick={() => dispatch('desktop-reload-remote-home')}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-foreground/80 hover:bg-white/15 transition"
        >
          <ArrowClockwise size={16} weight="bold" />
        </button>
        <button
          type="button"
          aria-label="Open Desktop Settings"
          onClick={() => dispatch('desktop-open-settings')}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-foreground/80 hover:bg-white/15 transition"
        >
          <Gear size={16} weight="bold" />
        </button>
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => handleWindowAction("minimize")}
          className="flex h-10 w-10 items-center justify-center rounded-2xl text-foreground/80 hover:bg-white/15 hover:text-foreground transition"
        >
          <span className="block h-0.5 w-4 rounded-full bg-current" />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={() => handleWindowAction("maximize")}
          className="flex h-10 w-10 items-center justify-center rounded-2xl text-foreground/70 hover:bg-foreground/10 hover:text-foreground transition"
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M2.25 1.75H10.25V9.75H2.25V1.75Z" />
              <path d="M1.75 3.25V10.25H8.75" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.75" y="1.75" width="8.5" height="8.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => handleWindowAction("close")}
          className="flex h-10 w-10 items-center justify-center rounded-2xl text-foreground/70 hover:bg-destructive/15 hover:text-destructive transition"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M1.75 1.75L10.25 10.25" />
            <path d="M10.25 1.75L1.75 10.25" />
          </svg>
        </button>
      </div>
    </div>
  );
}
