"use client";

import { useState } from "react";
import { Flame, Snowflake, ThermometerSimple } from "@phosphor-icons/react";

export function ClimateWidget() {
  const [temp, setTemp] = useState(21.5);
  const [targetTemp, setTargetTemp] = useState(21.0);
  const [mode, setMode] = useState<"heat" | "cool" | "off">("heat");

  const displayIsActive = mode !== "off";
  const actionColor = mode === "heat" ? "#f97316" : mode === "cool" ? "#3b82f6" : "transparent";
  const clampedPercent = Math.min(100, Math.max(0, ((targetTemp - 10) / 20) * 100)); // 10-30°C range

  const getModeIcon = () => {
    if (mode === "heat") return <Flame size={20} weight="fill" />;
    if (mode === "cool") return <Snowflake size={20} weight="fill" />;
    return <ThermometerSimple size={20} />;
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      <div
        className={`glass-card glass-card-shimmer rounded-2xl relative overflow-hidden cursor-pointer select-none ${displayIsActive ? 'widget-glow-active' : ''}`}
        onClick={() => {
          const modes: Array<"heat" | "cool" | "off"> = ["heat", "cool", "off"];
          const idx = modes.indexOf(mode);
          setMode(modes[(idx + 1) % 3]);
        }}
      >
        {/* Temperature fill overlay */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsActive
              ? `linear-gradient(to right, ${actionColor} 0%, color-mix(in srgb, ${actionColor} 30%, transparent) 60%, transparent 100%)`
              : 'transparent',
            opacity: displayIsActive ? 0.30 : 0,
            clipPath: `inset(0 ${100 - clampedPercent}% 0 0)`,
            transition: 'clip-path 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="icon-container-premium p-2.5 rounded-xl transition-all duration-300"
                data-active={displayIsActive ? "true" : "false"}
                style={{
                  backgroundColor: displayIsActive
                    ? `color-mix(in srgb, ${actionColor} 25%, transparent)`
                    : 'hsl(var(--muted) / 0.5)',
                  color: displayIsActive ? actionColor : 'hsl(var(--muted-foreground))',
                  boxShadow: displayIsActive
                    ? `0 4px 20px color-mix(in srgb, ${actionColor} 20%, transparent), 0 0 40px color-mix(in srgb, ${actionColor} 8%, transparent)`
                    : 'none',
                } as React.CSSProperties}
              >
                {getModeIcon()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">Living Room Climate</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {displayIsActive ? `${targetTemp.toFixed(1)}°C` : 'Off'}
                </p>
              </div>
            </div>
            {displayIsActive && (
              <div className="text-right shrink-0 ml-2">
                <div className="flex items-baseline gap-0.5">
                  <ThermometerSimple size={12} weight="fill" className="text-muted-foreground" />
                  <span className="text-sm font-light text-muted-foreground">{temp.toFixed(1)}°</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
