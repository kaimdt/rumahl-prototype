import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Home, MapPin, Volume2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { RumahlIcon, RumahlLogo } from "@/components/rumahl-logo";

export const metadata: Metadata = {
  title: "About the name",
  description:
    "rumahl comes from 'rumah' — the Indonesian and Malay word for house or home. Learn how to pronounce it and what the mark means.",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
      {children}
    </p>
  );
}

const pronunciations = [
  { label: "English (phonetic)", value: "ROO-mahl", note: "rhymes with “room” + “mall”" },
  { label: "IPA", value: "/ˈruː.mɑːl/", note: "stress on the first syllable" },
  { label: "Bahasa Indonesia", value: "ru-mahl", note: "same spelling, soft “r”" },
  { label: "Bahasa Melayu", value: "ru-mahl", note: "“rumah” with an “l”" },
];

export default function AboutPage() {
  return (
    <>
      {/* ═══════════ HERO — die Wortmarke ═══════════ */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-36 lg:pb-24">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.08), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-4xl px-6 lg:px-10 text-center relative">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-6">
              About the name
            </p>
            {/* Die Wortmarke — groß, live gerendert */}
            <RumahlLogo className="mx-auto h-16 sm:h-20 w-auto text-foreground" />
            <h1 className="mt-8 text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-foreground leading-[1.05]">
              The name is <span className="text-primary">the idea</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground leading-relaxed">
              rumahl comes from <span className="font-medium text-foreground">“rumah”</span> —
              the Indonesian and Malay word for <span className="font-medium text-foreground">house</span>{" "}
              or <span className="font-medium text-foreground">home</span>. A home
              operating system, named after the word for home.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ WO DER NAME HERKOMMT ═══════════ */}
      <section className="py-20 lg:py-28 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <Reveal>
              <Eyebrow>Where it comes from</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
                “rumah” — <span className="text-primary">house, home</span>
              </h2>
              <p className="mt-5 text-base text-muted-foreground leading-relaxed">
                In Bahasa Indonesia and Bahasa Melayu,{" "}
                <span className="font-medium text-foreground">rumah</span> means house
                or home — the place where your life happens. rumahl takes that word
                and makes it an operating system: everything your home needs, in
                one place, on your own hardware.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Bahasa Indonesia", "Bahasa Melayu", "house · home · place to live"].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-medium text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="rounded-2xl border border-border/60 bg-card p-8">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                  The word
                </p>
                <p className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground">
                  rumah
                </p>
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  Indonesia · Malaysia · Singapore · Brunei
                </div>
                <div className="mt-6 pt-6 border-t border-border/50">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    The OS
                  </p>
                  <p className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground">
                    rumah<span className="text-primary">l</span>
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    “rumah” + one letter — the same word, made into a mark.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════ AUSSPRACHE ═══════════ */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal className="max-w-2xl">
            <Eyebrow>How to say it</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
              It&apos;s pronounced <span className="text-primary">ROO-mahl</span>
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Two syllables, stress on the first. Say it like “room” followed by
              “mall” — the same in English, Indonesian and Malay.
            </p>
          </Reveal>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pronunciations.map((p, i) => (
              <Reveal key={p.label} delay={i * 80}>
                <div className="rounded-2xl border border-border/60 bg-card p-5 h-full">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Volume2 className="h-3 w-3 text-primary" />
                    {p.label}
                  </p>
                  <p className="mt-3 text-xl font-bold tracking-tight text-foreground font-mono">
                    {p.value}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{p.note}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200} className="mt-8">
            <div className="rounded-2xl border border-border/60 bg-[hsl(var(--surface))] px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-xs font-medium text-muted-foreground">Syllables</span>
              {[
                { s: "ru", d: "like “room”" },
                { s: "mahl", d: "like “mall”" },
              ].map((syl) => (
                <span key={syl.s} className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-foreground font-mono">{syl.s}</span>
                  <span className="text-[11px] text-muted-foreground">{syl.d}</span>
                </span>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground font-mono">
                /ˈruː.mɑːl/
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ DAS LOGO ═══════════ */}
      <section className="py-20 lg:py-28 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-5">
              <Eyebrow>The mark</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
                One word,
                <br />
                <span className="text-primary">one letter</span> as icon.
              </h2>
              <p className="mt-5 text-base text-muted-foreground leading-relaxed">
                The wordmark is lowercase and geometric — calm, like the OS itself.
                The first letter, the “r”, doubles as the standalone icon: it sits
                in the header, the launcher and the app icons of rumahl OS.
              </p>
              <div className="mt-6 space-y-2">
                {["Lowercase wordmark, drawn as one shape", "The “r” is the brand icon", "One color — it adapts to light and dark"].map((p) => (
                  <div key={p} className="flex items-center gap-2.5 text-sm text-foreground/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    {p}
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={120} className="lg:col-span-7">
              <div className="rounded-2xl border border-border/60 bg-card p-8 sm:p-10">
                <div className="flex items-center justify-center gap-6 sm:gap-10">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-border/60 bg-[hsl(var(--surface))]">
                      <RumahlIcon className="h-16 w-auto text-foreground" />
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground">the icon</span>
                  </div>
                  <div className="flex flex-col items-center gap-3">
                    <RumahlLogo className="h-10 sm:h-12 w-auto text-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground">the wordmark</span>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-border/50 text-center">
                  <p className="text-xs text-muted-foreground">
                    The mark stays one color and follows the theme — dark on light
                    backgrounds, light on dark.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════ WARUM ES PASST ═══════════ */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          <Reveal className="text-center">
            <Eyebrow>Why it fits</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground leading-[1.08]">
              A home OS, named after <span className="text-primary">home</span>.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground leading-relaxed">
              Everything about rumahl points back to the word: it runs at home, keeps
              your data at home, and treats your household like a place to live in —
              not a subscription.
            </p>
          </Reveal>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { t: "Local", d: "Runs on your hardware, inside your home." },
              { t: "Private", d: "Your data stays where your life is." },
              { t: "Yours", d: "No cloud, no lock-in — like home should be." },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 80}>
                <div className="rounded-2xl border border-border/60 bg-card p-6 h-full">
                  <Home className="h-5 w-5 text-primary mb-3" strokeWidth={1.8} />
                  <h3 className="text-sm font-bold text-foreground">{c.t}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{c.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="pb-24 lg:pb-32">
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center">
          <Reveal>
            <RumahlIcon className="mx-auto h-10 w-auto text-primary" />
            <h2 className="mt-6 text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-foreground">
              Come <span className="text-primary">home</span>.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground leading-relaxed">
              Get rumahl OS running on your own hardware — in about five minutes.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/docs">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Get Started
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/">Back to the homepage</Link>
              </Button>
            </div>
          </Reveal>

          {/* Dezenter Hinweis auf die Origin-Story — nur für Interessierte */}
          <Reveal delay={120} className="mt-16">
            <p className="text-xs text-muted-foreground/70">
              You made it this far?{" "}
              <Link
                href="/story"
                className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-primary transition-colors"
              >
                Read the full origin story
              </Link>
              .
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
