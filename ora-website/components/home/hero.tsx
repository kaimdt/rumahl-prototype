import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { AnimatedHeadline } from "@/components/home/animated-headline";

/* Echte rumahl-OS-System-Icons (frontend/public/icons) */
const heroApps = [
  { n: "Home", img: "/os/Home.png" },
  { n: "Files", img: "/os/folder.png" },
  { n: "Photos", img: "/os/Images.png" },
  { n: "Media", img: "/os/video_folder.png" },
  { n: "Store", img: "/os/appstore.png" },
  { n: "NAS", img: "/os/NasApp.png" },
  { n: "Settings", img: "/os/Settings.png" },
  { n: "Launcher", img: "/os/Launcher.png" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Sehr dezenter atmosphärischer Hintergrund */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.08), transparent 65%)",
        }}
      />
      <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-24 pb-16 lg:pt-36 lg:pb-24 relative">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              The home operating system
            </span>
          </Reveal>

          <Reveal delay={80}>
            <AnimatedHeadline
              className="mt-6 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-[-0.03em] text-foreground leading-[1.02]"
              lines={[
                { text: "Your home." },
                { text: "One OS.", highlight: true },
              ]}
            />
          </Reveal>

          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground leading-relaxed">
              The operating system for your home — apps, files, media, devices and
              ORA, your AI assistant. Local-first, open source, yours.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" className="shadow-lg shadow-primary/10" asChild>
                <Link href="/docs">
                  Get Started
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/os">
                  <Sparkles className="mr-2 h-4 w-4 text-primary" />
                  Explore the OS
                </Link>
              </Button>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs text-muted-foreground">
              <span>Open source</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span>Local-first</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span>No cloud required</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span>Runs on a Raspberry Pi</span>
            </div>
          </Reveal>
        </div>

        {/* Großes Produkt-Preview im Browser-Rahmen */}
        <Reveal delay={400} className="mt-16 lg:mt-20">
          <div className="mx-auto max-w-5xl">
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_hsl(var(--border)/0.5)_inset,0_40px_80px_-40px_hsl(220_30%_20%/0.25)]">
              {/* Browser chrome */}
              <div className="flex items-center gap-3 border-b border-border/60 bg-[hsl(var(--surface))] px-4 h-11">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-border/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border/70" />
                </div>
                <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-success/70" />
                  <span className="text-[11px] font-mono text-muted-foreground">rumahl.local</span>
                </div>
                <span className="w-14" />
              </div>

              {/* Launcher */}
              <div className="p-6 sm:p-8">
                <div className="mx-auto mb-7 max-w-xs">
                  <div className="flex items-center gap-2 rounded-full border border-border/70 bg-[hsl(var(--surface))] px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">⌕</span>
                    <span className="text-xs text-muted-foreground/70">Search apps…</span>
                    <span className="ml-auto rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
                      ⌘K
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-8 gap-x-3 gap-y-6">
                  {heroApps.map((a) => (
                    <div key={a.n} className="flex flex-col items-center gap-2">
                      <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center overflow-hidden">
                        <img
                          src={a.img}
                          alt={a.n}
                          className="h-full w-full object-contain p-1"
                        />
                      </div>
                      <span className="text-[11px] font-medium text-foreground/80">{a.n}</span>
                    </div>
                  ))}
                </div>

                {/* Dock — echte Icons */}
                <div className="mt-8 flex justify-center">
                  <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-[hsl(var(--surface))] px-3.5 py-2.5">
                    {heroApps.slice(0, 5).map((a) => (
                      <div key={a.n} className="flex h-10 w-10 items-center justify-center overflow-hidden">
                        <img src={a.img} alt={a.n} className="h-full w-full object-contain p-0.5" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
