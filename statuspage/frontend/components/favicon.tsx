"use client";

import { useEffect } from "react";
import { useTenantPage } from "@/lib/tenant-page";

/**
 * Keeps the browser favicon in sync with the page status.
 *
 * The backend renders /api/favicon.svg in the current status color
 * (green/yellow/orange/red, blue while maintenance is active); the
 * ?v= cache-buster forces the browser to re-fetch after a color change.
 */

export function FaviconUpdater() {
  const { page, loading } = useTenantPage();
  useEffect(() => {
    if (loading || !page) return;
    document.querySelectorAll('link[rel="icon"][data-status-favicon="true"]').forEach((node) => node.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.dataset.statusFavicon = "true";
    link.href = page.favicon_url || "/favicon.svg";
    document.head.appendChild(link);
    return () => link.remove();
  }, [loading, page]);

  return null;
}
