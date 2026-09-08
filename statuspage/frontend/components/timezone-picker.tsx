"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { TIMEZONES, getStoredTimezone, setActiveTimezone, timezonePickerLabel } from "@/lib/timezone";
import { cn } from "@/lib/utils";

/**
 * Footer timezone picker — a small custom dropdown. Changing the timezone
 * reloads the page so every timestamp re-renders in the chosen zone.
 */
export function TimezonePicker() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => getStoredTimezone());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        title="Change the displayed timezone"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="max-w-[140px] truncate">{timezonePickerLabel()}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-50 w-56 max-h-72 overflow-y-auto rounded-xl border border-border/40 bg-popover/95 backdrop-blur p-1.5 shadow-xl">
          {TIMEZONES.map((tz) => (
            <button
              key={tz.value || "auto"}
              onClick={() => {
                setSelected(tz.value);
                setOpen(false);
                setActiveTimezone(tz.value);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-colors",
                selected === tz.value
                  ? "bg-primary/12 text-primary"
                  : "text-foreground/85 hover:bg-muted/40"
              )}
            >
              {tz.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
