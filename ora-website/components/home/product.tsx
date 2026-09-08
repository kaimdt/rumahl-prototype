import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { LauncherPreview } from "@/components/preview/launcher";
import { AppStorePreview } from "@/components/preview/app-store";
import { FilesPreview } from "@/components/preview/files";
import { SharePreview, StreamPreview } from "@/components/preview/share-stream";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
      {children}
    </p>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <div className="mt-6 space-y-2">
      {items.map((p) => (
        <div key={p} className="flex items-center gap-2.5 text-sm text-foreground/80">
          <Check className="h-4 w-4 text-primary shrink-0" strokeWidth={2.2} />
          {p}
        </div>
      ))}
    </div>
  );
}

/* ═══════════ Desktop ═══════════ */
export function DesktopSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <Reveal>
            <Eyebrow>The desktop</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              A real desktop
              <br />
              for your home.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">
              rumahl OS boots into a calm, fast desktop — launcher, dock, windows,
              notifications and a command palette. No browser tabs, no clutter.
            </p>
            <Points
              items={[
                "App launcher with search",
                "Window manager with snap layouts",
                "Command palette on every screen",
              ]}
            />
          </Reveal>
          <Reveal delay={120} className="lg:ml-4">
            <LauncherPreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ App Store ═══════════ */
export function AppStoreSection() {
  return (
    <section className="py-24 lg:py-32 bg-[hsl(var(--surface))] border-y border-border/50 overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Apps & ecosystem</Eyebrow>
          <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
            Your home has an
            <br />
            <span className="text-primary">app store</span> now.
          </h2>
          <p className="mt-5 text-base text-muted-foreground leading-relaxed mx-auto max-w-xl">
            Install self-hosted apps in one click — media, files, smart home, AI,
            networking. See permissions before you install, update everything from
            one screen.
          </p>
          <div className="mt-8">
            <Link
              href="https://store.rumahl.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-2.5 transition-all"
            >
              Browse store.rumahl.com
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
        <Reveal delay={140} className="mt-14">
          <div className="mx-auto max-w-4xl">
            <AppStorePreview />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════ Files & NAS ═══════════ */
export function FilesSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-7">
            <FilesPreview />
          </Reveal>
          <Reveal delay={120} className="lg:col-span-5">
            <Eyebrow>Files & storage</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Your home&apos;s
              <br />
              data center.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              Files, NAS and storage management — built into the OS. Turn any disk
              into network storage, keep everything in one place, and back it up
              to a drive or another device.
            </p>
            <Points
              items={[
                "Files app with network shares",
                "NAS & storage management",
                "Encrypted backups",
              ]}
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ Share ═══════════ */
export function ShareSection() {
  return (
    <section className="py-24 lg:py-32 bg-[hsl(var(--surface))] border-y border-border/50">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <Reveal>
            <Eyebrow>rumahl Share</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Sharing without
              <br />
              the cloud.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">
              Send files, photos and links between your devices over the local
              network — instantly, encrypted, with no external service in between.
            </p>
            <Points
              items={[
                "Device-to-device in your network",
                "Clipboard & link sharing",
                "Encrypted by default",
              ]}
            />
          </Reveal>
          <Reveal delay={120} className="lg:ml-4">
            <SharePreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════ Streaming ═══════════ */
export function StreamingSection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-5">
            <Eyebrow>rumahl Streaming</Eyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] text-foreground leading-[1.05]">
              Live, from
              <br />
              your home.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              Stream cameras, your screen or your microphone to any device in the
              house — low latency, WebRTC, fully local.
            </p>
            <Points
              items={["Camera & screen streaming", "Low-latency WebRTC", "Stream to TV, phone or laptop"]}
            />
          </Reveal>
          <Reveal delay={120} className="lg:col-span-7">
            <StreamPreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
