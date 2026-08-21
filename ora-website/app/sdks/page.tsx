import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Blocks,
  Boxes,
  Braces,
  Container,
  FileCode2,
  Github,
  Package,
  Puzzle,
  TerminalSquare,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/markdown/code-block";

export const metadata: Metadata = {
  title: "SDKs",
  description:
    "Build apps and plugins for rumahl — official SDKs for JavaScript/TypeScript, Go, Python, PHP, C++ and Rust.",
};

const sdkLanguages = [
  { name: "JavaScript / TypeScript", version: "ora.* API", icon: FileCode2 },
  { name: "Python", version: "coming soon", icon: FileCode2 },
  { name: "Go", version: "coming soon", icon: FileCode2 },
  { name: "PHP", version: "coming soon", icon: FileCode2 },
  { name: "C++", version: "coming soon", icon: FileCode2 },
  { name: "Rust", version: "coming soon", icon: FileCode2 },
];

export default function SdksPage() {
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
              <TerminalSquare className="h-3 w-3 mr-1.5" />
              SDKs
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Build for <span className="gradient-text">rumahl</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Apps and plugins for rumahl OS — with the{" "}
              <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-sm">ora.*</code>{" "}
              SDK. Notifications, files, storage, jobs, secrets, devices —
              everything the platform offers, permissioned by design.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ QUICKSTART ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 grid lg:grid-cols-2 gap-10 items-start">
          <Reveal>
            <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="border-b border-border/40 px-5 py-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  JavaScript — quickstart
                </span>
                <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
                  npm install rumahl-sdk
                </span>
              </div>
              <CodeBlock
                code={`import { rumahlClient } from "rumahl-sdk";

const ora = rumahlClient({ baseUrl: "http://localhost:8126" });
ora.setAppId("my-app"); // app-scoped calls (secrets, storage)

// Send a notification
await ora.notifications.send({
  title: "Backup done",
  message: "All good — 12.4 GB verified",
});

// List files with permissions
const { files } = await ora.files.list({ folderId: null });

// Request a permission at runtime
await ora.permissions.request("AppStorageRead");

// Track a background job
const job = await ora.jobs.create({
  name: "Import",
  type: "import",
});`}
                lang="javascript"
                className="rounded-none border-0"
              />
            </div>
          </Reveal>

          <div className="space-y-6">
            <Reveal delay={80}>
              <h2 className="text-xl font-bold tracking-tight text-foreground mb-4">
                The <span className="gradient-text">ora.*</span> SDK surface
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  "ora.notifications",
                  "ora.files",
                  "ora.storage",
                  "ora.clipboard",
                  "ora.windows",
                  "ora.permissions",
                  "ora.jobs",
                  "ora.secrets",
                  "ora.users",
                  "ora.devices",
                  "ora.home",
                  "ora.system.events",
                ].map((mod, i) => (
                  <Reveal key={mod} delay={i * 30}>
                    <code className="block rounded-lg border border-border/40 bg-muted/20 px-3 py-2 font-mono text-[12px] text-primary">
                      {mod}
                    </code>
                  </Reveal>
                ))}
              </div>
            </Reveal>

            <Reveal delay={160}>
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
                <p className="text-sm text-foreground/80 leading-relaxed">
                  Every SDK call is permission-checked at the API gateway —
                  before your code runs. Requesting a permission at runtime
                  shows the user an allow/deny dialog, exactly like on a
                  phone.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════ LANGUAGES ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal className="mb-8">
            <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
              <Blocks className="h-5 w-5 text-primary" strokeWidth={1.8} />
              Official SDKs
            </h2>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {sdkLanguages.map((lang, i) => (
              <Reveal key={lang.name} delay={i * 40}>
                <div className="surface-card p-4 flex items-center gap-3">
                  <lang.icon className="h-5 w-5 text-primary shrink-0" strokeWidth={1.8} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {lang.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {lang.version}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ APPS VS PLUGINS ═══════════ */}
      <section className="pb-20 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16 lg:py-20">
          <Reveal className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Apps or <span className="gradient-text">plugins?</span>
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              Two ways to extend rumahl — pick what fits your project.
            </p>
          </Reveal>

          <div className="grid md:grid-cols-2 gap-4">
            <Reveal>
              <div className="surface-card h-full p-6 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4">
                  <Container className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Apps</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Full applications in their own Docker container — any
                  language, any stack. Managed by the rumahl supervisor with
                  health checks and lifecycle control.
                </p>
                <ul className="space-y-2">
                  {[
                    "Long-running services and microservices",
                    "Web UIs with their own frontend",
                    "Full OS environment and dependencies",
                    "Access the platform via the API gateway",
                    "Reference: the Notes app, the energy optimizer",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5 text-[13px] text-foreground/80">
                      <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="surface-card h-full p-6 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent/15 to-accent/5 text-accent mb-4">
                  <Puzzle className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Plugins</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Lightweight JavaScript/TypeScript extensions that run inside
                  the rumahl runtime sandbox — resource-restricted, safe,
                  instant.
                </p>
                <ul className="space-y-2">
                  {[
                    "Widgets for the home dashboard",
                    "Automations and scheduled jobs",
                    "Resource-restricted sandbox with limits",
                    "Installable with one click from the Store",
                    "AI tools for ORA via the plugin AI client",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5 text-[13px] text-foreground/80">
                      <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-accent/60 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-20 lg:py-24">
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center">
          <Reveal>
            <Boxes className="mx-auto h-8 w-8 text-primary mb-4" strokeWidth={1.8} />
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Publish in the <span className="gradient-text">rumahl Store</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto mb-8">
              Every app is reviewed for safety, privacy and quality — then
              published to every rumahl OS out there. The developer agreement
              and review guidelines are open.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="https://github.com/rumahl"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
              >
                <Github className="h-4 w-4" />
                Get the SDK
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/legal/app-store/developer-agreement"
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-6 py-3 text-sm font-semibold text-foreground hover:border-primary/40 transition-colors"
              >
                <Package className="h-4 w-4" />
                Developer agreement
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
