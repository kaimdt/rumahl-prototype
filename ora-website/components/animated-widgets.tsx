"use client";

import { useEffect, useState } from "react";
import {
  Lightbulb, MusicNotes, Power, ThermometerSimple,
  Lightning, Drop, Shield, WifiHigh,
} from "@phosphor-icons/react";

/* ─── Simulated animated widgets in hero background ─── */

interface AnimatedWidget {
  id: number;
  x: number; y: number;
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  active: boolean;
  delay: number;
  duration: number;
  floatY: number;
  floatX: number;
}

function generateWidgets(): AnimatedWidget[] {
  const colors = ["#f59e0b", "#3b82f6", "#10b981", "#06b6d4", "#f97316", "#8b5cf6", "#ec4899", "#14b8a6"];
  return [
    { id: 1, x: 5, y: 15, icon: <Lightbulb size={16} weight="fill" />, label: "Ceiling Light", value: "78%", color: colors[0], active: true, delay: 0, duration: 18, floatY: 30, floatX: 15 },
    { id: 2, x: 72, y: 10, icon: <MusicNotes size={16} weight="fill" />, label: "Living Room", value: "Playing", color: colors[3], active: true, delay: 3, duration: 20, floatY: 25, floatX: -10 },
    { id: 3, x: 15, y: 55, icon: <Power size={16} weight="fill" />, label: "TV Switch", value: "On", color: colors[5], active: true, delay: 1.5, duration: 22, floatY: 20, floatX: 12 },
    { id: 4, x: 65, y: 60, icon: <ThermometerSimple size={16} weight="fill" />, label: "Bedroom", value: "21.5°", color: colors[4], active: true, delay: 5, duration: 19, floatY: 35, floatX: -8 },
    { id: 5, x: 35, y: 35, icon: <Lightning size={16} weight="fill" />, label: "Energy", value: "1.2kW", color: colors[6], active: true, delay: 2, duration: 21, floatY: 28, floatX: 18 },
    { id: 6, x: 85, y: 40, icon: <Drop size={16} weight="fill" />, label: "Humidity", value: "52%", color: colors[7], active: true, delay: 4, duration: 17, floatY: 22, floatX: -14 },
    { id: 7, x: 50, y: 75, icon: <Shield size={16} weight="fill" />, label: "Alarm", value: "Armed", color: colors[2], active: true, delay: 6, duration: 23, floatY: 18, floatX: 10 },
    { id: 8, x: 22, y: 78, icon: <WifiHigh size={16} weight="fill" />, label: "Network", value: "Online", color: colors[1], active: true, delay: 7, duration: 16, floatY: 32, floatX: -6 },
  ];
}

function MiniWidget({ w }: { w: AnimatedWidget }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${w.x}%`,
        top: `${w.y}%`,
        animation: `hero-widget-float ${w.duration}s ease-in-out ${w.delay}s infinite`,
        '--float-y': `${w.floatY}px`,
        '--float-x': `${w.floatX}px`,
        opacity: 0.35,
      } as React.CSSProperties}
    >
      <div className="glass-card-shimmer rounded-xl px-3 py-2 flex items-center gap-2"
        style={{
          background: `linear-gradient(180deg, hsl(var(--foreground) / 0.04) 0%, transparent 38%), linear-gradient(165deg, hsl(var(--card) / 0.5) 0%, hsl(var(--card) / 0.25) 55%, hsl(var(--card) / 0.08) 100%)`,
          backdropFilter: 'blur(20px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
          border: '1px solid hsl(var(--foreground) / 0.05)',
          boxShadow: `0 4px 16px hsl(0 0% 0% / 0.06), inset 0 1px 0 hsl(var(--foreground) / 0.04)`,
          minWidth: '120px',
        }}>
        <span style={{ color: w.color }}>{w.icon}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-foreground/80 truncate leading-tight">{w.label}</p>
          <p className="text-[9px] text-muted-foreground/60 font-mono leading-tight">{w.value}</p>
        </div>
      </div>
    </div>
  );
}

export function AnimatedWidgets() {
  const [widgets] = useState(() => generateWidgets());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return (
    <>
      <style>{`
        @keyframes hero-widget-float {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(var(--float-x), calc(var(--float-y) * 0.5)) rotate(1deg); }
          50% { transform: translate(calc(var(--float-x) * 0.3), var(--float-y)) rotate(-0.5deg); }
          75% { transform: translate(calc(var(--float-x) * -0.5), calc(var(--float-y) * 0.6)) rotate(0.5deg); }
        }
      `}</style>
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {widgets.map(w => <MiniWidget key={w.id} w={w} />)}
        {/* Fade edges */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, hsl(var(--background)) 100%)',
          }}
        />
      </div>
    </>
  );
}
