"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function ORAIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      className={cn("h-8 w-8", className)}
      fill="none"
      {...props}
    >
      <text
        x="64"
        y="84"
        textAnchor="middle"
        fontFamily="'Plus Jakarta Sans', var(--font-geist-sans), Inter, system-ui, sans-serif"
        fontSize="100"
        fontWeight="800"
        letterSpacing="-0.06em"
        fill="currentColor"
      >
        O
      </text>
    </svg>
  );
}

export function ORALogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 260 80"
      className={cn("h-8 w-auto", className)}
      fill="none"
      {...props}
    >
      <text
        x="0"
        y="63"
        fontFamily="'Plus Jakarta Sans', var(--font-geist-sans), Inter, system-ui, sans-serif"
        fontSize="68"
        fontWeight="800"
        letterSpacing="-0.06em"
        fill="currentColor"
      >
        ORA
      </text>
    </svg>
  );
}

export default ORAIcon;
