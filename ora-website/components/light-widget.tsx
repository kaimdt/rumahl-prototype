"use client";

import { useState, useCallback } from "react";
import { Lightbulb } from "@phosphor-icons/react";

export function LightWidget() {
  const [on, setOn] = useState(true);
  const [brightness, setBrightness] = useState(192); // 0-255 like HA
  const [rgbColor, setRgbColor] = useState<[number, number, number]>([255, 180, 80]); // warm amber

  const lightColor = `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`;
  const displayBrightness = brightness;
  const displayIsOn = on;
  const brightnessPercent = Math.round((displayBrightness / 255) * 100);

  const toggle = () => setOn(!on);

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Full-size widget (not compact) — matches rumahl LightWidget exactly */}
      <div
        className={`glass-card glass-card-shimmer rounded-2xl relative overflow-hidden cursor-pointer select-none ${displayIsOn ? 'widget-glow-active' : ''}`}
        onClick={toggle}
      >
        {/* Brightness fill overlay — clips from left */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsOn
              ? `linear-gradient(to right, ${lightColor} 0%, color-mix(in srgb, ${lightColor} 30%, transparent) 60%, transparent 100%)`
              : 'transparent',
            opacity: displayIsOn ? 0.30 : 0,
            clipPath: `inset(0 ${100 - brightnessPercent}% 0 0)`,
            transition: 'clip-path 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Icon container — exact rumahl style */}
              <div
                className="icon-container-premium p-2.5 rounded-xl transition-all duration-300"
                data-active={displayIsOn ? "true" : "false"}
                style={{
                  backgroundColor: displayIsOn
                    ? `color-mix(in srgb, ${lightColor} 25%, transparent)`
                    : 'hsl(var(--muted) / 0.5)',
                  color: displayIsOn ? lightColor : 'hsl(var(--muted-foreground))',
                  boxShadow: displayIsOn
                    ? `0 4px 20px color-mix(in srgb, ${lightColor} 20%, transparent), 0 0 40px color-mix(in srgb, ${lightColor} 8%, transparent)`
                    : 'none',
                } as React.CSSProperties}
              >
                <Lightbulb size={20} weight={displayIsOn ? "fill" : "regular"} />
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">Living Room Light</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {displayIsOn ? `${brightnessPercent}%` : 'Off'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
