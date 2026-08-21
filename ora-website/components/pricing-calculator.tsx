"use client";

import { useMemo, useState } from "react";
import { Cpu, Gauge, House, Sparkles } from "lucide-react";
import { StepperSlider } from "@/components/ui/custom-controls";

export function PricingCalculator() {
  const [rooms, setRooms] = useState(4);
  const [devices, setDevices] = useState(22);
  const [aiUse, setAiUse] = useState(50);

  const recommendation = useMemo(() => {
    const score = rooms * 1.5 + devices * 0.8 + aiUse * 0.7;
    if (score < 60) {
      return {
        plan: "Self-Hosted",
        hardware: "Raspberry Pi 4 (4GB)",
        power: "~6W average",
      };
    }
    if (score < 110) {
      return {
        plan: "rumahl OS",
        hardware: "Intel N100 mini PC",
        power: "~15W average",
      };
    }
    return {
      plan: "rumahl OS + GPU Assist",
      hardware: "NUC or desktop with 16GB RAM",
      power: "~28W average",
    };
  }, [aiUse, devices, rooms]);

  const monthlyEnergyCost = useMemo(() => {
    const watts = recommendation.power.includes("6W") ? 6 : recommendation.power.includes("15W") ? 15 : 28;
    const kwh = (watts * 24 * 30) / 1000;
    return (kwh * 0.32).toFixed(2);
  }, [recommendation.power]);

  return (
    <div className="surface-card p-6 md:p-7 mt-12 max-w-4xl mx-auto">
      <div className="text-center mb-6">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2">Sizing Calculator</p>
        <h3 className="text-2xl font-bold text-foreground">Find your ideal setup</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-5">
          <StepperSlider
            label="Rooms"
            min={1}
            max={20}
            value={rooms}
            onChange={setRooms}
          />

          <StepperSlider
            label="Connected devices"
            min={5}
            max={180}
            value={devices}
            onChange={setDevices}
          />

          <StepperSlider
            label="AI usage intensity"
            min={10}
            max={100}
            step={5}
            value={aiUse}
            suffix="%"
            onChange={setAiUse}
          />
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-xs text-primary/80 mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Recommended profile
          </p>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-foreground">
              <House className="h-4 w-4 text-primary" /> Plan: <strong>{recommendation.plan}</strong>
            </p>
            <p className="flex items-center gap-2 text-foreground">
              <Cpu className="h-4 w-4 text-primary" /> Hardware: {recommendation.hardware}
            </p>
            <p className="flex items-center gap-2 text-foreground">
              <Gauge className="h-4 w-4 text-primary" /> Power: {recommendation.power}
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-primary/20">
            <p className="text-xs text-muted-foreground">Estimated monthly energy cost</p>
            <p className="text-xl font-bold text-foreground">EUR {monthlyEnergyCost}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
