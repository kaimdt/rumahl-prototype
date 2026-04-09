import React from "react";

export type TabId = "ai" | "iora-home" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "ai", label: "KI", icon: "🤖" },
  { id: "iora-home", label: "IORA Home", icon: "🏠" },
  { id: "settings", label: "Einstellungen", icon: "⚙" },
];

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function TabBar({ active, onChange }: Props) {
  return (
    <div style={styles.bar}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            ...styles.tab,
            ...(active === tab.id ? styles.activeTab : {}),
          }}
        >
          <span style={styles.icon}>{tab.icon}</span>
          <span style={styles.label}>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

const styles = {
  bar: {
    display: "flex",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  } as React.CSSProperties,
  tab: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    padding: "10px 8px",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--color-muted)",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 500,
    transition: "color 0.15s ease, border-color 0.15s ease",
  } as React.CSSProperties,
  activeTab: {
    color: "var(--color-primary)",
    borderBottom: "2px solid var(--color-primary)",
  } as React.CSSProperties,
  icon: {
    fontSize: "16px",
    lineHeight: 1,
  } as React.CSSProperties,
  label: {
    fontSize: "11px",
  } as React.CSSProperties,
};
