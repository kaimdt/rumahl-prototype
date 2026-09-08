import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Braces,
  KeyRound,
  Plug,
  Server,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/markdown/code-block";
import { EndpointText } from "@/components/markdown/http-method";

export const metadata: Metadata = {
  title: "API Reference",
  description:
    "The rumahl REST API — authentication, endpoints, permissions and WebSockets for building on the platform.",
};

const baseUrls = [
  { service: "rumahl-home (dev)", url: "http://localhost:3001" },
  { service: "rumahl-home (prod)", url: "http://localhost:8126" },
  { service: "rumahl-core", url: "http://localhost:8090" },
  { service: "rumahl-control", url: "http://localhost:8091" },
  { service: "rumahl-supervisor", url: "http://localhost:8097" },
  { service: "rumahl-appstore", url: "http://localhost:8098" },
];

const endpointGroups = [
  {
    title: "Auth & Identity",
    endpoints: ["POST /api/auth/login", "GET /api/auth/verify", "POST /api/auth/guest"],
    note: "JWT-based sessions with per-user profile fields.",
  },
  {
    title: "System",
    endpoints: [
      "GET/POST /api/os/control/*",
      "GET /api/os/logs/*",
      "WS /api/os/terminal/ws",
      "GET /api/os/services",
    ],
    note: "Power control, logs, terminal and systemd services.",
  },
  {
    title: "Files & Storage",
    endpoints: [
      "GET /api/files/*",
      "POST /api/files/upload",
      "POST /api/downloads",
      "GET /api/files/system-folder",
    ],
    note: "Browse, upload, move, share — plus the download manager.",
  },
  {
    title: "Jobs & Clipboard",
    endpoints: [
      "GET/POST /api/jobs/*",
      "GET/POST/DELETE /api/clipboard/*",
    ],
    note: "Resumable system jobs and the clipboard store.",
  },
  {
    title: "Devices & Media",
    endpoints: [
      "GET/POST /api/devices/*",
      "POST /api/devices/:id/wake",
      "POST /api/devices/:id/probe",
      "GET /api/media/hub",
      "GET /api/media/continue-watching",
    ],
    note: "Device registry, wake-on-LAN, reachability and media hubs.",
  },
  {
    title: "Automations",
    endpoints: ["GET/POST /api/automations/*"],
    note: "Visual flow automations: triggers, conditions, actions.",
  },
  {
    title: "App Platform",
    endpoints: [
      "GET /api/apps/:id/storage/kv/*",
      "GET /api/core/registrations",
      "GET /api/core/security/events",
      "GET /api/core/updates/check",
    ],
    note: "App storage, registrations, security events and updates.",
  },
  {
    title: "Remote & Network",
    endpoints: [
      "GET /api/remote/status",
      "GET/PUT /api/remote/config",
      "GET /share/:token",
      "GET /api/network/devices",
    ],
    note: "Tunnels, external links and network discovery.",
  },
];

export default function ApiReferencePage() {
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
              <Braces className="h-3 w-3 mr-1.5" />
              API Reference
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              The rumahl <span className="gradient-text">REST API</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Every service exposes a clean HTTP API. Authentication via JWT,
              authorization via granular permissions — the same trust boundary
              the whole OS runs on.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                Full API documentation
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ BASE URLS ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal className="mb-8">
            <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
              <Server className="h-5 w-5 text-primary" strokeWidth={1.8} />
              Base URLs
            </h2>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {baseUrls.map((u, i) => (
              <Reveal key={u.service} delay={i * 40}>
                <div className="surface-card p-4">
                  <p className="text-xs text-muted-foreground mb-1.5">{u.service}</p>
                  <p className="font-mono text-sm text-foreground">{u.url}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Auth */}
          <Reveal className="mt-10">
            <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground mb-4">
              <KeyRound className="h-5 w-5 text-primary" strokeWidth={1.8} />
              Authentication
            </h2>
            <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="border-b border-border/40 px-5 py-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  JWT login
                </span>
                <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
                  POST /api/auth/login
                </span>
              </div>
              <CodeBlock
                code={`curl -X POST http://localhost:8126/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{ "username": "admin", "password": "your-password" }'

// → { "token": "eyJhbGciOiJIUzI1NiIs...", "user": { "username": "admin", "is_admin": true } }

// Every request carries the token:
curl http://localhost:8126/api/os/services \\
  -H "Authorization: Bearer <jwt-token>"`}
                lang="bash"
                className="rounded-none border-0"
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              For programmatic access, API keys can be created in the Control
              Center and sent via the{" "}
              <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">X-API-Key</code>{" "}
              header.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ ENDPOINTS ═══════════ */}
      <section className="pb-20 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16 lg:py-20">
          <Reveal className="mb-10">
            <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
              <Plug className="h-5 w-5 text-primary" strokeWidth={1.8} />
              Endpoint overview
            </h2>
          </Reveal>

          <div className="grid md:grid-cols-2 gap-4">
            {endpointGroups.map((group, i) => (
              <Reveal key={group.title} delay={(i % 2) * 80}>
                <div className="surface-card h-full p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3">
                    {group.title}
                  </h3>
                  <ul className="space-y-1.5 mb-3">
                    {group.endpoints.map((endpoint) => (
                      <li key={endpoint}>
                        <EndpointText endpoint={endpoint} />
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {group.note}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ PERMISSIONS + WS ═══════════ */}
      <section className="py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 grid lg:grid-cols-2 gap-6">
          <Reveal>
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 sm:p-8 h-full">
              <ShieldCheck className="h-6 w-6 text-primary mb-4" strokeWidth={1.8} />
              <h2 className="text-lg font-bold tracking-tight text-foreground mb-2">
                Permissions are the API contract
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Every endpoint maps to a permission —{" "}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">AppStorage[Read/Write/Delete]</code>,{" "}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">AppDatabaseSqlite</code>,{" "}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">Messaging[Publish/Subscribe]</code>,{" "}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">AppSchedule[Create/Read/Update/Delete]</code>,{" "}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">Webhook[Create/Read/Update/Delete/Manage]</code>{" "}
                and the OS permissions like{" "}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">os.terminal</code>.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Apps request permissions at registration and at runtime — and
                the gateway enforces them on every single request.
              </p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 sm:p-8 h-full">
              <Webhook className="h-6 w-6 text-primary mb-4" strokeWidth={1.8} />
              <h2 className="text-lg font-bold tracking-tight text-foreground mb-2">
                WebSockets &amp; events
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Real-time updates flow over WebSockets — the interactive
                terminal, live system events and messaging between apps.
                System events can also be subscribed by apps via lifecycle
                hooks with glob-filtered patterns.
              </p>
              <CodeBlock
                code={`// Subscribe to system events from an app manifest
{
  "lifecycle_hooks": {
    "hooks": [{ "event": "on_system_event",
                "filter": "security.*" }]
  }
}`}
                lang="json"
                className="rounded-xl"
              />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
