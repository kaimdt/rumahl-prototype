import React from "react";

export type TabId = "ai" | "iora-home" | "connection" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "ai", label: "KI", icon: "🤖" },
  { id: "iora-home", label: "IORA Home", icon: "🏠" },
  { id: "connection", label: "Verbindung", icon: "🌐" },
  { id: "settings", label: "Einstellungen", icon: "⚙" },
];

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function TabBar({ active, onChange }: Props) {
  return (
    <div className="flex border-b border-border/40 bg-card/60 backdrop-blur-xl flex-shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 px-2 bg-transparent border-none border-b-2 cursor-pointer text-[11px] font-medium transition-colors ${
            active === tab.id
              ? "text-primary border-b-primary"
              : "text-muted-foreground border-b-transparent hover:text-foreground"
          }`}
        >
          <span className="text-base leading-none">{tab.icon}</span>
          <span className="text-[11px]">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
