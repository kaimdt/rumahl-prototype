"use client";

import { useState } from "react";
import { ArrowUpRight, Github, LifeBuoy, Mail, Scale, Send } from "lucide-react";
import { company } from "@/lib/legal/company";

const topics = [
  "General question",
  "Support & troubleshooting",
  "Bug report",
  "App Store / developer",
  "Press & partnerships",
  "Legal & privacy",
  "Something else",
];

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState(topics[0]);
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`[${topic}] ${name ? `${name} — ` : ""}Website contact`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\n\n${message}`
    );
    window.location.href = `mailto:${company.supportEmail}?subject=${subject}&body=${body}`;
  };

  const inputCls =
    "w-full rounded-xl border border-border/40 bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/15 [&>option]:bg-card [&>option]:text-foreground";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="contact-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Name
          </label>
          <input
            id="contact-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="contact-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="contact-topic" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Topic
        </label>
        <select
          id="contact-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className={inputCls}
        >
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="contact-message" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Message
        </label>
        <textarea
          id="contact-message"
          required
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="How can we help?"
          className={`${inputCls} resize-none`}
        />
      </div>

      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
      >
        <Send className="h-4 w-4" />
        Send message
      </button>

      <p className="flex items-start gap-2 text-[11px] text-muted-foreground/70 leading-relaxed">
        <Mail className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Submitting opens your email app with the message pre-filled — nothing
        is sent to our servers.
      </p>
    </form>
  );
}

const channels = [
  {
    icon: LifeBuoy,
    title: "Support",
    text: "Stuck with your setup? Our guides and community are the fastest way to help.",
    href: "/support",
    action: "Visit the support page",
  },
  {
    icon: Mail,
    title: "Direct email",
    text: "For everything else — including press and partnerships.",
    href: `mailto:${company.email}`,
    action: company.email,
  },
  {
    icon: Github,
    title: "GitHub",
    text: "Bug reports and feature requests belong in the issue tracker.",
    href: "https://github.com/rumahl",
    action: "Open an issue",
  },
  {
    icon: Scale,
    title: "Legal",
    text: "Legal inquiries, DSA notices and privacy requests.",
    href: "/legal",
    action: "See the legal pages",
  },
];

export function ContactChannels() {
  return (
    <div className="space-y-4">
      {channels.map((channel) => (
        <ContactChannel
          key={channel.title}
          icon={channel.icon}
          title={channel.title}
          text={channel.text}
          href={channel.href}
          action={channel.action}
        />
      ))}
    </div>
  );
}

export function ContactChannel({
  icon: Icon,
  title,
  text,
  href,
  action,
}: {
  icon: typeof Mail;
  title: string;
  text: string;
  href: string;
  action: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="surface-card-interactive group flex items-start gap-4 p-5"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-2">
          {text}
        </p>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary break-all">
          {action}
          <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform shrink-0" />
        </span>
      </div>
    </a>
  );
}
