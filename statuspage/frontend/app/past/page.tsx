"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { publicApi } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { IncidentCard } from "@/components/incident-card";
import { cn } from "@/lib/utils";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(y, m - 1, 1));
}

/**
 * Previous incidents — BetterStack style: month navigator with arrows,
 * a calendar preview marking days with outages, and one card per incident.
 */
export default function PastPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-40 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <PastContent />
    </Suspense>
  );
}

function PastContent() {
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<{
    incidents: Incident[];
    days: Record<string, { count: number; maintenance: boolean }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the list of months that have incidents.
  useEffect(() => {
    let cancelled = false;
    publicApi
      .incidentMonths()
      .then((res) => {
        if (cancelled) return;
        const list = res.months.map((m) => m.month);
        setMonths(list);
        if (list.length > 0) {
          const now = new Date();
          const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          // default to the current month when it has incidents, else the newest
          setMonth(list.includes(current) ? current : list[list.length - 1]);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected month.
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setData(null);
    publicApi
      .incidentsByMonth(month)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const index = month ? months.indexOf(month) : -1;

  const calendar = useMemo(() => {
    if (!month) return null;
    const [y, m] = month.split("-").map(Number);
    const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (number | null)[] = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    return { cells, daysInMonth };
  }, [month]);

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        Current status
      </Link>

      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
        Previous <span className="gradient-text">incidents</span>
      </h1>
      {months.length > 0 && (
        <p className="text-sm text-muted-foreground mb-8">
          {monthLabel(months[0])} to {monthLabel(months[months.length - 1])}
        </p>
      )}

      {error && <p className="text-sm text-status-major">{error}</p>}

      {months.length === 0 && !error ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : months.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-muted-foreground">
          No incidents recorded yet.
        </div>
      ) : (
        month && (
          <div className="space-y-6">
            {/* Month navigator */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => index > 0 && setMonth(months[index - 1])}
                disabled={index <= 0}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 transition-colors",
                  index <= 0
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:border-primary/40 hover:text-primary"
                )}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[180px] text-center text-[15px] font-bold text-foreground">
                {monthLabel(month)}
              </span>
              <button
                onClick={() => index < months.length - 1 && setMonth(months[index + 1])}
                disabled={index >= months.length - 1}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 transition-colors",
                  index >= months.length - 1
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:border-primary/40 hover:text-primary"
                )}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Calendar preview — days with incidents are marked */}
            {calendar && (
              <div className="surface-card p-5">
                <div className="flex items-center gap-2 mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Outage preview
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <div key={d} className="text-[10px] font-semibold text-muted-foreground/60 py-1">
                      {d}
                    </div>
                  ))}
                  {calendar.cells.map((day, i) => {
                    if (day === null) return <div key={`e-${i}`} />;
                    const key = `${month}-${String(day).padStart(2, "0")}`;
                    const info = data?.days[key];
                    return (
                      <div
                        key={key}
                        title={
                          info
                            ? `${info.count} ${info.count === 1 ? "incident" : "incidents"}${
                                info.maintenance ? " (maintenance)" : ""
                              }`
                            : "No incidents"
                        }
                        className={cn(
                          "relative flex h-9 items-center justify-center rounded-lg text-[12px] tabular-nums transition-colors",
                          info
                            ? info.maintenance && info.count === 1
                              ? "bg-info/15 text-info font-bold"
                              : "bg-status-major/15 text-status-major font-bold"
                            : "text-muted-foreground/70 hover:bg-muted/30"
                        )}
                      >
                        {day}
                        {info && (
                          <span
                            className={cn(
                              "absolute bottom-1 h-1 w-1 rounded-full",
                              info.maintenance ? "bg-info" : "bg-status-major"
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-status-major" /> incident
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-info" /> maintenance
                  </span>
                </div>
              </div>
            )}

            {/* Incident cards for the month */}
            {!data ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : data.incidents.length === 0 ? (
              <div className="surface-card p-8 text-center text-sm text-muted-foreground">
                No incidents in {monthLabel(month)}.
              </div>
            ) : (
              <div className="space-y-3">
                {data.incidents.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} />
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
