"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { publicApi } from "@/lib/api";
import type { PublicStatusPageResponse } from "@/lib/types";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/public-i18n";

const cache = new Map<string, Promise<PublicStatusPageResponse>>();

function loadTenant(slug?: string): Promise<PublicStatusPageResponse> {
  const key = slug ?? `${window.location.hostname}:default`;
  const existing = cache.get(key);
  if (existing) return existing;
  const request = publicApi.statusPage(slug).catch((error) => { cache.delete(key); throw error; });
  cache.set(key, request);
  return request;
}

export function useTenantPage() {
  const { i18n: translation } = useTranslation();
  const pathname = usePathname();
  const slug = useMemo(() => pathname.match(/^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)/)?.[1], [pathname]);
  const admin = pathname.startsWith("/admin");
  const [rawPage, setRawPage] = useState<PublicStatusPageResponse["page"] | null>(null);
  const [loading, setLoading] = useState(!admin);

  useEffect(() => {
    if (admin) { setRawPage(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    loadTenant(slug).then((response) => {
      if (!active) return;
      setRawPage(response.page);
      const saved = window.localStorage.getItem(`status-language:${response.page.id}`);
      const browserLanguage = navigator.language;
      const language = [saved, browserLanguage, browserLanguage.split("-")[0], response.page.default_language]
        .find((candidate) => candidate && response.page.enabled_locales.includes(candidate));
      void i18n.changeLanguage(language ?? response.page.default_language);
    }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [admin, slug]);

  const page = useMemo(() => {
    if (!rawPage) return null;
    const localized = rawPage.translations?.[translation.language] ?? rawPage.translations?.[translation.language.split("-")[0]];
    if (!localized) return rawPage;
    return {
      ...rawPage,
      title: localized.title || rawPage.title,
      description: localized.description || rawPage.description,
      nav_links: localized.nav_links ?? rawPage.nav_links,
      footer_links: localized.footer_links ?? rawPage.footer_links,
      footer_config: { ...rawPage.footer_config, text: localized.footer_text || rawPage.footer_config?.text },
    };
  }, [rawPage, translation.language]);

  const setLanguage = (language: string) => {
    if (!rawPage?.enabled_locales.includes(language)) return;
    window.localStorage.setItem(`status-language:${rawPage.id}`, language);
    void i18n.changeLanguage(language);
  };
  return { page, loading, tenantPrefix: slug ? `/s/${slug}` : "", language: translation.language, setLanguage };
}
