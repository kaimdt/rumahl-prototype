"use client";

import { useEffect } from "react";

/**
 * Global smooth anchor scrolling.
 * Intercepts clicks on `a[href^="#"]` (legal TOC, support "On This Page",
 * demo buttons, …) and scrolls with a sticky-header offset and easing.
 * Honors prefers-reduced-motion.
 */
export function SmoothAnchors() {
  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>(
        'a[href^="#"]'
      );
      if (!anchor) return;
      const id = anchor.getAttribute("href")?.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;

      e.preventDefault();
      const top = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({
        top,
        behavior: reduceMotion ? "auto" : "smooth",
      });
      history.replaceState(null, "", `#${id}`);
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
