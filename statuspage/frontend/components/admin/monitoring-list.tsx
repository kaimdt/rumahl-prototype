"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/lib/api";
import { useAdminTranslation, type AdminTranslationKey } from "@/lib/admin-i18n";

type Entity = "hosts" | "services" | "checks" | "alerts" | "agents" | "status-pages";

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

  useEffect(() => {
    setLoading(true);
    adminApi.monitoringList<Record<string, unknown>>(entity)
      .then((response) => { setItems(response.items); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [entity]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => Object.values(item).some((value) => typeof value === "string" && value.toLowerCase().includes(query)));
  }, [items, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground">{t(titles[entity])}</h2>
        <label className="flex min-w-0 items-center gap-2 rounded-xl border border-border/50 bg-card/40 px-3 py-2 sm:w-72">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("monitoring.search")} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
      </div>
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
