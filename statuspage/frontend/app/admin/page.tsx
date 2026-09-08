"use client";

import { useEffect, useState } from "react";
import { Activity, Bell, CalendarClock, FlaskConical, Globe2, HardDrive, LayoutDashboard, LogOut, SlidersHorizontal } from "lucide-react";
import { adminApi, setToken } from "@/lib/api";
import { LoginForm } from "@/components/admin/login-form";
import { IncidentsTab } from "@/components/admin/incidents-tab";
import { SettingsTab } from "@/components/admin/settings-tab";
import { MonitoringOverviewTab } from "@/components/admin/monitoring-overview";
import { useAdminTranslation } from "@/lib/admin-i18n";
import { MonitoringListTab } from "@/components/admin/monitoring-list";
import { MonitorCenter } from "@/components/admin/monitor-center";
import { cn } from "@/lib/utils";

type Tab = "overview" | "hosts" | "services" | "alerts" | "status-pages" | "incidents" | "checks" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "incidents", label: "Incidents", icon: CalendarClock },
  { id: "checks", label: "Monitors", icon: FlaskConical },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
];

export default function AdminPage() {
  const t = useAdminTranslation();
  const centralLogoutUrl = process.env.NEXT_PUBLIC_CENTRAL_LOGOUT_URL;
  const [authed, setAuthed] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("rumahl-status-admin-token") !== null : false
  );
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    if (!authed) {
      adminApi.verify(null).then(() => setAuthed(true)).catch(() => undefined);
    }
  }, [authed]);

  const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
    { id: "overview", label: t("monitoring.overview"), icon: LayoutDashboard },
    { id: "hosts", label: t("monitoring.hosts"), icon: HardDrive },
    { id: "services", label: t("monitoring.services"), icon: Activity },
    { id: "alerts", label: t("monitoring.activeAlerts"), icon: Bell },
    { id: "status-pages", label: t("monitoring.statusPages"), icon: Globe2 },
    ...TABS,
  ];

  if (!authed) {
    return <LoginForm onSuccess={() => setAuthed(true)} />;
  }

  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0];
  return (
    <div className="admin-shell min-h-screen bg-[#090c15] text-slate-100">
      <aside className="admin-sidebar fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/[0.07] bg-[#0c101c] lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.07] px-5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Activity className="h-5 w-5" /></span>
          <div><p className="text-sm font-bold tracking-tight">rumahl</p><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Uptime</p></div>
        </div>
        <nav className="admin-sidebar-nav flex-1 space-y-1 overflow-y-auto p-3" aria-label="Admin navigation">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={cn("admin-sidebar-link flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition", tab === id ? "bg-indigo-500/15 text-indigo-200 ring-1 ring-inset ring-indigo-400/10" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100")}><Icon className="h-4 w-4" strokeWidth={1.8} /><span>{label}</span>{tab === id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />}</button>)}
        </nav>
        <div className="border-t border-white/[0.07] p-3"><button onClick={() => { setToken(null); setAuthed(false); if (centralLogoutUrl) window.location.assign(centralLogoutUrl); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"><LogOut className="h-4 w-4" />{t("monitoring.signOut")}</button></div>
      </aside>
      <div className="admin-workspace lg:pl-60">
        <header className="admin-topbar sticky top-0 z-30 border-b border-white/[0.07] bg-[#090c15]/90 backdrop-blur-xl">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-300/70">{t("monitoring.adminTitle")}</p><h1 className="truncate text-lg font-bold tracking-tight">{activeTab.label}</h1></div>
            <div className="flex items-center gap-2 lg:hidden"><select value={tab} onChange={(event) => setTab(event.target.value as Tab)} className="rounded-lg border border-white/10 bg-[#111626] px-3 py-2 text-sm">{tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button onClick={() => { setToken(null); setAuthed(false); }} className="rounded-lg border border-white/10 p-2 text-slate-400"><LogOut className="h-4 w-4" /></button></div>
            <span className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-1.5 text-[11px] font-semibold text-emerald-300 lg:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t("monitoring.liveUpdates")}</span>
          </div>
        </header>
        <main className="admin-content mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
          {tab === "overview" && <MonitoringOverviewTab />}
          {tab === "hosts" && <MonitoringListTab entity="hosts" />}
          {tab === "services" && <MonitoringListTab entity="services" />}
          {tab === "alerts" && <MonitoringListTab entity="alerts" />}
          {tab === "status-pages" && <MonitoringListTab entity="status-pages" />}
          {tab === "incidents" && <IncidentsTab />}
          {tab === "checks" && <MonitorCenter />}
          {tab === "settings" && <SettingsTab />}
        </main>
      </div>
    </div>
  );
}
