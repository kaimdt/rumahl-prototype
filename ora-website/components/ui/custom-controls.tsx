"use client";

import { Minus, Plus } from "lucide-react";

interface ChipSelectProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  columns?: 1 | 2 | 3 | 4;
}

interface StepperSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}

const gridClass: Record<NonNullable<ChipSelectProps["columns"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function ChipSelect({ label, options, value, onChange, columns = 2 }: ChipSelectProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <div className={`grid ${gridClass[columns]} gap-2`} role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={`rounded-xl border px-3 py-2 text-xs text-left transition-all ${
                selected
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/30 bg-card/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StepperSlider({
  label,
  min,
  max,
  step = 1,
  value,
  suffix = "",
  onChange,
}: StepperSliderProps) {
  const steps = Math.floor((max - min) / step);

  const clamp = (next: number) => {
    const bounded = Math.min(max, Math.max(min, next));
    onChange(bounded);
  };

  const activeIndex = Math.round((value - min) / step);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">
          {label}: <span className="text-foreground font-medium">{value}{suffix}</span>
        </p>
        <div className="inline-flex items-center gap-1 rounded-full border border-border/30 bg-card/30 p-1">
          <button
            type="button"
            onClick={() => clamp(value - step)}
            className="h-6 w-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/30"
            aria-label={`Decrease ${label}`}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => clamp(value + step)}
            className="h-6 w-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/30"
            aria-label={`Increase ${label}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps + 1}, minmax(0, 1fr))` }}>
        {Array.from({ length: steps + 1 }).map((_, i) => {
          const stepValue = min + i * step;
          const isActive = i <= activeIndex;
          return (
            <button
              key={stepValue}
              type="button"
              onClick={() => clamp(stepValue)}
              className={`h-2.5 rounded-full transition-colors ${
                isActive ? "bg-primary/70" : "bg-border/40 hover:bg-border/60"
              }`}
              aria-label={`${label} ${stepValue}${suffix}`}
            />
          );
        })}
      </div>
    </div>
  );
}
