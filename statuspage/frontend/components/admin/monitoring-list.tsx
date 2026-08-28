"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { adminApi } from "@/lib/api";
import { useAdminTranslation, type AdminTranslationKey } from "@/lib/admin-i18n";
import { CssEditor } from "@/components/admin/css-editor";

type Entity = "hosts" | "services" | "checks" | "alerts" | "agents" | "status-pages";
type ResourceMode = "current" | "history" | "performance";
type StatusPageResource = { service_id: string; view_mode: ResourceMode; enabled: boolean; history_days: number };
type StatusPageSection = { id: string | null; name: string; collapsed: boolean; auto_expand: boolean; resources: StatusPageResource[] };
type LayoutLink = { label: string; href: string; enabled: boolean };
type PageTranslation = { title: string; description: string; footer_text: string; nav_links: LayoutLink[]; footer_links: LayoutLink[] };
type PageTheme = { primary: string; background: string; surface: string; text: string; muted: string; border: string; max_width: string; radius: string };
const DEFAULT_THEME: PageTheme = { primary: "", background: "", surface: "", text: "", muted: "", border: "", max_width: "64rem", radius: "1rem" };
const DEFAULT_FOOTER_LINKS: LayoutLink[] = [
  { label: "rumahl.com", href: "https://rumahl.com/", enabled: true },
  { label: "App Store", href: "https://store.rumahl.com/", enabled: true },
  { label: "Previous incidents", href: "/past/", enabled: true },
  { label: "Uptime history", href: "/history/", enabled: true },
  { label: "RSS", href: "/rss/", enabled: true },
];

