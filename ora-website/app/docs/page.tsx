import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, FileText, Code2, Terminal, Github, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Get started with ORA - installation guides, API reference, and developer resources.",
};

export default function DocsPage() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="text-center mb-16">
          <Badge variant="accent" className="mb-4">Documentation</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
            <span className="gradient-text">ORA</span> Documentation
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to get started with ORA and build your intelligent home.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {docsSections.map((section, i) => (
            <Link
              key={section.title}
              href={section.href}
              className="glass-card-interactive p-6 group"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                <section.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {section.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {section.description}
              </p>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-1.5 transition-all">
                Learn more <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>

        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Full documentation coming soon
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            We&apos;re working on comprehensive documentation. In the meantime, check
            out the open-source repositories.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-5 w-5" />
                View on GitHub
              </a>
            </Button>
            <Button variant="glass" size="lg" asChild>
              <Link href="/">
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

const docsSections = [
  {
    title: "Getting Started",
    description: "Install ORA on your hardware and connect your first devices.",
    href: "/docs",
    icon: BookOpen,
  },
  {
    title: "API Reference",
    description: "Complete REST API and WebSocket documentation for developers.",
    href: "/docs",
    icon: FileText,
  },
  {
    title: "SDKs & Libraries",
    description: "Official SDKs for JavaScript, TypeScript, Python, and Go.",
    href: "/docs",
    icon: Code2,
  },
  {
    title: "Plugin Development",
    description: "Build JavaScript/TypeScript plugins to extend ORA functionality.",
    href: "/docs",
    icon: Terminal,
  },
  {
    title: "Architecture Guide",
    description: "Understand the microservice architecture and deployment options.",
    href: "/docs",
    icon: FileText,
  },
  {
    title: "Community",
    description: "Join the community, contribute, and get help from other users.",
    href: "/docs",
    icon: Users,
  },
];
