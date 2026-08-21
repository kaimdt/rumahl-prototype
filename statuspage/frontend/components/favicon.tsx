"use client";

import { useEffect } from "react";
import { publicApi } from "@/lib/api";
import type { ComponentStatus } from "@/lib/types";

/**
 * Keeps the browser favicon in sync with the page status.
 *
 * The backend renders /api/favicon.svg in the current status color
 * (green/yellow/orange/red, blue while maintenance is active); the
 * ?v= cache-buster forces the browser to re-fetch after a color change.
 */

const FAVICON_KEY: Record<ComponentStatus | "maintenance", string> = {
  operational: "green",
  degraded: "yellow",
  partial_outage: "orange",
  major_outage: "red",
  maintenance: "blue",
};

export function FaviconUpdater() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const update = async () => {
      try {
        const status = await publicApi.status();
        if (cancelled) return;
        const key =
          status.scheduled_maintenance.length > 0 ? "maintenance" : status.overall;
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (link) {
          link.href = `/favicon.svg?v=${FAVICON_KEY[key]}`;
        }
      } catch {
        /* keep the current favicon when the API is unreachable */
      }
      timer = setTimeout(update, 60_000);
    };

    update();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return null;
}
