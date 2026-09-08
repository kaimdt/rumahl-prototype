import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bug,
  Code2,
  Github,
  Globe,
  Heart,
  Languages,
  MessagesSquare,
  Users,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Join the rumahl community — share ideas, get help, contribute code, docs and translations. Open source, local-first, AI-native.",
};

const channels = [
  {
    icon: Github,
    title: "GitHub",
    text: "Code, issues, discussions and the public roadmap. Everything is open.",
    href: "https://github.com/rumahl",
    action: "github.com/rumahl",
  },
  {
    icon: MessagesSquare,
    title: "Discord",
    text: "Real-time chat with the team and other users — from setup help to ideas.",
    href: "https://github.com/rumahl",
    action: "Join the server",
  },
  {
    icon: Globe,
    title: "Forum",
    text: "Long-form discussions, guides and show-and-tell from the community.",
    href: "/docs",
    action: "Visit the forum",
  },
  {
    icon: Users,
    title: "Meetups",
    text: "Local meetups and online events for home OS enthusiasts. [Coming soon]",
    href: "/docs",
    action: "Find an event",
  },
];

const contributeWays = [
  {
    icon: Code2,
    title: "Write code",
    text: "Rust microservices, React shell, SDKs and example apps — pick an issue labeled good first issue.",
  },
  {
    icon: BookOpen,
    title: "Improve docs",
    text: "Guides, API reference and translations. Documentation is part of the product.",
  },
  {
    icon: Languages,
    title: "Translate",
    text: "Every UI string ships with en.json + de.json — help us reach more languages.",
  },
  {
    icon: Bug,
    title: "Test & report",
    text: "Run beta builds, reproduce bugs and file detailed issue reports.",
  },
  {
    icon: Heart,
    title: "Spread the word",
    text: "Show your setup, write about rumahl, or recommend it to friends.",
  },
];

export default function CommunityPage() {
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
              <Users className="h-3 w-3 mr-1.5" />
              Community · Gemeinschaft
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Built <span className="gradient-text">together</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              rumahl is open source, local-first and AI-native — and it&apos;s
              only as good as the people building it. Join us.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ CHANNELS ═══════════ */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {channels.map((channel, i) => (
              <Reveal key={channel.title} delay={i * 70}>
                <a
                  href={channel.href}
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="surface-card-interactive group h-full p-6 flex flex-col"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                    <channel.icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    {channel.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">
                    {channel.text}
                  </p>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    {channel.action}
                    <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ CONTRIBUTE ═══════════ */}
      <section className="pb-24 lg:pb-28 bg-[hsl(var(--surface))] border-y border-border/50">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16 lg:py-20">
          <Reveal className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Ways to <span className="gradient-text">contribute</span>
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              You don&apos;t need to write Rust to make rumahl better.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {contributeWays.map((way, i) => (
              <Reveal key={way.title} delay={i * 60}>
                <div className="surface-card h-full p-6">
                  <way.icon className="h-5 w-5 text-primary mb-3" strokeWidth={1.8} />
                  <h3 className="text-sm font-semibold text-foreground mb-1.5">
                    {way.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {way.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="py-20 lg:py-24">
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center">
          <Reveal>
            <Github className="mx-auto h-8 w-8 text-primary mb-4" strokeWidth={1.8} />
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Every package ships <span className="gradient-text">open</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto mb-8">
              Contributions happen in Git worktrees, on feature branches, with
              pull requests — and the roadmap is public. Start with the good
              first issues.
            </p>
            <Link
              href="https://github.com/rumahl"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
            >
              <Github className="h-4 w-4" />
              Start contributing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
