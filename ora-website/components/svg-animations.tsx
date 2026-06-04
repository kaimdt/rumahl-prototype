"use client";

import { useEffect, useState } from "react";

/* ─── Animated circuit lines — drawing + pulse ─── */
export function CircuitLines({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes draw-line { to { stroke-dashoffset: 0; } }
        @keyframes pulse-node { 0%,100% { r: 3; opacity: 0.3; } 50% { r: 5; opacity: 0.7; } }
        @keyframes flow-dot { to { stroke-dashoffset: -40; } }
        .circuit-line { stroke-dasharray: 400; stroke-dashoffset: 400; animation: draw-line 3s ease-out forwards; }
        .circuit-node { animation: pulse-node 3s ease-in-out infinite; }
        .circuit-flow { stroke-dasharray: 8 32; stroke-dashoffset: 0; animation: flow-dot 2s linear infinite; }
      `}</style>
      {/* Horizontal + vertical lines */}
      <path d="M100,100 h200 v80 h100" className="circuit-line" stroke="hsl(var(--primary)/0.10)" strokeWidth="1" style={{ animationDelay: '0s' }} />
      <path d="M500,300 h-150 v-60 h-80" className="circuit-line" stroke="hsl(var(--primary-accent)/0.08)" strokeWidth="1" style={{ animationDelay: '0.5s' }} />
      <path d="M180,180 v120 h250" className="circuit-line" stroke="hsl(var(--primary)/0.06)" strokeWidth="1" style={{ animationDelay: '1s' }} />
      <path d="M650,150 v180 h-120" className="circuit-line" stroke="hsl(var(--ai-glow-purple)/0.06)" strokeWidth="1" style={{ animationDelay: '1.5s' }} />
      <path d="M250,350 h300 v-60" className="circuit-line" stroke="hsl(var(--ai-glow-teal)/0.07)" strokeWidth="1" style={{ animationDelay: '0.8s' }} />
      {/* Nodes */}
      <circle cx="100" cy="100" r="3" className="circuit-node" fill="hsl(var(--primary)/0.3)" style={{ animationDelay: '0s' }} />
      <circle cx="300" cy="100" r="3" className="circuit-node" fill="hsl(var(--primary)/0.3)" style={{ animationDelay: '1s' }} />
      <circle cx="300" cy="180" r="3" className="circuit-node" fill="hsl(var(--primary-accent)/0.25)" style={{ animationDelay: '2s' }} />
      <circle cx="500" cy="240" r="3" className="circuit-node" fill="hsl(var(--primary)/0.3)" style={{ animationDelay: '1.5s' }} />
      <circle cx="430" cy="300" r="3" className="circuit-node" fill="hsl(var(--ai-glow-purple)/0.25)" style={{ animationDelay: '0.5s' }} />
      {/* Flow dots on lines */}
      <circle cx="0" cy="0" r="2" fill="hsl(var(--primary)/0.4)" className="circuit-flow" style={{ offsetPath: "path('M100,100 h200 v80 h100')", offsetDistance: "0%", animation: "flow-dot 3s linear infinite" } as React.CSSProperties} />
    </svg>
  );
}

/* ─── Animated sparkle field ─── */
export function SparkleField({ className }: { className?: string }) {
  const [sparkles] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      delay: Math.random() * 4,
      duration: Math.random() * 3 + 2,
    }))
  );

  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes sparkle-twinkle {
          0%, 100% { opacity: 0.1; transform: scale(0.5); }
          50% { opacity: 0.8; transform: scale(1.3); }
        }
      `}</style>
      {sparkles.map(s => (
        <circle
          key={s.id}
          cx={s.x} cy={s.y} r={s.size}
          fill="hsl(var(--primary)/0.5)"
          style={{ animation: `sparkle-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`, transformOrigin: `${s.x}px ${s.y}px` }}
        />
      ))}
    </svg>
  );
}

/* ─── Animated waveform / equalizer bars ─── */
export function WaveformBars({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes bar-bounce {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
      `}</style>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
        <rect
          key={i}
          x={i * 20 + 4} y="0" width="8" height="40" rx="4"
          fill="hsl(var(--primary)/0.12)"
          style={{ animation: `bar-bounce ${0.8 + Math.random() * 0.6}s ease-in-out ${i * 0.15}s infinite`, transformOrigin: `${i * 20 + 8}px 20px` }}
        />
      ))}
    </svg>
  );
}

/* ─── Animated ring pulse ─── */
export function PulseRings({ className, count = 3 }: { className?: string; count?: number }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes ring-expand {
          0% { r: 8; opacity: 0.5; stroke-width: 2; }
          100% { r: 50; opacity: 0; stroke-width: 0.5; }
        }
      `}</style>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          cx="60" cy="60" r="8"
          stroke="hsl(var(--primary)/0.3)" fill="none"
          style={{ animation: `ring-expand 3s ease-out ${i * 1}s infinite` }}
        />
      ))}
      <circle cx="60" cy="60" r="4" fill="hsl(var(--primary)/0.5)" />
    </svg>
  );
}

/* ─── Animated flowing path with dots ─── */
export function FlowingDots({ className, pathDef }: { className?: string; pathDef: string }) {
  return (
    <svg className={className} viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes flow-along {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -24; }
        }
      `}</style>
      <path d={pathDef} stroke="hsl(var(--primary)/0.08)" strokeWidth="1" fill="none" />
      <path d={pathDef} stroke="hsl(var(--primary)/0.25)" strokeWidth="2" fill="none"
        strokeDasharray="4 20" style={{ animation: 'flow-along 3s linear infinite' }} />
    </svg>
  );
}
