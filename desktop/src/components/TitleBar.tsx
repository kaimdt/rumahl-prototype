import { useState, useEffect } from "react";

interface TitleBarProps {
  title?: string;
}

export function TitleBar({ title = "IORA Desktop" }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial maximized state
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().isMaximized().then(setIsMaximized);
    });
  }, []);

  const handleMinimize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("Failed to minimize:", error);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      const maximized = await window.isMaximized();

      if (maximized) {
        await window.unmaximize();
        setIsMaximized(false);
      } else {
        await window.maximize();
        setIsMaximized(true);
      }
    } catch (error) {
      console.error("Failed to maximize/restore:", error);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide(); // Hide instead of close (to tray)
    } catch (error) {
      console.error("Failed to close:", error);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-8 bg-background/60 backdrop-blur-xl border-b border-border/40 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left side - Title */}
      <div className="flex items-center gap-2 px-3">
        <span className="text-sm font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          IORA
        </span>
        <span className="text-xs text-muted-foreground font-medium">
          {title}
        </span>
      </div>

      {/* Right side - Window controls */}
      <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center hover:bg-foreground/5 transition-colors text-muted-foreground hover:text-foreground"
          title="Minimize"
        >
          <svg width="12" height="2" viewBox="0 0 12 2" fill="currentColor">
            <rect width="12" height="2" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-12 h-full flex items-center justify-center hover:bg-foreground/5 transition-colors text-muted-foreground hover:text-foreground"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="9" height="9" />
              <rect x="0" y="2" width="9" height="9" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1">
              <rect width="11" height="11" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center hover:bg-destructive transition-colors text-muted-foreground hover:text-destructive-foreground"
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1L11 11M11 1L1 11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
