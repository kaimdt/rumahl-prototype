"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface HeadlineLine {
  /** Full text of the line, e.g. "Your home." */
  text: string;
  /** Render this line with a shimmering gradient + glow. */
  highlight?: boolean;
}

/**
 * Animated hero headline — each line reveals as a unit (fade + rise, the
 * same pattern as the site's Reveal), and the highlighted line gets a
 * flowing gradient shimmer with a soft glow. The DOM structure mirrors the
 * original headline exactly, so layout and position never change.
 */
export function AnimatedHeadline({
  lines,
  className,
  startDelay = 150,
  lineGap = 120,
}: {
  lines: HeadlineLine[];
  className?: string;
  /** Delay before the first line starts (ms). */
  startDelay?: number;
  /** Stagger between lines (ms). */
  lineGap?: number;
}) {
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const begin = () => setStarted(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const raf = requestAnimationFrame(begin);
      return () => cancelAnimationFrame(raf);
    }
    const raf = requestAnimationFrame(begin);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <h1 ref={ref} className={className}>
      {lines.map((line, li) => (
        <span
          key={li}
          className={cn(
            "hero-line block",
            line.highlight && "hero-shimmer-text",
            started && "hero-line-in",
            li < lines.length - 1 && "mb-1"
          )}
          style={{ animationDelay: `${startDelay + li * lineGap}ms` }}
        >
          {line.text}
        </span>
      ))}
    </h1>
  );
}
