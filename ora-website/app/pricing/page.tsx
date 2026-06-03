import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Pricing",
  description: "ORA is free and open source. Self-host or use our managed options.",
};

export default function PricingPage() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="text-center mb-16">
          <Badge variant="accent" className="mb-4">Pricing</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
            Free &amp;{" "}
            <span className="gradient-text">Open Source</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            ORA is completely free and open source. Self-host on your own hardware
            with no limitations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {plans.map((plan, i) => (
            <div
              key={plan.name}
              className={`glass-card p-8 flex flex-col ${
                plan.featured ? "ring-2 ring-primary/50 scale-[1.02]" : ""
              }`}
            >
              {plan.featured && (
                <Badge className="self-start mb-4">Most Popular</Badge>
              )}
              <h3 className="text-xl font-bold text-foreground mb-2">
                {plan.name}
              </h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">
                  {plan.price}
                </span>
                {plan.period && (
                  <span className="text-sm text-muted-foreground">
                    {plan.period}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                {plan.description}
              </p>
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                    <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.featured ? "default" : "glass"}
                size="lg"
                className="w-full"
                asChild
              >
                <Link href="/docs">
                  {plan.cta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          ))}
        </div>

        <div className="text-center mt-16">
          <p className="text-sm text-muted-foreground">
            All plans include the full feature set. No artificial limitations.
            <br />
            Your data stays on your hardware.
          </p>
        </div>
      </div>
    </section>
  );
}

const plans = [
  {
    name: "Self-Hosted",
    price: "Free",
    period: "",
    description: "Run ORA on your own hardware with complete control.",
    features: [
      "All features included",
      "Unlimited devices",
      "Unlimited automations",
      "Local AI processing",
      "Full data privacy",
      "Community support",
    ],
    cta: "Get Started",
    featured: false,
  },
  {
    name: "IORA OS",
    price: "Free",
    period: "",
    description: "The full appliance experience with automatic updates.",
    features: [
      "Everything in Self-Hosted",
      "Automatic updates",
      "Pre-configured stack",
      "Systemd service management",
      "Built-in monitoring",
      "Community support",
    ],
    cta: "Get Started",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Coming",
    period: " soon",
    description: "For businesses and professional installers.",
    features: [
      "Everything in IORA OS",
      "Priority support",
      "Custom integrations",
      "SLA guarantees",
      "Training & onboarding",
      "Dedicated account manager",
    ],
    cta: "Contact Us",
    featured: false,
  },
];
