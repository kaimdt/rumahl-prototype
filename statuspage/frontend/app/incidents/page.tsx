"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, SearchX } from "lucide-react";
import { publicApi } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { IncidentList } from "@/components/incident-list";
import { IncidentCard } from "@/components/incident-card";
import { IncidentTimeline } from "@/components/incident-timeline";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import "@/lib/public-i18n";

const PER_PAGE = 15;

export default function IncidentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-40 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <IncidentsContent />
    </Suspense>
  );
}

function IncidentsContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const slug = pathname.match(/^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)/)?.[1] ?? null;
  const tenantPrefix = slug ? `/s/${slug}` : "";
  const detailId = searchParams.get("id");

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [detail, setDetail] = useState<Incident | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    const load = (showLoader = false) => {
      if (showLoader) setLoading(true);
      publicApi.incident(detailId, slug)
      .then((incident) => {
        if (!cancelled) {
          setDetail(incident);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load incident");
          setLoading(false);
        }
      });
    };
    load(true);
    const timer = window.setInterval(() => load(false), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detailId, slug]);

  useEffect(() => {
    if (detailId) return;
    let cancelled = false;
    const load = (showLoader = false) => {
      if (showLoader) setLoading(true);
      publicApi.incidents(page, PER_PAGE, slug)
      .then((res) => {
        if (!cancelled) {
          setIncidents(res.incidents);
          setPages(res.pages);
          setTotal(res.total);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load incidents");
          setLoading(false);
        }
      });
    };
    load(true);
    const timer = window.setInterval(() => load(false), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [page, detailId, slug]);

  if (loading && !detail && incidents.length === 0) {
    return (
      <div className="flex items-center justify-center py-40 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error && incidents.length === 0 && !detail) {
    return (
      <div className="mx-auto max-w-6xl px-5 lg:px-8 py-24 text-center">
        <SearchX className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="statuspage-main mx-auto max-w-6xl px-5 lg:px-8 py-12">
      {detail ? (
        <div className="space-y-6">
          <a
            href={`${tenantPrefix}/incidents/`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("incident.all")}
          </a>
          <IncidentCard incident={detail} expanded />
          {(detail.affected_components?.length ?? 0) > 0 && <section className="surface-card p-5 sm:p-6"><h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("incident.affectedComponents")}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{detail.affected_components.map((component) => <div key={component.service_id} className="rounded-xl border border-border/35 bg-muted/15 p-4"><p className="font-bold text-foreground">{component.name}</p>{component.description && <p className="mt-1 text-xs text-muted-foreground">{component.description}</p>}<p className="mt-3 text-xs font-bold uppercase text-status-degraded">{component.status.replaceAll("_", " ")}</p></div>)}</div></section>}
          <IncidentTimeline incident={detail} />
        </div>
      ) : (
        <>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
            {t("incident.history")}
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            {t("incident.recorded", { count: total })}
          </p>

          <IncidentList incidents={incidents} />

          {pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border border-border/50 px-3 py-2 text-[12.5px] font-semibold transition-colors",
                  page <= 1
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:border-primary/40 hover:text-primary"
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> {t("incident.newer")}
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {page} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border border-border/50 px-3 py-2 text-[12.5px] font-semibold transition-colors",
                  page >= pages
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:border-primary/40 hover:text-primary"
                )}
              >
                {t("incident.older")} <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
