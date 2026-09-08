"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════
   rumahl Logo — normalized paths, viewBox 144.092 x 52.292
   ═══════════════════════════════════════════════════════════ */

const O_PATH =
  "m 26.86,52.292 c 15.3,0 26.860002,-11.288 26.860002,-26.18 C 53.720002,11.22 42.228,0 26.86,0 11.492,0 0,11.22 0,26.112 c 0,14.892 11.56,26.18 26.86,26.18 z m 0,-9.52 c -9.248,0 -16.32,-6.868 -16.32,-16.66 0,-9.792 7.072,-16.592 16.32,-16.592 9.248,0 16.32,6.8 16.32,16.592 0,9.792 -7.072,16.66 -16.32,16.66 z";

const FULL_PATH =
  "m 26.86,52.292 c 15.3,0 26.860002,-11.288 26.860002,-26.18 C 53.720002,11.22 42.228,0 26.86,0 11.492,0 0,11.22 0,26.112 c 0,14.892 11.56,26.18 26.86,26.18 z m 0,-9.52 c -9.248,0 -16.32,-6.868 -16.32,-16.66 0,-9.792 7.072,-16.592 16.32,-16.592 9.248,0 16.32,6.8 16.32,16.592 0,9.792 -7.072,16.66 -16.32,16.66 z m 29.240042,8.704 h 10.54 v -18.36 h 8.908 l 10.268,18.36 h 11.832 l -11.56,-20.196 c 5.372,-2.448 8.772,-7.344 8.772,-14.28 0,-10.608 -7.48,-16.184 -17.952,-16.184 h -20.808 z m 10.54,-27.54 V 9.996 h 10.336 c 4.42,0 7.344,2.788 7.344,7.004 0,4.148 -2.924,6.936 -7.344,6.936 z M 126.81999,0.816 h -13.94 l -17.272008,50.66 h 11.152008 l 3.4,-10.336 h 19.38 l 3.4,10.336 h 11.152 z m -13.668,31.144 6.732,-20.536 6.664,20.536 z";

export function ORAIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 54 53"
      className={cn("h-8 w-8", className)}
      {...props}
    >
      <path d={O_PATH} fill="currentColor" />
    </svg>
  );
}

export function ORALogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 145 53"
      className={cn("h-8 w-auto", className)}
      {...props}
    >
      <path d={FULL_PATH} fill="currentColor" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   ProductName — [O] Name in lighter weight
   ═══════════════════════════════════════════════════════════ */

interface ProductNameProps {
  name: string;
  className?: string;
  logoSize?: number;
}

export function ProductName({ name, className, logoSize = 72 }: ProductNameProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 align-baseline whitespace-nowrap", className)}>
      <span className="inline-flex shrink-0" style={{ width: logoSize, height: logoSize * 0.366 }}>
        <ORALogo className="w-full h-full" />
      </span>
      <span
        style={{
          fontFamily: "var(--font-sans), 'Manrope', sans-serif",
          fontWeight: 400,
          fontSize: "inherit",
          lineHeight: "inherit",
          color: "inherit",
        }}
      >
        {name}
      </span>
    </span>
  );
}

export default ORAIcon;
