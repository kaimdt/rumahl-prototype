export const faqItems: { question: string; answer: string }[] = [
  {
    question: "What hardware do I need to run rumahl OS?",
    answer:
      "rumahl OS runs on Raspberry Pi 4/5, mini PCs, NAS systems, VMs and Docker. 512 MB of RAM is the absolute minimum; we recommend 2 GB or more — especially if you want to run local AI models with ORA on-device.",
  },
  {
    question: "Is my data really kept local?",
    answer:
      "Yes — rumahl OS is local-first by design. Your devices, automations, files and AI prompts stay on your hardware. Nothing is transmitted by default; diagnostics and cloud features are opt-in and can be enabled or disabled at any time in the settings.",
  },
  {
    question: "Does ORA need an internet connection?",
    answer:
      "No. ORA runs entirely on your hardware with local models. Cloud-based AI features — if ever offered — would only be used with your explicit consent.",
  },
  {
    question: "Can I install apps from the rumahl Store?",
    answer:
      "Yes. The rumahl Store offers free apps and plugins that are reviewed for safety, privacy and quality. Every app runs with explicit permissions that you can review and revoke at any time.",
  },
  {
    question: "How do updates work?",
    answer:
      "rumahl OS ships regular updates including security patches, available through the update center. You choose the update channel (stable, beta, alpha) and can roll back an update if needed.",
  },
  {
    question: "Can I migrate from Home Assistant?",
    answer:
      "Yes. rumahl OS integrates with existing Home Assistant setups, and the dashboard can act as a full frontend for Home Assistant devices and entities. Guides for migration are available in the documentation.",
  },
  {
    question: "Is rumahl OS really free?",
    answer:
      "Yes. rumahl OS is free and open source (MIT licensed) — no tiers, no subscriptions, no lock-in. Run it on your own hardware, and commercial use is permitted under the license.",
  },
  {
    question: "Where can I get help?",
    answer:
      "Start with the guides on this page — every guide is available in English and German. If you're still stuck, ask the community on GitHub Discussions, or contact us directly — we read every message.",
  },
];
