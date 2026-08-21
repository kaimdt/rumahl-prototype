"use client";

import { useState } from "react";
import { Activity, CalendarClock, FlaskConical, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { setToken } from "@/lib/api";
import { LoginForm } from "@/components/admin/login-form";
import { ComponentsTab } from "@/components/admin/components-tab";
import { IncidentsTab } from "@/components/admin/incidents-tab";
import { SettingsTab } from "@/components/admin/settings-tab";
import { ChecksTab } from "@/components/admin/checks-tab";
import { cn } from "@/lib/utils";

type Tab = "components" | "incidents" | "checks" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "components", label: "Components", icon: Activity },
  { id: "incidents", label: "Incidents", icon: CalendarClock },
  { id: "checks", label: "Checks", icon: FlaskConical },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
];

export default function AdminPage() {
  const [authed, setAuthed] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("rumahl-status-admin-token") !== null : false
  );
  const [tab, setTab] = useState<Tab>("components");

  if (!authed) {
    return <LoginForm onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 py-10">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Status <span className="gradient-text">admin</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage components, incidents, monitoring and notifications.
          </p>
        </div>
        <button
          onClick={() => {
            setToken(null);
            setAuthed(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-8 border-b border-border/40 pb-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
              tab === id
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </button>
        ))}
        <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
          <Settings className="h-3.5 w-3.5" />
          changes appear on the public page immediately
        </span>
      </div>

      {tab === "components" && <ComponentsTab />}
      {tab === "incidents" && <IncidentsTab />}
      {tab === "checks" && <ChecksTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