function normalizeSections(value: unknown): StatusPageSection[] {
  if (!Array.isArray(value)) return [{ id: null, name: "", collapsed: false, auto_expand: true, resources: [] }];
  const sections = value.map((section) => {
    const item = section as Record<string, unknown>;
    const resources = Array.isArray(item.resources) ? item.resources.map((resource) => {
      const row = resource as Record<string, unknown>;
      const mode: ResourceMode = dbBool(row.show_performance) ? "performance" : dbBool(row.show_uptime) ? "history" : "current";
      return { service_id: String(row.service_id ?? ""), view_mode: mode, enabled: !Object.hasOwn(row, "enabled") || dbBool(row.enabled), history_days: Number(row.history_days ?? 90) };
    }).filter((resource) => resource.service_id !== "") : [];
    return { id: item.id ? String(item.id) : null, name: String(item.name ?? ""), collapsed: dbBool(item.collapsed), auto_expand: !Object.hasOwn(item, "auto_expand") || dbBool(item.auto_expand), resources };
  });
  return sections.length > 0 ? sections : [{ id: null, name: "", collapsed: false, auto_expand: true, resources: [] }];
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const dbBool = (value: unknown) => value === true || value === 1 || value === "1";
const dbJson = (value: unknown, fallback: unknown) => {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const normalizeLinks = (value: unknown, fallback: LayoutLink[]): LayoutLink[] => Array.isArray(value)
  ? value.map((item) => ({ label: String((item as Record<string, unknown>).label ?? ""), href: String((item as Record<string, unknown>).href ?? ""), enabled: !Object.hasOwn(item as object, "enabled") || dbBool((item as Record<string, unknown>).enabled) })).filter((item) => item.label || item.href)
  : fallback;

const titles: Record<Entity, AdminTranslationKey> = {
  hosts: "monitoring.hosts",
  services: "monitoring.services",
  checks: "monitoring.checks",
  alerts: "monitoring.activeAlerts",
  agents: "monitoring.agents",
  "status-pages": "monitoring.statusPages",
};

export function MonitoringListTab({ entity }: { entity: Entity }) {
  const t = useAdminTranslation();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editorSection, setEditorSection] = useState<"settings" | "branding" | "structure" | "translations">("settings");
  const [notice, setNotice] = useState("");
  const emptyForm = { id: "", title: "", slug: "", description: "", canonical_domain: "", logo_url: "", logo_dark_url: "", mobile_logo_url: "", mobile_logo_dark_url: "", logo_mode: "same" as "same" | "adaptive" | "custom", header_brand_mode: "logo" as "logo" | "text", header_config: { sticky: true, show_theme_toggle: true, show_language_switcher: true }, nav_links: [{ label: "Overview", href: "/", enabled: true }, { label: "Uptime", href: "/history/", enabled: true }, { label: "Incidents", href: "/incidents/", enabled: true }] as LayoutLink[], footer_config: { enabled: true, text: "", show_timezone: true }, footer_links: DEFAULT_FOOTER_LINKS, favicon_url: "", custom_css_url: "", custom_css: "", path_enabled: true, domain_enabled: true, show_disabled_components: true, default_language: "en", enabled_locales: ["en", "de"] as string[], translations: {} as Record<string, PageTranslation>, sections: [{ id: null, name: "", collapsed: false, auto_expand: true, resources: [] }] as StatusPageSection[], original_service_ids: [] as string[], theme: DEFAULT_THEME, contact_links: [] as unknown };
  const [form, setForm] = useState(emptyForm);
  const [services, setServices] = useState<Array<Record<string, unknown>>>([]);

  const load = () => adminApi.monitoringList<Record<string, unknown>>(entity)
    .then((response) => { setItems(response.items); setError(false); })
    .catch(() => setError(true))
    .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    load();
    if (entity === "status-pages") {
      adminApi.monitoringList<Record<string, unknown>>("checks").then((response) => setServices(response.items.filter((monitor) => Boolean(monitor.service_id)).map((monitor) => ({ ...monitor, id: monitor.service_id, public_name: monitor.name, public_description: monitor.target })))).catch(() => undefined);
    }
    // `load` only depends on the selected entity and deliberately refreshes
    // when that admin tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  const saveStatusPage = async (close: boolean) => {
    const selectedServiceIds = form.sections.flatMap((section) => section.resources.map((resource) => resource.service_id));
    const result = await adminApi.saveStatusPage({ ...form, removed_service_ids: form.original_service_ids.filter((id) => !selectedServiceIds.includes(id)), enabled: true });
    const verification = result.verification;
    setNotice(verification ? `${verification.type} ${verification.name} = ${verification.value}` : "");
    if (close) {
      setShowForm(false);
      setForm(emptyForm);
    } else {
      setForm((current) => ({ ...current, id: result.id, original_service_ids: selectedServiceIds }));
    }
    setLoading(true);
    await load();
  };

  const editStatusPage = (item: Record<string, unknown>) => {
    setForm({
      id: String(item.id ?? ""), title: String(item.title ?? ""), slug: String(item.slug ?? ""),
      description: String(item.description ?? ""), canonical_domain: String(item.canonical_domain ?? ""),
      logo_url: String(item.logo_url ?? ""), favicon_url: String(item.favicon_url ?? ""),
      logo_dark_url: String(item.logo_dark_url ?? ""), logo_mode: (["same", "adaptive", "custom"].includes(String(item.logo_mode)) ? String(item.logo_mode) : "same") as "same" | "adaptive" | "custom",
      mobile_logo_url: String(item.mobile_logo_url ?? ""), mobile_logo_dark_url: String(item.mobile_logo_dark_url ?? ""),
      header_brand_mode: item.header_brand_mode === "text" ? "text" : "logo",
      header_config: { ...emptyForm.header_config, ...dbJson(item.header_config, {}) as object },
      nav_links: normalizeLinks(dbJson(item.nav_links, emptyForm.nav_links), emptyForm.nav_links),
      footer_config: { ...emptyForm.footer_config, ...dbJson(item.footer_config, {}) as object },
      footer_links: normalizeLinks(dbJson(item.footer_links, DEFAULT_FOOTER_LINKS), DEFAULT_FOOTER_LINKS),
      custom_css_url: String(item.custom_css_url ?? ""), custom_css: String(item.custom_css ?? ""), path_enabled: dbBool(item.path_enabled),
      domain_enabled: dbBool(item.domain_enabled), show_disabled_components: !Object.hasOwn(item, "show_disabled_components") || dbBool(item.show_disabled_components), sections: normalizeSections(item.sections), original_service_ids: Array.isArray(item.service_ids) ? item.service_ids.map(String) : [],
      default_language: String(item.default_language ?? "en"), enabled_locales: dbJson(item.enabled_locales, ["en", "de"]) as string[], translations: dbJson(item.translations, {}) as Record<string, PageTranslation>,
      theme: { ...DEFAULT_THEME, ...dbJson(item.theme, {}) as Partial<PageTheme> }, contact_links: dbJson(item.contact_links, []),
    });
    setEditorSection("settings");
    setShowForm(true);
  };

  const toggleStatusPage = async (item: Record<string, unknown>, field: "path_enabled" | "domain_enabled") => {
    await adminApi.saveStatusPage({
      id: item.id,
      title: item.title,
      slug: item.slug,
      description: item.description,
      logo_url: item.logo_url,
      favicon_url: item.favicon_url,
      custom_css_url: item.custom_css_url,
      custom_css: item.custom_css,
      logo_dark_url: item.logo_dark_url,
      logo_mode: item.logo_mode,
      mobile_logo_url: item.mobile_logo_url,
      mobile_logo_dark_url: item.mobile_logo_dark_url,
      header_brand_mode: item.header_brand_mode,
      header_config: dbJson(item.header_config, {}),
      nav_links: normalizeLinks(dbJson(item.nav_links, []), []),
      footer_config: dbJson(item.footer_config, {}),
      footer_links: normalizeLinks(dbJson(item.footer_links, []), []),
      canonical_domain: item.canonical_domain,
      theme: dbJson(item.theme, {}),
      contact_links: dbJson(item.contact_links, []),
      sections: normalizeSections(item.sections),
      path_enabled: field === "path_enabled" ? !dbBool(item.path_enabled) : dbBool(item.path_enabled),
      domain_enabled: field === "domain_enabled" ? !dbBool(item.domain_enabled) : dbBool(item.domain_enabled),
      show_disabled_components: !Object.hasOwn(item, "show_disabled_components") || dbBool(item.show_disabled_components),
      default_language: item.default_language ?? "en",
      enabled_locales: dbJson(item.enabled_locales, ["en"]),
      translations: dbJson(item.translations, {}),
      enabled: dbBool(item.enabled),
    });
    setLoading(true);
    await load();
  };

  const uploadBranding = async (file: File, kind: "logo" | "logo_dark" | "mobile_logo" | "mobile_logo_dark" | "favicon") => {
    const result = await adminApi.uploadBranding(file, kind, form.logo_mode);
    setForm((current) => ({
      ...current,
      ...(kind === "favicon" ? { favicon_url: result.url }
        : kind === "logo_dark" ? { logo_dark_url: result.url }
        : kind === "mobile_logo_dark" ? { mobile_logo_dark_url: result.url }
        : kind === "mobile_logo" ? { mobile_logo_url: result.url, mobile_logo_dark_url: result.dark_url ?? current.mobile_logo_dark_url }
        : { logo_url: result.url, logo_dark_url: result.dark_url ?? current.logo_dark_url }),
    }));
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => Object.values(item).some((value) => typeof value === "string" && value.toLowerCase().includes(query)));
  }, [items, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground">{t(titles[entity])}</h2>
        <div className="flex gap-2">
        {entity === "status-pages" && <button type="button" onClick={() => { setForm(emptyForm); setNotice(""); setEditorSection("settings"); setShowForm(true); }} className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("monitoring.addStatusPage")}</button>}
        <label className="flex min-w-0 items-center gap-2 rounded-xl border border-border/50 bg-card/40 px-3 py-2 sm:w-72">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("monitoring.search")} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
        </div>
      </div>
      {entity === "status-pages" && showForm && <div className="grid gap-3 rounded-2xl border border-border/45 bg-card/40 p-4 md:grid-cols-3">
        <div className="md:col-span-3 flex flex-col gap-3 border-b border-border/40 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="text-lg font-bold">{form.id ? t("monitoring.editStatusPage") : t("monitoring.createStatusPage")}</h3><p className="text-xs text-muted-foreground">{t("monitoring.editorHint")}</p></div>
          <div className="flex flex-wrap rounded-xl border border-border/50 bg-background/50 p-1">{(["settings", "branding", "structure", "translations"] as const).map((section) => <button key={section} type="button" onClick={() => setEditorSection(section)} className={`rounded-lg px-3 py-2 text-xs font-bold ${editorSection === section ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t(`monitoring.editor.${section}`)}</button>)}</div>
        </div>
        {editorSection === "settings" && <>
        <input aria-label={t("monitoring.titleField")} placeholder={t("monitoring.titleField")} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <input aria-label={t("monitoring.slugField")} placeholder={t("monitoring.slugField")} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <input aria-label={t("monitoring.domainField")} placeholder={t("monitoring.domainField")} value={form.canonical_domain} onChange={(event) => setForm({ ...form, canonical_domain: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <input aria-label={t("monitoring.descriptionField")} placeholder={t("monitoring.descriptionField")} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.path_enabled} onChange={(event) => setForm({ ...form, path_enabled: event.target.checked })} />{t("monitoring.pathAccess")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.domain_enabled} onChange={(event) => setForm({ ...form, domain_enabled: event.target.checked })} />{t("monitoring.domainAccess")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.show_disabled_components} onChange={(event) => setForm({ ...form, show_disabled_components: event.target.checked })} />{t("monitoring.showDisabledComponents")}</label>
        </>}
        {editorSection === "branding" && <>
        <input aria-label={t("monitoring.logoUrlField")} placeholder={t("monitoring.logoUrlField")} value={form.logo_url} onChange={(event) => setForm({ ...form, logo_url: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <label className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-sm font-semibold">{t("monitoring.upload")}<input type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBranding(file, "logo"); }} /></label>
        <label className="text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("monitoring.logoMode")}</span><select value={form.logo_mode} onChange={(event) => setForm({ ...form, logo_mode: event.target.value as typeof form.logo_mode })} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2"><option value="same">{t("monitoring.logoSame")}</option><option value="adaptive">{t("monitoring.logoAdaptive")}</option><option value="custom">{t("monitoring.logoCustom")}</option></select></label>
        {form.logo_mode === "custom" && <><input aria-label={t("monitoring.darkLogoUrlField")} placeholder={t("monitoring.darkLogoUrlField")} value={form.logo_dark_url} onChange={(event) => setForm({ ...form, logo_dark_url: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" /><label className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-sm font-semibold">{t("monitoring.logoCustom")}<input type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBranding(file, "logo_dark"); }} /></label></>}
        <label className="text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("monitoring.headerBrandMode")}</span><select value={form.header_brand_mode} onChange={(event) => setForm({ ...form, header_brand_mode: event.target.value as typeof form.header_brand_mode })} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2"><option value="logo">{t("monitoring.headerLogo")}</option><option value="text">{t("monitoring.headerText")}</option></select></label>
        {form.header_brand_mode === "logo" && <>
          <input aria-label={t("monitoring.mobileLogoUrlField")} placeholder={t("monitoring.mobileLogoUrlField")} value={form.mobile_logo_url} onChange={(event) => setForm({ ...form, mobile_logo_url: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
          <label className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-sm font-semibold">{t("monitoring.upload")}<input type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBranding(file, "mobile_logo"); }} /></label>
          {form.logo_mode === "custom" && <><input aria-label={t("monitoring.mobileDarkLogoUrlField")} placeholder={t("monitoring.mobileDarkLogoUrlField")} value={form.mobile_logo_dark_url} onChange={(event) => setForm({ ...form, mobile_logo_dark_url: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" /><label className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-sm font-semibold">{t("monitoring.logoCustom")}<input type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBranding(file, "mobile_logo_dark"); }} /></label></>}
        </>}
        <input aria-label={t("monitoring.faviconUrlField")} placeholder={t("monitoring.faviconUrlField")} value={form.favicon_url} onChange={(event) => setForm({ ...form, favicon_url: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <label className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-sm font-semibold">{t("monitoring.upload")}<input type="file" accept=".svg,.png,.ico" className="mt-1 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBranding(file, "favicon"); }} /></label>
        <input aria-label={t("monitoring.cssUrlField")} placeholder={t("monitoring.cssUrlField")} value={form.custom_css_url} onChange={(event) => setForm({ ...form, custom_css_url: event.target.value })} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
        <div className="md:col-span-3 rounded-xl border border-border/40 p-4">
          <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-bold">{t("monitoring.visualTheme")}</h4><p className="mt-1 text-xs text-muted-foreground">{t("monitoring.visualThemeHint")}</p></div><button type="button" onClick={() => setForm({ ...form, theme: DEFAULT_THEME })} className="rounded-lg border border-border/50 px-3 py-2 text-xs font-bold">{t("monitoring.resetTheme")}</button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
            ["primary", "monitoring.themePrimary"], ["background", "monitoring.themeBackground"], ["surface", "monitoring.themeSurface"], ["text", "monitoring.themeText"], ["muted", "monitoring.themeMuted"], ["border", "monitoring.themeBorder"],
          ] as const).map(([key, label]) => <ColorField key={key} label={t(label)} value={form.theme[key]} onChange={(value) => setForm({ ...form, theme: { ...form.theme, [key]: value } })} />)}
            <label className="text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("monitoring.contentWidth")}</span><input value={form.theme.max_width} onChange={(event) => setForm({ ...form, theme: { ...form.theme, max_width: event.target.value } })} placeholder="64rem" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("monitoring.cornerRadius")}</span><input value={form.theme.radius} onChange={(event) => setForm({ ...form, theme: { ...form.theme, radius: event.target.value } })} placeholder="1rem" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2" /></label>
          </div>
        </div>
        <div className="md:col-span-3 grid gap-3 rounded-xl border border-border/40 p-4 md:grid-cols-2">
          <h4 className="md:col-span-2 text-sm font-bold">{t("monitoring.headerNavigation")}</h4>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.header_config.sticky} onChange={(event) => setForm({ ...form, header_config: { ...form.header_config, sticky: event.target.checked } })} />{t("monitoring.stickyHeader")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.header_config.show_theme_toggle} onChange={(event) => setForm({ ...form, header_config: { ...form.header_config, show_theme_toggle: event.target.checked } })} />{t("monitoring.themeToggle")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.header_config.show_language_switcher} onChange={(event) => setForm({ ...form, header_config: { ...form.header_config, show_language_switcher: event.target.checked } })} />{t("monitoring.languageSwitcher")}</label>
          <div className="md:col-span-2"><LayoutLinksEditor links={form.nav_links} onChange={(nav_links) => setForm({ ...form, nav_links })} addLabel={t("monitoring.addNavLink")} labelPlaceholder={t("monitoring.linkLabel")} hrefPlaceholder={t("monitoring.linkHref")} /></div>
        </div>
        <div className="md:col-span-3 grid gap-3 rounded-xl border border-border/40 p-4 md:grid-cols-2">
          <h4 className="md:col-span-2 text-sm font-bold">{t("monitoring.footer")}</h4>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.footer_config.enabled} onChange={(event) => setForm({ ...form, footer_config: { ...form.footer_config, enabled: event.target.checked } })} />{t("monitoring.footerEnabled")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.footer_config.show_timezone} onChange={(event) => setForm({ ...form, footer_config: { ...form.footer_config, show_timezone: event.target.checked } })} />{t("monitoring.footerTimezone")}</label>
          <input value={form.footer_config.text} onChange={(event) => setForm({ ...form, footer_config: { ...form.footer_config, text: event.target.value } })} placeholder={t("monitoring.footerText")} className="md:col-span-2 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
          <div className="md:col-span-2"><LayoutLinksEditor links={form.footer_links} onChange={(footer_links) => setForm({ ...form, footer_links })} addLabel={t("monitoring.addFooterLink")} labelPlaceholder={t("monitoring.linkLabel")} hrefPlaceholder={t("monitoring.linkHref")} /></div>
        </div>
        <div className="md:col-span-3"><CssEditor value={form.custom_css} onChange={(custom_css) => setForm({ ...form, custom_css })} label={t("monitoring.cssEditor")} formatLabel={t("monitoring.formatCss")} /></div>
        </>}
        {editorSection === "structure" && <fieldset className="md:col-span-3 space-y-3 rounded-xl border border-border/40 p-3">
          <legend className="px-1 text-xs font-bold text-muted-foreground">{t("monitoring.displayedMonitors")}</legend>
          {form.sections.map((section, sectionIndex) => <div key={`${section.id ?? "new"}-${sectionIndex}`} className="rounded-xl border border-border/40 bg-background/40 p-3">
            <div className="flex items-center gap-2">
              <input value={section.name} onChange={(event) => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, name: event.target.value } : value) })} placeholder={t("monitoring.sectionName")} className="min-w-0 flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm" />
              <button type="button" aria-label={t("monitoring.moveUp")} disabled={sectionIndex === 0} onClick={() => setForm({ ...form, sections: moveItem(form.sections, sectionIndex, -1) })} className="rounded-lg border border-border/40 p-2 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
              <button type="button" aria-label={t("monitoring.moveDown")} disabled={sectionIndex === form.sections.length - 1} onClick={() => setForm({ ...form, sections: moveItem(form.sections, sectionIndex, 1) })} className="rounded-lg border border-border/40 p-2 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
              <button type="button" aria-label={t("monitoring.removeSection")} disabled={form.sections.length === 1} onClick={() => setForm({ ...form, sections: form.sections.filter((_, index) => index !== sectionIndex) })} className="rounded-lg border border-border/40 p-2 text-red-400 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("monitoring.blankSectionHint")}</p>
            {section.name && <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-border/30 bg-muted/15 px-3 py-2">
              <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={section.collapsed} onChange={(event) => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, collapsed: event.target.checked } : value) })} />{t("monitoring.collapsedDefault")}</label>
              <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={section.auto_expand} onChange={(event) => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, auto_expand: event.target.checked } : value) })} />{t("monitoring.autoExpandIssues")}</label>
            </div>}
            <div className="mt-3 space-y-2">{section.resources.map((resource) => {
              const service = services.find((candidate) => String(candidate.id) === resource.service_id);
              return <div key={resource.service_id} className="flex flex-col gap-2 rounded-lg bg-muted/25 px-3 py-2 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={resource.enabled} onChange={(event) => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, resources: value.resources.map((entry) => entry.service_id === resource.service_id ? { ...entry, enabled: event.target.checked } : entry) } : value) })} />{t("monitoring.visible")}</label>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{String(service?.public_name ?? service?.internal_name ?? resource.service_id)}</span>
                <select value={resource.view_mode} onChange={(event) => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, resources: value.resources.map((entry) => entry.service_id === resource.service_id ? { ...entry, view_mode: event.target.value as ResourceMode } : entry) } : value) })} className="rounded-lg border border-border/50 bg-background px-2 py-1.5 text-xs">
                  <option value="current">{t("monitoring.currentOnly")}</option><option value="history">{t("monitoring.withHistory")}</option><option value="performance">{t("monitoring.withPerformance")}</option>
                </select>
                {resource.view_mode !== "current" && <select value={resource.history_days} onChange={(event) => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, resources: value.resources.map((entry) => entry.service_id === resource.service_id ? { ...entry, history_days: Number(event.target.value) } : entry) } : value) })} className="rounded-lg border border-border/50 bg-background px-2 py-1.5 text-xs">{[7,14,30,60,90,180,365].map((days) => <option key={days} value={days}>{days} {t("monitoring.days")}</option>)}</select>}
                <button type="button" aria-label={t("monitoring.removeService")} onClick={() => setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, resources: value.resources.filter((entry) => entry.service_id !== resource.service_id) } : value) })} className="rounded-lg border border-border/40 p-1.5 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>;
            })}</div>
            <select value="" onChange={(event) => { const serviceId = event.target.value; if (serviceId) setForm({ ...form, sections: form.sections.map((value, index) => index === sectionIndex ? { ...value, resources: [...value.resources, { service_id: serviceId, view_mode: "current", enabled: true, history_days: 90 }] } : value) }); }} className="mt-3 w-full rounded-lg border border-dashed border-border/60 bg-background px-3 py-2 text-sm">
              <option value="">{t("monitoring.addService")}</option>{services.filter((service) => !form.sections.some((value) => value.resources.some((resource) => resource.service_id === String(service.id)))).map((service) => <option key={String(service.id)} value={String(service.id)}>{String(service.public_name ?? service.internal_name ?? service.id)}</option>)}
            </select>
          </div>)}
          <button type="button" onClick={() => setForm({ ...form, sections: [...form.sections, { id: null, name: "", collapsed: false, auto_expand: true, resources: [] }] })} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("monitoring.addSection")}</button>
        </fieldset>}
        {editorSection === "translations" && <fieldset className="md:col-span-3 space-y-4 rounded-xl border border-border/40 p-4">
          <legend className="px-1 text-xs font-bold text-muted-foreground">{t("monitoring.languages")}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm"><span className="mb-1 block font-semibold">{t("monitoring.defaultLanguage")}</span><select value={form.default_language} onChange={(event) => setForm({ ...form, default_language: event.target.value })} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2">{form.enabled_locales.map((locale) => <option key={locale} value={locale}>{locale.toUpperCase()}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block font-semibold">{t("monitoring.enabledLanguages")}</span><input value={form.enabled_locales.join(", ")} onChange={(event) => { const enabled_locales = event.target.value.split(",").map((value) => value.trim()).filter((value) => /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)); setForm({ ...form, enabled_locales: enabled_locales.length ? enabled_locales : [form.default_language] }); }} placeholder="en, de" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2" /></label>
          </div>
          {form.enabled_locales.filter((locale) => locale !== form.default_language).map((locale) => {
            const localized = form.translations[locale] ?? { title: "", description: "", footer_text: "", nav_links: form.nav_links, footer_links: form.footer_links };
            const change = (next: Partial<PageTranslation>) => setForm({ ...form, translations: { ...form.translations, [locale]: { ...localized, ...next } } });
            return <section key={locale} className="space-y-3 rounded-xl border border-border/40 bg-background/30 p-4">
              <h4 className="font-bold">{locale.toUpperCase()}</h4>
              <div className="grid gap-3 md:grid-cols-2"><input value={localized.title} onChange={(event) => change({ title: event.target.value })} placeholder={t("monitoring.translatedTitle")} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" /><input value={localized.description} onChange={(event) => change({ description: event.target.value })} placeholder={t("monitoring.translatedDescription")} className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" /></div>
              <input value={localized.footer_text} onChange={(event) => change({ footer_text: event.target.value })} placeholder={t("monitoring.translatedFooter")} className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm" />
              <div><p className="mb-2 text-xs font-bold text-muted-foreground">{t("monitoring.translatedNavigation")}</p><LayoutLinksEditor links={localized.nav_links} onChange={(nav_links) => change({ nav_links })} addLabel={t("monitoring.addNavLink")} labelPlaceholder={t("monitoring.linkLabel")} hrefPlaceholder={t("monitoring.linkHref")} /></div>
              <div><p className="mb-2 text-xs font-bold text-muted-foreground">{t("monitoring.translatedFooterLinks")}</p><LayoutLinksEditor links={localized.footer_links} onChange={(footer_links) => change({ footer_links })} addLabel={t("monitoring.addFooterLink")} labelPlaceholder={t("monitoring.linkLabel")} hrefPlaceholder={t("monitoring.linkHref")} /></div>
            </section>;
          })}
        </fieldset>}
        <div className="md:col-span-3 flex flex-wrap justify-end gap-2 border-t border-border/40 pt-4"><button type="button" disabled={!form.title || !form.slug} onClick={() => void saveStatusPage(false)} className="rounded-xl border border-border/60 bg-background px-5 py-2.5 text-sm font-bold text-foreground hover:bg-muted/40 disabled:opacity-50">{t("monitoring.save")}</button><button type="button" disabled={!form.title || !form.slug} onClick={() => void saveStatusPage(true)} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">{t("monitoring.saveAndClose")}</button></div>
      </div>}
      {entity === "status-pages" && notice && <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 font-mono text-xs text-foreground">{notice}</div>}
      {loading ? <State text={t("monitoring.loading")} /> : error ? <State text={t("monitoring.error")} /> : filtered.length === 0 ? <State text={t("monitoring.noData")} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((item) => {
            const primary = String(item.display_name ?? item.internal_name ?? item.title ?? item.name ?? item.slug ?? item.id);
            const secondary = String(item.description ?? item.internal_description ?? item.environment ?? item.hostname ?? "");
            const status = String(item.status ?? item.state ?? (item.enabled ? "operational" : "unknown"));
            return (
              <article key={String(item.id)} className="rounded-2xl border border-border/45 bg-card/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate text-sm font-bold text-foreground">{primary}</h3>{secondary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{secondary}</p>}</div>
                  <span className="rounded-full bg-muted/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{status.replaceAll("_", " ")}</span>
                </div>
                {entity === "status-pages" && <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => editStatusPage(item)} className="inline-flex items-center gap-1 rounded-lg border border-border/40 px-2.5 py-1.5 text-xs font-semibold"><Pencil className="h-3 w-3" />{t("monitoring.edit")}</button>
                  <button type="button" onClick={() => void toggleStatusPage(item, "path_enabled")} className="rounded-lg border border-border/40 px-2.5 py-1.5 text-xs font-semibold">{t("monitoring.pathAccess")}: {dbBool(item.path_enabled) ? "on" : "off"}</button>
                  <button type="button" onClick={() => void toggleStatusPage(item, "domain_enabled")} className="rounded-lg border border-border/40 px-2.5 py-1.5 text-xs font-semibold">{t("monitoring.domainAccess")}: {dbBool(item.domain_enabled) ? "on" : "off"}</button>
                  {dbBool(item.path_enabled) && <a href={`/s/${String(item.slug)}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-border/40 px-2.5 py-1.5 text-xs font-semibold">/s/{String(item.slug)}</a>}
                </div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function State({ text }: { text: string }) {
  return <div className="rounded-2xl border border-border/45 bg-card/40 p-8 text-sm text-muted-foreground">{text}</div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : "#6366f1";
  return <label className="text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</span><span className="flex rounded-xl border border-border/50 bg-background p-1"><input type="color" value={color} onChange={(event) => onChange(event.target.value)} className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="#6366f1" className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none" /></span></label>;
}

function LayoutLinksEditor({ links, onChange, addLabel, labelPlaceholder, hrefPlaceholder }: { links: LayoutLink[]; onChange: (links: LayoutLink[]) => void; addLabel: string; labelPlaceholder: string; hrefPlaceholder: string }) {
  return <div className="space-y-2">{links.map((link, index) => <div key={index} className="grid gap-2 sm:grid-cols-[auto_1fr_1.5fr_auto] sm:items-center">
    <input type="checkbox" checked={link.enabled} onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />
    <input value={link.label} onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder={labelPlaceholder} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm" />
    <input value={link.href} onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, href: event.target.value } : item))} placeholder={hrefPlaceholder} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm" />
    <button type="button" onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-border/40 p-2 text-red-400"><Trash2 className="h-4 w-4" /></button>
  </div>)}<button type="button" onClick={() => onChange([...links, { label: "", href: "", enabled: true }])} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs font-bold"><Plus className="h-3.5 w-3.5" />{addLabel}</button></div>;
}
