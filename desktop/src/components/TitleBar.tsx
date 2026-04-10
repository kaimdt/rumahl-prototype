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
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "32px",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {/* Left side - Title */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingLeft: "12px",
          fontSize: "13px",
          fontWeight: 500,
          color: "var(--color-text)",
        }}
      >
        <span
          style={{
            background: "linear-gradient(135deg, #6366f1, #a855f7)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontWeight: 700,
          }}
        >
          IORA
        </span>
        <span style={{ color: "var(--color-muted)", fontSize: "12px" }}>
          {title}
        </span>
      </div>

      {/* Right side - Window controls */}
      <div style={{ display: "flex", height: "100%" }}>
        <button
          onClick={handleMinimize}
          style={{
            width: "46px",
            height: "100%",
            border: "none",
            background: "transparent",
            color: "var(--color-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            transition: "background 0.15s",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          title="Minimize"
        >
          −
        </button>
        <button
          onClick={handleMaximize}
          style={{
            width: "46px",
            height: "100%",
            border: "none",
            background: "transparent",
            color: "var(--color-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            transition: "background 0.15s",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? "❐" : "□"}
        </button>
        <button
          onClick={handleClose}
          style={{
            width: "46px",
            height: "100%",
            border: "none",
            background: "transparent",
            color: "var(--color-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            transition: "background 0.15s, color 0.15s",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#ef4444";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--color-muted)";
          }}
          title="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}
