"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function ORAIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      className={cn("h-8 w-8", className)}
      {...props}
    >
      <defs>
        <linearGradient id="ora-icon-grad" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="url(#ora-icon-grad)" />
      <text
        x="50%"
        y="54%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontFamily="var(--font-geist-sans), Inter, sans-serif"
        fontSize="72"
        fontWeight="700"
        fill="#ffffff"
      >
        O
      </text>
    </svg>
  );
}

export function ORALogo({
  className,
  showIcon = true,
  ...props
}: React.SVGProps<SVGSVGElement> & { showIcon?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 96"
      className={cn("h-8 w-auto", className)}
      {...props}
    >
      <defs>
        <linearGradient id="ora-logo-grad" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="ora-text-grad" x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="currentColor" />
        </linearGradient>
      </defs>
      {showIcon && (
        <>
          <rect x="0" y="8" width="80" height="80" rx="20" fill="url(#ora-logo-grad)" />
          <text
            x="40"
            y="52"
            dominantBaseline="middle"
            textAnchor="middle"
            fontFamily="var(--font-geist-sans), Inter, sans-serif"
            fontSize="44"
            fontWeight="700"
            fill="#ffffff"
          >
            O
          </text>
        </>
      )}
      <text
        x={showIcon ? 100 : 4}
        y="62"
        fontFamily="var(--font-geist-sans), Inter, sans-serif"
        fontSize="40"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="-0.02em"
      >
        ORA
      </text>
    </svg>
  );
}

export default ORAIcon;
