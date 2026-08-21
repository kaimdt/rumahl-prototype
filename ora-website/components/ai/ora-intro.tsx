"use client";

import { useEffect, useState } from "react";
import { ORAIcon, ORALogo } from "@/components/ora-logo";
import { cn } from "@/lib/utils";

/**
 * ORA intro animation for the /ai page.
 *
 * On page load the O appears centered, glows with expanding rings,
 * morphs into the ORA wordmark and fades away. Shown once per browser
 * session; skipped entirely for prefers-reduced-motion.
 */
export function ORAIntro() {
  const [phase, setPhase] = useState<"hidden" | "in" | "morph" | "out">("hidden");

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion) return; // stay hidden for reduced-motion users

    const raf = requestAnimationFrame(() => setPhase("in"));

    const t1 = setTimeout(() => setPhase("morph"), 2200);
    const t2 = setTimeout(() => setPhase("out"), 2950);
    const t3 = setTimeout(() => setPhase("hidden"), 3700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center bg-background/85 backdrop-blur-md pointer-events-none",
        phase === "out" && "ora-intro-out"
      )}
    >
      <div
        className={cn(
          "ora-intro relative flex items-center justify-center",
          phase === "morph" && "ora-intro-morphing"
        )}
      >
        {/* Weicher Farb-Glow hinter dem O */}
        <div className="ora-intro-glowball absolute h-56 w-56 rounded-full bg-primary/30 blur-[70px] sm:h-72 sm:w-72" />

        {/* The O — centered, glowing, with expanding rings */}
        <div className="relative flex items-center justify-center">
          <ORAIcon className="ora-intro-mark h-28 w-auto text-primary sm:h-36" />
          <span className="ora-intro-ring" />
          <span className="ora-intro-ring ora-intro-ring-2" />
          <span className="ora-intro-ring ora-intro-ring-3" />
        </div>

        {/* The wordmark — fades in during the morph */}
        <div className="absolute inset-0 flex items-center justify-center">
          <ORALogo className="ora-intro-word h-14 w-auto text-foreground opacity-0 sm:h-16" />
        </div>
      </div>
    </div>
  );
}
