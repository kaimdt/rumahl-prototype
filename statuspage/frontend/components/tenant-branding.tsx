"use client";

import { useEffect } from "react";
import { useTenantPage } from "@/lib/tenant-page";

/** Applies tenant-owned browser branding on every public route. */
export function TenantBranding() {
  const { page, loading, language } = useTenantPage();

  useEffect(() => {
    if (loading || !page) return;
    document.querySelectorAll('[data-status-page-branding="true"]').forEach((element) => element.remove());
    let stylesheet: HTMLLinkElement | null = null;
    let themeStyle: HTMLStyleElement | null = null;
    let inlineStyle: HTMLStyleElement | null = null;
    let favicon: HTMLLinkElement | null = null;
      document.title = page.title;
      document.documentElement.lang = language;
      const theme = page.theme ?? {};
      const declarations = [
        theme.primary && `--tenant-primary:${theme.primary}`,
        theme.background && `--tenant-background:${theme.background}`,
        theme.surface && `--tenant-surface:${theme.surface}`,
        theme.text && `--tenant-text:${theme.text}`,
        theme.muted && `--tenant-muted:${theme.muted}`,
        theme.border && `--tenant-border:${theme.border}`,
        theme.max_width && `--tenant-max-width:${theme.max_width}`,
        theme.radius && `--tenant-radius:${theme.radius}`,
      ].filter(Boolean).join(";");
      if (declarations) {
        themeStyle = document.createElement("style");
        themeStyle.dataset.statusPageBranding = "true";
        themeStyle.textContent = `:root{${declarations}}.statuspage-shell{background:var(--tenant-background,inherit);color:var(--tenant-text,inherit)}.statuspage-main,.statuspage-header-inner,.statuspage-footer-inner{max-width:var(--tenant-max-width,64rem)}.statuspage-header,.statuspage-footer,.statuspage-component-group,.statuspage-component,.statuspage-status-banner{border-color:var(--tenant-border,hsl(var(--border)))}.statuspage-component-group,.statuspage-component,.statuspage-status-banner{border-radius:var(--tenant-radius,1rem)}.statuspage-component-group,.statuspage-component{background:var(--tenant-surface,transparent)}.statuspage-nav-link[aria-current=\"page\"],.statuspage-footer-link:hover{color:var(--tenant-primary,hsl(var(--primary)))}.statuspage-shell .text-muted-foreground{color:var(--tenant-muted,hsl(var(--muted-foreground)))}`;
        document.head.appendChild(themeStyle);
      }
      if (page.custom_css_url) {
        stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = page.custom_css_url;
        stylesheet.dataset.statusPageBranding = "true";
        document.head.appendChild(stylesheet);
      }
      if (page.custom_css) {
        inlineStyle = document.createElement("style");
        inlineStyle.dataset.statusPageBranding = "true";
        inlineStyle.textContent = page.custom_css;
        document.head.appendChild(inlineStyle);
      }
      if (page.favicon_url) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        favicon.href = page.favicon_url;
        favicon.dataset.statusPageBranding = "true";
        document.head.appendChild(favicon);
      }
      document.documentElement.removeAttribute("data-tenant-loading");
    return () => {
      stylesheet?.remove();
      themeStyle?.remove();
      inlineStyle?.remove();
      favicon?.remove();
    };
  }, [language, loading, page]);

  useEffect(() => {
    if (!loading) document.documentElement.removeAttribute("data-tenant-loading");
  }, [loading]);

  return null;
}
