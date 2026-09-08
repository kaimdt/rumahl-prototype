export type RoadmapStatus = "complete" | "in-progress" | "planned";

export interface RoadmapPackage {
  number: number;
  title: string;
  tagline: string;
  status: RoadmapStatus;
  /** 0–100 progress estimate */
  progress: number;
  statusNote: string;
  features: string[];
  dependencies?: string;
  exitCriteria?: string;
  highlight?: boolean;
}

export const roadmapPackages: RoadmapPackage[] = [
  {
    number: 0,
    title: "OS Foundation",
    tagline: "Desktop-grade fundamentals every other feature builds on.",
    status: "complete",
    progress: 100,
    statusNote: "All seven features shipped.",
    features: [
      "Global Spotlight search — Ctrl+Space over apps, files, devices, settings, containers and commands",
      "System-wide Job Manager — visible, resumable jobs for downloads, backups, updates and imports",
      "Clipboard manager with history, pinning and search",
      "Session restore — windows and tabs survive logout and reboot",
      "Snap layouts — drag-to-edge window snapping with live preview",
      "Default apps, MIME types, deep links and cross-app drag & drop",
      "Global keyboard shortcut registry with per-user overrides",
    ],
  },
  {
    number: 1,
    title: "User Profiles & Permissions",
    tagline: "Personal desktops, family areas and the trust boundary.",
    status: "in-progress",
    progress: 75,
    statusNote:
      "Runtime permission requests, child profiles, guest mode, route guard and family shares shipped — per-profile page layouts and shared family pages still open.",
    features: [
      "Runtime permission dialogs — “App X wants access to files”, allow/deny, like Android and iOS",
      "Child & family profiles with per-app restrictions",
      "Guest mode — temporary session without persistence",
      "Route guard redirects restricted users on disallowed pages",
      "Family shares — read-only shared folders for all family members",
      "Profile model: personal desktop, app set, files, dashboards and shared family areas",
    ],
  },
  {
    number: 2,
    title: "App Framework & SDK",
    tagline: "The ora.* SDK — a first-class platform for third-party apps.",
    status: "complete",
    progress: 100,
    statusNote:
      "Full ora.* SDK surface, system-event hooks and example apps shipped.",
    features: [
      "11 SDK modules: notifications, files, storage, clipboard, windows, permissions, jobs, secrets, users, devices, home and system events",
      "App-scoped secret vault for credential provisioning",
      "System-event hooks — apps subscribe to OS events with glob filtering",
      "Full module reference and runnable example apps in the SDK docs",
      "Apps are installable, permissioned and replaceable — without knowing how rumahl works internally",
    ],
  },
  {
    number: 3,
    title: "Devices & Home Dashboard",
    tagline: "Every device in your home, first-class.",
    status: "in-progress",
    progress: 55,
    statusNote:
      "Devices app with WOL and reachability agents shipped; Home Dashboard v2 is underway.",
    features: [
      "Devices registry — gaming PCs, MacBooks, NAS, TVs, printers, …",
      "Wake-on-LAN, TCP/HTTP reachability agents, SSH/SNMP backends planned",
      "Auto-discovery of devices on your network",
      "Home Dashboard v2 — presence, storage, system, jobs and recent files widgets",
      "App-registered widgets on the home row",
    ],
  },
  {
    number: 4,
    title: "Automation Engine",
    tagline: "Visual automation flows — trigger, condition, action.",
    status: "complete",
    progress: 100,
    statusNote: "Implemented and merged — visual flow editor with a full automation API.",
    features: [
      "Visual flow editor: trigger → condition → action",
      "Triggers from devices, jobs, files, schedules and apps",
      "Actions including notifications, jobs and scripts",
      "Reuses the scheduler and automation permissions from the core platform",
    ],
  },
  {
    number: 5,
    title: "Storage, NAS & System Apps",
    tagline: "A safety-first NAS operating system.",
    status: "in-progress",
    progress: 60,
    statusNote:
      "Storage, Containers and the system apps shipped; Logs, Services and Updates apps exist — deeper NAS features are being built.",
    features: [
      "Storage inventory and health — SMART/NVMe health, temperatures, predictive warnings",
      "Software RAID lifecycle with mdadm — create, rebuild, replace, monitor",
      "Pools and filesystems — ext4, XFS, Btrfs with snapshots, scrubs and quotas",
      "SMB/NFS shares with per-user access control, guest access off by default",
      "Snapshots, backups and replication with verified restore",
      "Native system apps: System Monitor, Storage, Containers, Network, Backup, Logs, Services",
    ],
  },
  {
    number: 6,
    title: "Lifestyle Apps & Media Hub",
    tagline: "The home apps you actually use — plus your media, unified.",
    status: "in-progress",
    progress: 60,
    statusNote:
      "Notes reference app, per-user Downloads, download manager and Media Hub shipped.",
    features: [
      "Reference lifestyle app: Notes — installable, permissioned, own container",
      "Per-user Downloads, Documents, Photos and Videos folders",
      "Universal download manager — backend downloads that survive tab closes",
      "Media Hub — Jellyfin and Plex continue-watching with progress, proxied thumbnails",
      "Upcoming: Calendar, Tasks, Contacts, Photos, Music, Recipes, Password Manager, …",
    ],
  },
  {
    number: 7,
    title: "Remote Access & Device-to-Device",
    tagline: "Your home, reachable — on your terms.",
    status: "in-progress",
    progress: 45,
    statusNote:
      "Tunnel status and external share links shipped; TLS/domains and device agents are next.",
    features: [
      "Tailscale and WireGuard detection with tunnel status in Settings",
      "External share links — 72 h links with token-based access",
      "External base URL for domains and TLS (automated Let's Encrypt planned)",
      "Device agents for Windows, macOS and Linux — send-to-device, open-on-device, clipboard sync, wake",
    ],
  },
  {
    number: 8,
    title: "Control Center & AI System Ops",
    tagline: "Your home's control room — with an AI co-pilot.",
    status: "in-progress",
    progress: 35,
    statusNote:
      "Quick-settings basics shipped — now playing, downloads, server load.",
    features: [
      "Unified Control Center — Wi-Fi, Bluetooth, VPN, audio, displays, focus, notifications",
      "Now playing and active downloads right in the quick settings",
      "AI system ops — “why is my NAS slow?”, “install Immich with 500 GB”",
    ],
  },
  {
    number: 9,
    title: "Terminal & Admin Center Redesign",
    tagline: "A settings experience worthy of a home OS.",
    status: "complete",
    progress: 100,
    statusNote: "Admin Center redesigned and Terminal shipped.",
    features: [
      "Windows-11-style Admin Center — sidebar, category cards, detail views",
      "69 admin tabs preserved and reusable",
      "Native system apps surfaced as primary cards with deep links",
      "Integrated, permissioned Terminal with full ANSI rendering",
    ],
  },
];

export const roadmapBacklog: string[] = [
  "Virtual desktops / workspaces — after snap layouts prove out",
  "rumahl agent binaries for Windows, macOS and Linux",
  "Automated TLS provisioning (Let's Encrypt) for domains",
  "More lifestyle apps: Calendar, Tasks, Contacts, Photos, Music, Recipes, Password Manager",
  "Shared family pages and dashboards",
];

export const roadmapPrinciples: string[] = [
  "Backend/API first where a service boundary exists; frontend first for pure-UX packages — decided per feature, not dogmatically.",
  "Apps install features; core ships the platform. Lifestyle apps live in the app store, not in the base image.",
  "Permissions are the trust boundary — new OS capabilities ship with a permission.",
  "Migrations are append-only — new schema via new numbered files.",
  "Every new UI string ships with en.json + de.json.",
  "Destructive operations require explicit typed confirmation — never autonomous.",
];
