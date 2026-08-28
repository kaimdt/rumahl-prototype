"use client";

import { Activity, CheckCircle2, TriangleAlert, Wrench, XCircle } from "lucide-react";
import type { ComponentStatus } from "@/lib/types";
import { STATUS_META, formatDateTime } from "@/lib/status-meta";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import "@/lib/public-i18n";

const BANNER_ICON: Record<ComponentStatus, typeof CheckCircle2> = {
  operational: CheckCircle2,
  degraded: Activity,
  partial_outage: TriangleAlert,
  major_outage: XCircle,
  maintenance: Wrench,
};

export function StatusBanner({
  status,
  pageName,
  updatedAt,
}: {
  status: ComponentStatus;
  pageName: string;
  updatedAt: string;
}) {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  const Icon = BANNER_ICON[status];

  return (
    <section className="statuspage-status-banner relative overflow-hidden pt-14 pb-10 lg:pt-20 lg:pb-14" data-status={status}>
      {/* dot pattern + glow, rumahl style */}
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          backgroundImage: `radial-gradient(hsl(var(--ai-glow-teal) / 0.30) 1px, transparent 1px)`,
          backgroundSize: "26px 26px",
          maskImage:
            "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 65% at 50% 0%, black 30%, transparent 82%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--ai-glow-teal) / 0.14), transparent 65%)",
        }}
      />

      <div className="statuspage-status-banner-inner relative mx-auto max-w-5xl px-5 lg:px-8 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground mb-4">
          {pageName}
        </p>
        <div
          data-status-badge
          className={cn(
            "inline-flex items-center gap-3 rounded-full border px-5 py-2.5 mb-6",
            meta.border,
            meta.bg
          )}
        >
          <span className={cn("relative flex h-2.5 w-2.5")}>
            <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", meta.dot)} />
            <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", meta.dot)} />
          </span>
          <span className={cn("text-sm font-bold tracking-wide", meta.text)}>
            {t(`status.${status}`)}
          </span>
        </div>
        <h1 className="statuspage-status-message text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.1] mb-4 flex items-center justify-center gap-3">
          <Icon className={cn("h-8 w-8 sm:h-10 sm:w-10", meta.text)} strokeWidth={1.5} />
          <span className="gradient-text">{t(`status.description.${status}`)}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("status.lastUpdated", { date: formatDateTime(updatedAt) })}
        </p>
      </div>
    </section>
  );
}
