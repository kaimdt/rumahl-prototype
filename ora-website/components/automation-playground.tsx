"use client";

import { useMemo, useState } from "react";
import { Brain, Clock3, Home, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipSelect, StepperSlider } from "@/components/ui/custom-controls";

const rooms = ["Living Room", "Kitchen", "Bedroom", "Office"];
const triggers = ["Sunset", "Motion detected", "Away mode", "Air quality drop"];
const actions = ["Dim lights", "Set temperature", "Start scene", "Close blinds"];

export function AutomationPlayground() {
  const [room, setRoom] = useState(rooms[0]);
  const [trigger, setTrigger] = useState(triggers[0]);
  const [action, setAction] = useState(actions[0]);
  const [intensity, setIntensity] = useState(60);

  const summary = useMemo(() => {
    const actionText =
      action === "Dim lights"
        ? `set brightness to ${intensity}%`
        : action === "Set temperature"
        ? `set temperature to ${Math.round(18 + intensity / 10)}C`
        : action === "Start scene"
        ? "activate the comfort scene"
        : "close all blinds to 80%";

    return `When ${trigger.toLowerCase()} in ${room.toLowerCase()}, ${actionText}.`;
  }, [action, intensity, room, trigger]);

  return (
    <section className="py-24 lg:py-32 border-t border-border/10">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="mb-10 text-center">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Automation Studio</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Build automations in <span className="text-primary">seconds</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
            Try how ORA turns natural language and context into real automation rules.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-5">
            <ChipSelect
              label="Room"
              options={rooms}
              value={room}
              onChange={setRoom}
              columns={2}
            />

            <ChipSelect
              label="Trigger"
              options={triggers}
              value={trigger}
              onChange={setTrigger}
              columns={2}
            />

            <ChipSelect
              label="Action"
              options={actions}
              value={action}
              onChange={setAction}
              columns={2}
            />

            <StepperSlider
              label="Sensitivity / Strength"
              min={10}
              max={100}
              step={5}
              value={intensity}
              suffix="%"
              onChange={setIntensity}
            />

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs text-primary/80 flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" />
                AI interpretation
              </p>
              <p className="text-sm text-foreground mt-1.5">{summary}</p>
            </div>
          </div>

          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              Automation preview timeline
            </h3>

            <div className="space-y-3">
              <div className="rounded-xl border border-border/30 bg-card/40 p-3">
                <p className="text-xs text-muted-foreground">Step 1</p>
                <p className="text-sm text-foreground mt-1 flex items-center gap-1.5">
                  <Home className="h-3.5 w-3.5 text-primary" />
                  Listen for {trigger.toLowerCase()} in {room.toLowerCase()}.
                </p>
              </div>
              <div className="rounded-xl border border-border/30 bg-card/40 p-3">
                <p className="text-xs text-muted-foreground">Step 2</p>
                <p className="text-sm text-foreground mt-1 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  ORA validates occupancy and current context.
                </p>
              </div>
              <div className="rounded-xl border border-border/30 bg-card/40 p-3">
                <p className="text-xs text-muted-foreground">Step 3</p>
                <p className="text-sm text-foreground mt-1 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  Execute action: {action.toLowerCase()} at {intensity}% strength.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row gap-3">
              <Button size="sm">Save Automation</Button>
              <Button size="sm" variant="glass">Export YAML</Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
