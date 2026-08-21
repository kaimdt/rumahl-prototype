import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { ContactChannels, ContactForm } from "@/components/contact/contact-form";
import { company } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the rumahl team — support, press, partnerships, legal and everything in between.",
};

export default function ContactPage() {
  return (
    <>
      {/* ═══════════ HERO ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.09), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-4xl px-6 lg:px-10 relative text-center">
          <Reveal>
            <Badge variant="accent" className="mb-6">
              <Mail className="h-3 w-3 mr-1.5" />
              Contact · Kontakt
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Talk to <span className="gradient-text">us</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              We read everything. Support questions, wild ideas, press
              inquiries, bug reports — pick the channel that fits.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ FORM + CHANNELS ═══════════ */}
      <section className="pb-24 lg:pb-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 grid lg:grid-cols-5 gap-10 items-start">
          {/* Form */}
          <Reveal className="lg:col-span-3">
            <div className="rounded-2xl border border-border/30 bg-card/40 p-6 sm:p-8">
              <h2 className="text-xl font-bold tracking-tight text-foreground mb-1">
                Send a message
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                We usually reply within one to two business days.
              </p>
              <ContactForm />
            </div>
          </Reveal>

          {/* Channels */}
          <div className="lg:col-span-2 space-y-4">
            <Reveal delay={80}>
              <ContactChannels />
            </Reveal>

            <Reveal delay={320}>
              <div className="rounded-2xl border border-border/50 bg-muted/20 p-5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Company details for legal purposes — including the imprint
                  required by German law — are available on our{" "}
                  <Link href="/legal/impressum" className="text-primary hover:underline">
                    imprint page
                  </Link>
                  .
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
