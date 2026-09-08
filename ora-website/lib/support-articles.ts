/**
 * Support article system — bilingual (DE/EN), grounded in the actual rumahl
 * documentation. Articles are grouped into four areas:
 *   support · howto · docs · dev
 * Each article contains h2 section headings which power the "On This Page"
 * table of contents and the left-side tree navigation.
 */

export type ArticleBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "ul"; items: string[] }
  | { type: "tip"; text: string }
  | { type: "code"; text: string; lang?: string }
  | { type: "table"; headers: string[]; rows: string[][]; align?: ("left" | "center" | "right")[] }
  | { type: "image"; src: string; alt: string; caption?: string }
  | { type: "video"; src: string; caption?: string };

export type ArticleArea = "support" | "howto" | "docs" | "dev";

export const articleAreas: Record<
  ArticleArea,
  { label: { de: string; en: string }; description: { de: string; en: string } }
> = {
  support: {
    label: { de: "Support", en: "Support" },
    description: {
      de: "Hilfe bei Problemen — Installation, Fehlerbehebung und Backups.",
      en: "Help with problems — installation, troubleshooting and backups.",
    },
  },
  howto: {
    label: { de: "How-To's", en: "How-To's" },
    description: {
      de: "Praktische Anleitungen für Apps, ORA, Dateien und Netzwerk.",
      en: "Practical guides for apps, ORA, files and networking.",
    },
  },
  docs: {
    label: { de: "Dokumentation", en: "Documentation" },
    description: {
      de: "Referenzwissen über das System, Sicherheit und Architektur.",
      en: "Reference knowledge about the system, security and architecture.",
    },
  },
  dev: {
    label: { de: "App-Entwicklung", en: "App Development" },
    description: {
      de: "Anleitungen für eigene Apps, Plugins und den rumahl Store.",
      en: "Guides for building your own apps, plugins and the rumahl Store.",
    },
  },
};

export interface ArticleCategory {
  id: string;
  area: ArticleArea;
  label: { de: string; en: string };
}

export const articleCategories: ArticleCategory[] = [
  { id: "getting-started", area: "support", label: { de: "Erste Schritte", en: "Getting Started" } },
  { id: "backups", area: "support", label: { de: "Backups & Wiederherstellung", en: "Backups & Recovery" } },
  { id: "troubleshooting", area: "support", label: { de: "Fehlerbehebung", en: "Troubleshooting" } },
  { id: "setup", area: "docs", label: { de: "Installation & Einrichtung", en: "Installation & Setup" } },
  { id: "apps", area: "howto", label: { de: "Apps & App Store", en: "Apps & App Store" } },
  { id: "ora", area: "howto", label: { de: "ORA AI", en: "ORA AI" } },
  { id: "files", area: "howto", label: { de: "Dateien & Speicher", en: "Files & Storage" } },
  { id: "networking", area: "howto", label: { de: "Netzwerk & Remote", en: "Networking & Remote" } },
  { id: "security", area: "docs", label: { de: "Sicherheit & Berechtigungen", en: "Security & Permissions" } },
  { id: "system", area: "docs", label: { de: "System & Architektur", en: "System & Architecture" } },
  { id: "develop", area: "dev", label: { de: "App-Entwicklung", en: "App Development" } },
];

/** Gradient cover per category (used for article cards). */
export const categoryCovers: Record<string, string> = {
  "getting-started": "from-sky-500/25 via-primary/10 to-teal-400/20",
  setup: "from-sky-500/25 via-primary/10 to-teal-400/20",
  backups: "from-emerald-500/25 via-primary/10 to-teal-400/20",
  troubleshooting: "from-amber-500/25 via-primary/10 to-rose-400/15",
  apps: "from-primary/25 via-sky-500/10 to-teal-400/20",
  ora: "from-violet-500/25 via-primary/10 to-sky-400/20",
  files: "from-teal-500/25 via-primary/10 to-emerald-400/20",
  networking: "from-cyan-500/25 via-primary/10 to-sky-400/20",
  security: "from-rose-500/20 via-primary/10 to-violet-400/20",
  system: "from-slate-400/25 via-primary/10 to-sky-400/20",
  develop: "from-fuchsia-500/20 via-primary/10 to-violet-400/25",
};

export interface SupportArticle {
  slug: string;
  categoryId: string;
  readTime: string;
  updated: string;
  featured?: boolean;
  /** Route base, e.g. "/support/guides" or "/docs/guides". */
  basePath?: string;
  title: { de: string; en: string };
  excerpt: { de: string; en: string };
  content: { de: ArticleBlock[]; en: ArticleBlock[] };
}

export const supportArticles: SupportArticle[] = [
  /* ═══════════ SUPPORT · Getting Started ═══════════ */
  {
    slug: "installing-rumahl-os",
    categoryId: "getting-started",
    readTime: "6 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "rumahl OS installieren", en: "Installing rumahl OS" },
    excerpt: {
      de: "rumahl OS auf Raspberry Pi, Mini-PC, VM oder per Docker installieren — Schritt für Schritt, auf jedem Gerät.",
      en: "Install rumahl OS on a Raspberry Pi, mini PC, VM or via Docker — step by step, on any device.",
    },
    content: {
      de: [
        { type: "p", text: "Es gibt mehrere Wege, rumahl zu installieren. Welcher der richtige ist, hängt davon ab, was du vorhast: ein eigenes Heimserver-Gerät, ein vorhandener Linux-Server oder die Entwicklung direkt auf dem Host." },
        { type: "h2", text: "Schnellinstallation (One-Liner)" },
        { type: "code", lang: "bash", text: "curl -fsSL https://rumahl.com/install | bash" },
        { type: "p", text: "Das Installationsskript erkennt dein System und führt dich durch die Installation — für Linux-Server via Docker Compose oder als Image-Flash auf ein Gerät (z. B. --device /dev/sdX)." },
        { type: "h2", text: "Die richtige Installationsmethode wählen" },
        { type: "ul", items: [
          "rumahl OS (vollständiges Betriebssystem): die beste Wahl für ein eigenes Gerät — Raspberry Pi, Mini-PC oder NAS",
          "Docker Compose: für vorhandene Linux-Server, auf denen rumahl als Container-Stapel läuft",
          "Entwicklungsmodus: direkt auf dem Host, wenn du selbst an rumahl mitentwickeln willst",
        ] },
        { type: "h2", text: "rumahl OS auf Hardware installieren" },
        { type: "steps", items: [
          "Lade das vorgefertigte Image herunter: https://github.com/rumahl/rumahl/releases/latest/download/rumahl-os.img.xz",
          "Prüfe die Prüfsumme: sha256sum rumahl-os.img.xz",
          "Flash das Image auf dein Gerät (z. B. xzcat rumahl-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress)",
          "Boote das Gerät und öffne die Weboberfläche unter http://[geräte-ip]:8126",
          "Ändere sofort die Standard-Anmeldedaten (root / ora) beim ersten Login.",
        ] },
        { type: "h2", text: "Docker Compose auf Linux-Servern" },
        { type: "steps", items: [
          "Kopiere das Repository: git clone https://github.com/rumahl/rumahl.git",
          "cd rumahl/deploy && cp ../.env.example ../.env",
          "Starte den Stapel: docker compose up -d",
          "Warte 30–60 Sekunden, bis alle Dienste initialisiert sind.",
          "Öffne das Dashboard unter http://localhost:8126.",
        ] },
        { type: "tip", text: "rumahl OS basiert auf Buildroot-LTS-Linux mit schreibgeschütztem SquashFS-Root, A/B-Partitions-Updates über RAUC und Docker Engine. Weitere Details findest du in der Installationsdokumentation." },
      ],
      en: [
        { type: "p", text: "There are several ways to install rumahl. Which one is right depends on what you plan to do: a dedicated home server device, an existing Linux server or development directly on the host." },
        { type: "h2", text: "Quick install (one-liner)" },
        { type: "code", lang: "bash", text: "curl -fsSL https://rumahl.com/install | bash" },
        { type: "p", text: "The installer script detects your system and walks you through the installation — Docker Compose for Linux servers or image flashing to a device (e.g. --device /dev/sdX)." },
        { type: "h2", text: "Choosing the right installation method" },
        { type: "ul", items: [
          "rumahl OS (full operating system): the best choice for a dedicated device — Raspberry Pi, mini PC or NAS",
          "Docker Compose: for existing Linux servers, where rumahl runs as a container stack",
          "Development mode: directly on the host, if you want to develop rumahl itself",
        ] },
        { type: "h2", text: "Installing rumahl OS on hardware" },
        { type: "steps", items: [
          "Download the pre-built image: https://github.com/rumahl/rumahl/releases/latest/download/rumahl-os.img.xz",
          "Verify the checksum: sha256sum rumahl-os.img.xz",
          "Flash the image to your device (e.g. xzcat rumahl-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress)",
          "Boot the device and open the web interface at http://[device-ip]:8126",
          "Change the default credentials (root / ora) immediately on first login.",
        ] },
        { type: "h2", text: "Docker Compose on Linux servers" },
        { type: "steps", items: [
          "Clone the repository: git clone https://github.com/rumahl/rumahl.git",
          "cd rumahl/deploy && cp ../.env.example ../.env",
          "Start the stack: docker compose up -d",
          "Wait 30–60 seconds for all services to initialize.",
          "Open the dashboard at http://localhost:8126.",
        ] },
        { type: "tip", text: "rumahl OS is based on Buildroot LTS Linux with a read-only SquashFS root filesystem, A/B partition updates via RAUC and Docker Engine. More details are in the installation documentation." },
      ],
    },
  },
  {
    slug: "system-requirements",
    categoryId: "getting-started",
    readTime: "2 min",
    updated: "2026-08-20",
    title: { de: "Systemanforderungen", en: "System requirements" },
    excerpt: {
      de: "Welche Hardware du für rumahl brauchst — und was wir für den Alltag empfehlen.",
      en: "The hardware you need to run rumahl — and what we recommend for everyday use.",
    },
    content: {
      de: [
        { type: "p", text: "rumahl läuft auf ARM64- und x86_64-Hardware — vom Raspberry Pi bis zum Mini-PC oder NAS." },
        { type: "h2", text: "Minimum und Empfehlung" },
        { type: "ul", items: [
          "Minimum: 2 CPU-Kerne, 512 MB RAM (Raspberry Pi 4) bzw. 900 MB (VM), 8 GB freier Speicherplatz, Debian 12+, Ubuntu 22.04+, macOS 13+ oder Raspberry Pi OS",
          "Empfohlen: 4 Kerne, 2 GB+ RAM (8 GB+ für lokale KI-Funktionen von ORA), 20 GB+ SSD",
        ] },
        { type: "h2", text: "Unterstützte Geräte" },
        { type: "ul", items: [
          "x86_64 mit UEFI (Intel/AMD-Server, NUCs, Mini-PCs)",
          "Raspberry Pi 4 (4 GB+ empfohlen), Rock Pi 4, Odroid N2+",
          "Generische ARM64-Boards",
        ] },
        { type: "tip", text: "Für ORA mit lokalen KI-Modellen gilt: je mehr RAM, desto größer die Modelle, die komfortabel laufen. 8 GB sind hier der Sweet Spot." },
      ],
      en: [
        { type: "p", text: "rumahl runs on ARM64 and x86_64 hardware — from the Raspberry Pi to a mini PC or NAS." },
        { type: "h2", text: "Minimum and recommendation" },
        { type: "ul", items: [
          "Minimum: 2 CPU cores, 512 MB RAM (Raspberry Pi 4) or 900 MB (VM), 8 GB free disk, Debian 12+, Ubuntu 22.04+, macOS 13+ or Raspberry Pi OS",
          "Recommended: 4 cores, 2 GB+ RAM (8 GB+ for local ORA AI features), 20 GB+ SSD",
        ] },
        { type: "h2", text: "Supported devices" },
        { type: "ul", items: [
          "x86_64 with UEFI (Intel/AMD servers, NUCs, mini PCs)",
          "Raspberry Pi 4 (4 GB+ recommended), Rock Pi 4, Odroid N2+",
          "Generic ARM64 boards",
        ] },
        { type: "tip", text: "For ORA with local AI models, more RAM means larger models run comfortably. 8 GB is the sweet spot here." },
      ],
    },
  },
  {
    slug: "first-boot-setup",
    categoryId: "getting-started",
    readTime: "4 min",
    updated: "2026-08-20",
    title: { de: "Erster Start und Einrichtung", en: "First boot & initial setup" },
    excerpt: {
      de: "Admin-Konto anlegen, das Dashboard erkunden und Home Assistant verbinden — in fünf Minuten.",
      en: "Create your admin account, explore the dashboard and connect Home Assistant — in five minutes.",
    },
    content: {
      de: [
        { type: "p", text: "Nach dem ersten Boot zeigt dir rumahl einen grafischen Assistenten — mit QR-Code für das schnelle Einrichten vom Handy. Danach geht es in drei Schritten weiter." },
        { type: "h2", text: "Konto anlegen und loslegen" },
        { type: "steps", items: [
          "Öffne das Dashboard unter http://localhost:8126 (bzw. der IP deines Geräts) und klicke auf Create Account.",
          "Lege deinen Admin-Benutzernamen und ein starkes Passwort fest — dieses Konto hat volle Rechte.",
          "Erkunde die Oberfläche: die Widgets auf dem Startbildschirm, den App Store, das Kontrollzentrum und die Einstellungen.",
        ] },
        { type: "h2", text: "Home Assistant verbinden (optional)" },
        { type: "steps", items: [
          "Öffne Einstellungen → Home Assistant.",
          "Trage die Adresse deiner Home-Assistant-Instanz und deine Zugangsdaten ein.",
          "Geräte und Entitäten erscheinen automatisch im Dashboard und in den Widgets.",
        ] },
        { type: "tip", text: "Die wichtigsten URLs: Dashboard :8126, Control Center :8091, API-Doku (Swagger) :8126/api/docs, Supervisor :8097." },
      ],
      en: [
        { type: "p", text: "After the first boot, rumahl shows a graphical setup wizard — with a QR code for quick setup from your phone. Then it continues in three steps." },
        { type: "h2", text: "Create your account and get started" },
        { type: "steps", items: [
          "Open the dashboard at http://localhost:8126 (or your device's IP) and click Create Account.",
          "Choose your admin username and a strong password — this account has full rights.",
          "Explore the interface: the widgets on the home screen, the App Store, the control center and the settings.",
        ] },
        { type: "h2", text: "Connect Home Assistant (optional)" },
        { type: "steps", items: [
          "Open Settings → Home Assistant.",
          "Enter the address of your Home Assistant instance and your credentials.",
          "Devices and entities appear automatically in the dashboard and widgets.",
        ] },
        { type: "tip", text: "The key URLs: Dashboard :8126, Control Center :8091, API docs (Swagger) :8126/api/docs, Supervisor :8097." },
      ],
    },
  },

  /* ═══════════ SUPPORT · Backups & Recovery ═══════════ */
  {
    slug: "backing-up-your-system",
    categoryId: "backups",
    readTime: "4 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "Dein System sichern", en: "Backing up your system" },
    excerpt: {
      de: "Automatische, verschlüsselte Backups von Einstellungen, Apps und Daten — auf USB, NAS oder Remote.",
      en: "Automatic, encrypted backups of settings, apps and data — to USB, NAS or remote targets.",
    },
    content: {
      de: [
        { type: "p", text: "Backups in rumahl unterscheiden drei Dinge: lokalen Rollback (Snapshots), externes Backup und Off-Device-Replikation. Für den Alltag reicht ein automatisches Backup auf ein externes Ziel." },
        { type: "h2", text: "Ein Backup einrichten" },
        { type: "steps", items: [
          "Öffne Einstellungen → Backup (bzw. die System-App Backup/Updates).",
          "Wähle ein Ziel: USB-Disk, ein anderes rumahl-/NAS-System oder ein berechtigtes Remote-Ziel.",
          "Aktiviere den Zeitplan — z. B. täglich um 3 Uhr nachts.",
          "Backups laufen als sichtbare Jobs: Fortschritt und Prüfsummen-Verifikation im Job Center.",
        ] },
        { type: "h2", text: "Backups testen" },
        { type: "ul", items: [
          "Teste die Wiederherstellung mindestens einmal im Quartal.",
          "Ein Backup, das nie getestet wurde, ist kein Backup.",
          "Prüfe nach jedem großen Update, dass das neueste Backup vollständig ist.",
        ] },
        { type: "tip", text: "Snapshot-Policies sind kein Backup: Snapshots schützen vor versehentlichem Löschen, aber nicht vor Geräteverlust. Externes Backup immer zusätzlich." },
      ],
      en: [
        { type: "p", text: "Backups in rumahl distinguish three things: local rollback (snapshots), external backup and off-device replication. For everyday use, an automatic backup to an external target is enough." },
        { type: "h2", text: "Setting up a backup" },
        { type: "steps", items: [
          "Open Settings → Backup (or the Backup/Updates system app).",
          "Choose a target: USB disk, another rumahl/NAS system or a permissioned remote target.",
          "Enable the schedule — e.g. daily at 3 am.",
          "Backups run as visible jobs: progress and checksum verification in the Job Center.",
        ] },
        { type: "h2", text: "Testing backups" },
        { type: "ul", items: [
          "Test the restore at least once per quarter.",
          "A backup that was never tested is not a backup.",
          "After every major update, verify that the newest backup is complete.",
        ] },
        { type: "tip", text: "Snapshot policies are not backups: snapshots protect against accidental deletion, but not against device loss. Always add an external backup." },
      ],
    },
  },
  {
    slug: "restoring-from-backup",
    categoryId: "backups",
    readTime: "5 min",
    updated: "2026-08-20",
    title: { de: "Aus einem Backup wiederherstellen", en: "Restoring from a backup" },
    excerpt: {
      de: "Nach einem Ausfall oder Umzug: System, Apps und Daten sicher zurückholen.",
      en: "After a failure or migration: get your system, apps and data back safely.",
    },
    content: {
      de: [
        { type: "p", text: "Die Wiederherstellung ist der Moment, in dem sich Backups auszahlen. rumahl prüft die Daten vor dem Zurückspielen und überschreibt nichts, bevor die Prüfung erfolgreich war." },
        { type: "h2", text: "System wiederherstellen" },
        { type: "steps", items: [
          "Installiere rumahl OS frisch auf dem Zielgerät (siehe Installationsanleitung).",
          "Öffne Einstellungen → Backup → Wiederherstellen.",
          "Wähle das Backup (USB, NAS oder Remote) — rumahl verifiziert Prüfsummen und Integrität.",
          "Bestätige die Wiederherstellung — das System wird mit den gesicherten Einstellungen, Apps und Daten neu aufgesetzt.",
          "Nach dem Neustart: Login mit deinen alten Zugangsdaten und alles prüfen.",
        ] },
        { type: "h2", text: "Wann du ein manuelles Backup machen solltest" },
        { type: "ul", items: [
          "Vor größeren Updates und Umzügen",
          "Bevor du neue Speicherhardware anschließt oder Arrays umbaust",
          "Vor der Installation experimenteller Apps",
        ] },
        { type: "tip", text: "Die Wiederherstellung ist die einzige Übung, die man üben sollte: einmal durchspielen, dann ist man für den Ernstfall ruhig." },
      ],
      en: [
        { type: "p", text: "Restoring is the moment backups pay off. rumahl verifies the data before restoring and overwrites nothing until the verification succeeded." },
        { type: "h2", text: "Restoring your system" },
        { type: "steps", items: [
          "Install rumahl OS fresh on the target device (see the installation guide).",
          "Open Settings → Backup → Restore.",
          "Select the backup (USB, NAS or remote) — rumahl verifies checksums and integrity.",
          "Confirm the restore — the system is recreated with the saved settings, apps and data.",
          "After reboot: log in with your old credentials and check everything.",
        ] },
        { type: "h2", text: "When to make a manual backup" },
        { type: "ul", items: [
          "Before major updates and moves",
          "Before attaching new storage hardware or rebuilding arrays",
          "Before installing experimental apps",
        ] },
        { type: "tip", text: "Restoring is the one exercise worth practising: run through it once, and you will stay calm in an emergency." },
      ],
    },
  },

  /* ═══════════ SUPPORT · Troubleshooting ═══════════ */
  {
    slug: "device-unreachable",
    categoryId: "troubleshooting",
    readTime: "6 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "Gerät nicht erreichbar", en: "Your device is unreachable" },
    excerpt: {
      de: "Netzwerk-Checks, IP-Probleme und Wiederherstellung — Schritt für Schritt zur Lösung.",
      en: "Network checks, IP issues and recovery — step by step to a solution.",
    },
    content: {
      de: [
        { type: "p", text: "Das häufigste Support-Problem: Das Dashboard ist nicht mehr erreichbar. Meist liegt es am Netzwerk, selten am System. Gehe die Schritte der Reihe nach durch." },
        { type: "h2", text: "Grundlagen prüfen" },
        { type: "steps", items: [
          "Prüfe die Stromversorgung und die Status-LED des Geräts — leuchtet sie?",
          "Ping-Test vom PC: ping 192.168.1.50 (deine Geräte-IP) — Antworten?",
          "Keine Antwort? Prüfe, ob das Gerät eine neue IP vom Router bekommen hat (Router-Oberfläche → verbundene Geräte).",
        ] },
        { type: "h2", text: "Dashboard und System" },
        { type: "steps", items: [
          "Erreichbar, aber kein Dashboard? Prüfe den Port: nc -zv 192.168.1.50 8126.",
          "Hängt das System? Strom kurz trennen und neu starten — rumahl startet sauber, Daten bleiben erhalten.",
          "Danach: Dashboard öffnen und den Sicherheitsmonitor nach Auffälligkeiten prüfen.",
        ] },
        { type: "h2", text: "Das Problem dauerhaft vermeiden" },
        { type: "ul", items: [
          "DHCP-Reservierung im Router: Eine feste IP verhindert, dass sich die Adresse nach einem Neustart ändert.",
          "Netzwerk-Monitoring: rumahl zeigt dir verbundene Geräte automatisch im Dashboard.",
          "Notiere dir die MAC-Adresse deines Geräts — sie hilft bei der Fehlersuche im Router.",
        ] },
        { type: "tip", text: "Eine DHCP-Reservierung im Router (feste IP) verhindert, dass sich die IP nach einem Neustart ändert." },
      ],
      en: [
        { type: "p", text: "The most common support issue: the dashboard is no longer reachable. It is usually the network, rarely the system. Go through the steps in order." },
        { type: "h2", text: "Check the basics" },
        { type: "steps", items: [
          "Check the power supply and the status LED of the device — is it lit?",
          "Ping test from your PC: ping 192.168.1.50 (your device IP) — replies?",
          "No reply? Check whether the device got a new IP from the router (router UI → connected devices).",
        ] },
        { type: "h2", text: "Dashboard and system" },
        { type: "steps", items: [
          "Reachable, but no dashboard? Check the port: nc -zv 192.168.1.50 8126.",
          "System hung? Briefly disconnect power and restart — rumahl boots cleanly, data stays intact.",
          "Afterwards: open the dashboard and check the security monitor for anything unusual.",
        ] },
        { type: "h2", text: "Avoiding the problem permanently" },
        { type: "ul", items: [
          "DHCP reservation in the router: a fixed IP prevents the address changing after a reboot.",
          "Network monitoring: rumahl shows connected devices automatically in the dashboard.",
          "Note your device's MAC address — it helps when searching the router logs.",
        ] },
        { type: "tip", text: "A DHCP reservation in the router (fixed IP) prevents the IP from changing after a reboot." },
      ],
    },
  },
  {
    slug: "app-wont-start",
    categoryId: "troubleshooting",
    readTime: "3 min",
    updated: "2026-08-20",
    title: { de: "Eine App startet nicht", en: "An app won't start" },
    excerpt: {
      de: "Logs prüfen, Berechtigungen kontrollieren, Container-Status verstehen — die Top 6 Maßnahmen.",
      en: "Check logs, review permissions, understand the container state — the top 6 fixes.",
    },
    content: {
      de: [
        { type: "p", text: "Wenn eine App nicht startet, sind meist drei Dinge im Spiel: fehlende Berechtigungen, Ressourcenlimits oder ein Fehler in der App selbst." },
        { type: "h2", text: "Die Top-6-Maßnahmen" },
        { type: "steps", items: [
          "Starte die App erneut über ihren Eintrag im Launcher — vorübergehende Fehler verschwinden oft damit.",
          "Prüfe im Sicherheitsmonitor, ob die App Ressourcenlimits erreicht (CPU, RAM).",
          "Öffne die Logs der App (Kontextmenü → Logs) und suche nach Fehlermeldungen.",
          "Prüfe die Berechtigungen: Einstellungen → Berechtigungen — fehlt eine, frage sie gezielt an.",
          "Aktualisiere die App auf die neueste Version (Update-Center).",
          "Reicht das nicht, entferne die App und installiere sie neu — der App-Speicher bleibt dabei erhalten.",
        ] },
        { type: "h2", text: "Wenn nichts hilft" },
        { type: "p", text: "Falls die App im Store als „nicht gewartet“ markiert ist, kann ein Entwickler-Wechsel nötig sein — prüfe die Store-Seite der App. Sammle die Log-Ausgabe und melde dich beim Entwickler oder in der Community mit konkreten Fehlermeldungen." },
        { type: "tip", text: "Falls die App im Store als „nicht gewartet“ markiert ist, kann ein Entwickler-Wechsel nötig sein — prüfe die Store-Seite der App." },
      ],
      en: [
        { type: "p", text: "When an app won't start, three things are usually involved: missing permissions, resource limits or an error inside the app itself." },
        { type: "h2", text: "The top 6 fixes" },
        { type: "steps", items: [
          "Restart the app via its launcher entry — transient errors often disappear that way.",
          "Check in the security monitor whether the app hits resource limits (CPU, RAM).",
          "Open the app's logs (context menu → Logs) and look for error messages.",
          "Review permissions: Settings → Permissions — if one is missing, request it explicitly.",
          "Update the app to the latest version (update center).",
          "If that is not enough, remove the app and reinstall it — the app storage is preserved.",
        ] },
        { type: "h2", text: "When nothing helps" },
        { type: "p", text: "If the app is marked as “unmaintained” in the Store, a developer change may be needed — check the app's Store page. Collect the log output and contact the developer or the community with concrete error messages." },
        { type: "tip", text: "If the app is marked as “unmaintained” in the Store, a developer change may be needed — check the app's Store page." },
      ],
    },
  },

  /* ═══════════ HOW-TO · Apps & App Store ═══════════ */
  {
    slug: "installing-an-app",
    categoryId: "apps",
    readTime: "3 min",
    updated: "2026-08-20",
    title: { de: "Eine App aus dem Store installieren", en: "Installing an app from the Store" },
    excerpt: {
      de: "Apps und Plugins installieren, Berechtigungen prüfen — und verstehen, was der Store verspricht.",
      en: "Install apps and plugins, review permissions — and understand what the Store promises.",
    },
    content: {
      de: [
        { type: "p", text: "Der rumahl Store ist die kuratierte Quelle für Apps und Plugins. Jede App wird vor Veröffentlichung auf Sicherheit, Datenschutz und Qualität geprüft." },
        { type: "h2", text: "App installieren" },
        { type: "steps", items: [
          "Öffne den App Store aus dem Launcher oder unter store.rumahl.com.",
          "Wähle eine App aus und lies Beschreibung, Datenangaben und die angefragten Berechtigungen.",
          "Klicke auf Installieren — die Installation läuft als sichtbarer Job im Job Center.",
          "Beim ersten Start können zusätzliche Berechtigungen angefragt werden: Erlauben oder Ablehnen, wie auf dem Handy.",
          "Die App erscheint im Launcher und kann über ihr Kontextmenü aktualisiert oder entfernt werden.",
        ] },
        { type: "h2", text: "Worauf du vor der Installation achten solltest" },
        { type: "ul", items: [
          "Datenangaben: Welche Daten verarbeitet die App? Steht alles in der Store-Beschreibung.",
          "Berechtigungen: Passt der Umfang zu dem, was die App tun soll?",
          "Wartung: Wurde die App kürzlich aktualisiert? „Nicht gewartete“ Apps sind markiert.",
        ] },
        { type: "tip", text: "Berechtigungen kannst du jederzeit in den Einstellungen prüfen und widerrufen — die App verliert sie sofort." },
      ],
      en: [
        { type: "p", text: "The rumahl Store is the curated source for apps and plugins. Every app is reviewed for safety, privacy and quality before publication." },
        { type: "h2", text: "Installing an app" },
        { type: "steps", items: [
          "Open the App Store from the launcher or at store.rumahl.com.",
          "Pick an app and read the description, the data disclosures and the requested permissions.",
          "Click Install — the installation runs as a visible job in the Job Center.",
          "On first launch, additional permissions may be requested: allow or deny, just like on a phone.",
          "The app appears in the launcher and can be updated or removed via its context menu.",
        ] },
        { type: "h2", text: "What to look for before installing" },
        { type: "ul", items: [
          "Data disclosures: what data does the app process? Everything is listed in the Store description.",
          "Permissions: does the scope match what the app should do?",
          "Maintenance: was the app updated recently? “Unmaintained” apps are flagged.",
        ] },
        { type: "tip", text: "You can review and revoke permissions at any time in the settings — the app loses them immediately." },
      ],
    },
  },
  {
    slug: "app-permissions",
    categoryId: "apps",
    readTime: "4 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "App-Berechtigungen verstehen", en: "Understanding app permissions" },
    excerpt: {
      de: "Wie das Berechtigungssystem funktioniert — und wie du es jederzeit kontrollierst.",
      en: "How the permission system works — and how you control it at any time.",
    },
    content: {
      de: [
        { type: "p", text: "In rumahl ist die Berechtigung die Architektur: Jede App läuft gegen dieselbe API-Oberfläche, und jede Fähigkeit ist ein expliziter Scope. Das System erzwingt die Grenzen im API-Gateway — nicht in der App selbst." },
        { type: "h2", text: "Die wichtigsten Berechtigungen" },
        { type: "ul", items: [
          "AppStorage[Read/Write/Delete] — Zugriff auf den eigenen App-Speicher (Key-Value, Dateien, Datenbank)",
          "AppSchedule[Create/Read/Update/Delete] — geplante Aufgaben im Scheduler",
          "Messaging[Publish/Subscribe] — Nachrichten und Events über das Messaging-System",
          "Webhook[Create/Read/Update/Delete/Manage] — Webhooks einrichten und verwalten",
          "OS-Berechtigungen wie os.terminal, os.network.write oder os.system.read — für Systemfunktionen",
        ] },
        { type: "h2", text: "Berechtigungen verwalten" },
        { type: "steps", items: [
          "Öffne Einstellungen → Berechtigungen (oder das Kontextmenü der App).",
          "Du siehst jede erteilte Berechtigung der App mit kurzer Erklärung.",
          "Widerrufe eine Berechtigung mit einem Klick — die App kann sie ab sofort nicht mehr nutzen.",
          "Beim nächsten Zugriffsversuch erscheint ein Dialog, in dem du neu entscheiden kannst.",
        ] },
        { type: "tip", text: "Apps können Berechtigungen auch zur Laufzeit anfragen — dann erscheint ein Dialog wie auf Android oder iOS. Du kannst jederzeit ablehnen." },
      ],
      en: [
        { type: "p", text: "In rumahl, the permission is the architecture: every app runs against the same API surface, and every capability is an explicit scope. The system enforces the boundaries at the API gateway — not inside the app." },
        { type: "h2", text: "The most important permissions" },
        { type: "ul", items: [
          "AppStorage[Read/Write/Delete] — access to the app's own storage (key-value, files, database)",
          "AppSchedule[Create/Read/Update/Delete] — scheduled tasks in the scheduler",
          "Messaging[Publish/Subscribe] — messages and events through the messaging system",
          "Webhook[Create/Read/Update/Delete/Manage] — create and manage webhooks",
          "OS permissions like os.terminal, os.network.write or os.system.read — for system features",
        ] },
        { type: "h2", text: "Managing permissions" },
        { type: "steps", items: [
          "Open Settings → Permissions (or the app's context menu).",
          "You see every granted permission with a short explanation.",
          "Revoke a permission with one click — the app can no longer use it.",
          "On the next access attempt, a dialog appears where you can decide anew.",
        ] },
        { type: "tip", text: "Apps can also request permissions at runtime — a dialog appears, just like on Android or iOS. You can decline at any time." },
      ],
    },
  },
  {
    slug: "updating-uninstalling-apps",
    categoryId: "apps",
    readTime: "2 min",
    updated: "2026-08-20",
    title: { de: "Apps aktualisieren und entfernen", en: "Updating & uninstalling apps" },
    excerpt: {
      de: "Updates mit Rollback-Funktion — und Apps sauber entfernen, ohne Datenreste.",
      en: "Updates with rollback — and removing apps cleanly, without leftovers.",
    },
    content: {
      de: [
        { type: "p", text: "Updates kommen über das Update-Center, mit stabilen, Beta-, Alpha- und Dev-Kanälen. Kritische Sicherheitsupdates werden hervorgehoben." },
        { type: "h2", text: "Apps aktualisieren" },
        { type: "steps", items: [
          "Öffne das Update-Center aus dem Kontrollzentrum oder den Einstellungen.",
          "Prüfe verfügbare Updates und lies die Versionshinweise.",
          "Installiere das Update — kritische Updates zuerst.",
          "Falls etwas nicht stimmt: Rollback auf die vorherige Version ist mit einem Klick möglich.",
        ] },
        { type: "h2", text: "Apps entfernen" },
        { type: "ul", items: [
          "Kontextmenü der App im Launcher → Deinstallieren",
          "Beim Deinstallieren wird auch der App-Speicher der App entfernt",
          "Vorher ein Backup anlegen, wenn du die Daten behalten willst",
        ] },
        { type: "tip", text: "Beim Deinstallieren werden die Daten der App aus dem App-Speicher entfernt. Ein Backup vorher schadet nie." },
      ],
      en: [
        { type: "p", text: "Updates come through the update center, with stable, beta, alpha and dev channels. Critical security updates are highlighted." },
        { type: "h2", text: "Updating apps" },
        { type: "steps", items: [
          "Open the update center from the control center or the settings.",
          "Check available updates and read the release notes.",
          "Install the update — critical ones first.",
          "If something is wrong: rollback to the previous version is one click away.",
        ] },
        { type: "h2", text: "Removing apps" },
        { type: "ul", items: [
          "App context menu in the launcher → Uninstall",
          "Uninstalling also removes the app's storage",
          "Create a backup first if you want to keep the data",
        ] },
        { type: "tip", text: "Uninstalling removes the app's data from the app storage. A backup beforehand never hurts." },
      ],
    },
  },

  /* ═══════════ HOW-TO · ORA AI ═══════════ */
  {
    slug: "setting-up-ora",
    categoryId: "ora",
    readTime: "4 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "ORA einrichten", en: "Setting up ORA" },
    excerpt: {
      de: "Den lokalen KI-Assistenten aktivieren, ein Modell wählen und die erste Anfrage stellen.",
      en: "Enable the local AI assistant, pick a model and make your first request.",
    },
    content: {
      de: [
        { type: "p", text: "ORA ist der KI-Assistent von rumahl OS. Standardmäßig läuft er vollständig lokal auf deiner Hardware — deine Anfragen verlassen dein Gerät nicht." },
        { type: "h2", text: "ORA aktivieren" },
        { type: "steps", items: [
          "Öffne die ORA-App aus dem Launcher (oder das Assist-Panel im Dashboard).",
          "Aktiviere den Assistenten in den ORA-Einstellungen.",
          "Wähle ein lokales Modell passend zu deinem RAM: kleinere Modelle laufen flott auf 4 GB, größere auf 8 GB+.",
          "Teste die erste Anfrage — z. B. „Wie ist der Energieverbrauch heute?“",
        ] },
        { type: "h2", text: "ORA Aktionen erlauben (optional)" },
        { type: "p", text: "ORA kann nicht nur antworten, sondern auch handeln: Automatisierungen vorschlagen, Logs analysieren, Geräte steuern. Jede Aktion, die Zugriff auf Dateien, Kameras oder Energie-Daten braucht, fragt wie jede andere App um Erlaubnis." },
        { type: "tip", text: "ORA hat keine Sonderrechte: Jede Aktion, die Zugriff auf Dateien, Kameras oder Energie-Daten braucht, fragt wie jede andere App um Erlaubnis." },
      ],
      en: [
        { type: "p", text: "ORA is the AI assistant of rumahl OS. By default it runs entirely locally on your hardware — your prompts never leave your device." },
        { type: "h2", text: "Enabling ORA" },
        { type: "steps", items: [
          "Open the ORA app from the launcher (or the Assist panel in the dashboard).",
          "Enable the assistant in the ORA settings.",
          "Pick a local model matching your RAM: smaller models run fast on 4 GB, larger ones on 8 GB+.",
          "Test your first prompt — e.g. “What is today's energy usage?”",
        ] },
        { type: "h2", text: "Allowing ORA to act (optional)" },
        { type: "p", text: "ORA can not only answer, but also act: suggest automations, analyse logs, control devices. Any action that needs access to files, cameras or energy data asks for permission like any other app." },
        { type: "tip", text: "ORA has no special powers: any action that needs access to files, cameras or energy data asks for permission like any other app." },
      ],
    },
  },
  {
    slug: "ora-local-vs-cloud",
    categoryId: "ora",
    readTime: "3 min",
    updated: "2026-08-20",
    title: { de: "Lokale vs. Cloud-Modelle", en: "Local vs. cloud models" },
    excerpt: {
      de: "Was lokal läuft, was optional in der Cloud — und was das für deine Daten bedeutet.",
      en: "What runs locally, what is optional in the cloud — and what that means for your data.",
    },
    content: {
      de: [
        { type: "p", text: "Der Unterschied ist der Kern von ORA: Lokale Modelle laufen auf deiner Hardware, brauchen kein Internet und speichern nichts außerhalb deines Zuhauses. Cloud-Modelle sind größer und manchmal leistungsfähiger — aber deine Anfragen verlassen dein Gerät." },
        { type: "h2", text: "Die Unterschiede im Überblick" },
        { type: "ul", items: [
          "Lokal (Standard): keine Übertragung, funktioniert ohne Internet, maximale Privatsphäre — Modellgröße durch deinen RAM begrenzt",
          "Cloud (nur mit ausdrücklicher Einwilligung): größere Modelle, mehr Kontext — deine Anfragen werden an den jeweiligen Anbieter übermittelt",
          "Du entscheidest pro Funktion: Cloud-Funktionen sind standardmäßig deaktiviert und jederzeit abschaltbar",
        ] },
        { type: "h2", text: "Einwilligung verwalten" },
        { type: "p", text: "Eine erteilte Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen — in den ORA-Einstellungen. Bestehende Konversationen und lokale Daten bleiben davon unberührt." },
        { type: "tip", text: "Eine erteilte Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen — in den ORA-Einstellungen." },
      ],
      en: [
        { type: "p", text: "The difference is the core of ORA: local models run on your hardware, need no internet and store nothing outside your home. Cloud models are larger and sometimes more capable — but your prompts leave your device." },
        { type: "h2", text: "The differences at a glance" },
        { type: "ul", items: [
          "Local (default): no transmission, works without internet, maximum privacy — model size limited by your RAM",
          "Cloud (only with explicit consent): larger models, more context — your prompts are sent to the respective provider",
          "You decide per feature: cloud features are disabled by default and can be turned off at any time",
        ] },
        { type: "h2", text: "Managing consent" },
        { type: "p", text: "Consent given can be withdrawn at any time with effect for the future — in the ORA settings. Existing conversations and local data remain unaffected." },
        { type: "tip", text: "Consent given can be withdrawn at any time with effect for the future — in the ORA settings." },
      ],
    },
  },

  /* ═══════════ HOW-TO · Files & Storage ═══════════ */
  {
    slug: "using-files",
    categoryId: "files",
    readTime: "3 min",
    updated: "2026-08-20",
    title: { de: "Die Dateien-App verwenden", en: "Using the Files app" },
    excerpt: {
      de: "Dateien durchsuchen, hochladen, verschieben und teilen — systemweit und mit Drag & Drop.",
      en: "Browse, upload, move and share files — system-wide and with drag & drop.",
    },
    content: {
      de: [
        { type: "p", text: "Die Dateien-App ist der zentrale Ort für deine Daten: persönliche Ordner, geteilte Familienordner und alle Laufwerke, die du angeschlossen hast." },
        { type: "h2", text: "Grundlegende Aufgaben" },
        { type: "steps", items: [
          "Öffne Dateien aus dem Launcher — links siehst du deine persönlichen Ordner (Downloads, Dokumente, Fotos, Videos).",
          "Hochladen: klicke auf Hochladen oder ziehe Dateien per Drag & Drop in den Ordner.",
          "Verschieben/Kopieren: Kontextmenü → Verschieben nach … oder per Drag & Drop mit der Maus.",
          "Teilen: Kontextmenü → Teilen — als Familienfreigabe oder als externer Link mit Zeitlimit.",
          "In den Papierkorb verschobene Dateien kannst du über Ansicht → Papierkorb wiederherstellen.",
        ] },
        { type: "h2", text: "Systemweite Integration" },
        { type: "p", text: "Der universelle Datei-Dialog arbeitet systemweit: Wenn eine App „Datei öffnen“ sagt, bekommst du dieselbe Oberfläche. Dateitypen haben Standard-Apps, die du in den Einstellungen unter System → Standard-Apps ändern kannst." },
        { type: "tip", text: "Der universelle Datei-Dialog arbeitet systemweit: Wenn eine App „Datei öffnen“ sagt, bekommst du dieselbe Oberfläche." },
      ],
      en: [
        { type: "p", text: "The Files app is the central place for your data: personal folders, shared family folders and all drives you have attached." },
        { type: "h2", text: "Basic tasks" },
        { type: "steps", items: [
          "Open Files from the launcher — on the left you see your personal folders (Downloads, Documents, Photos, Videos).",
          "Upload: click Upload or drag files into the folder with drag & drop.",
          "Move/copy: context menu → Move to … or drag & drop with the mouse.",
          "Share: context menu → Share — as a family share or as an external link with a time limit.",
          "Files moved to the trash can be restored via View → Trash.",
        ] },
        { type: "h2", text: "System-wide integration" },
        { type: "p", text: "The universal file picker works system-wide: when an app says “open file”, you get the same interface. File types have default apps that you can change in Settings → System → Default apps." },
        { type: "tip", text: "The universal file picker works system-wide: when an app says “open file”, you get the same interface." },
      ],
    },
  },
  {
    slug: "downloads-folder",
    categoryId: "files",
    readTime: "2 min",
    updated: "2026-08-20",
    title: { de: "Downloads & Download-Manager", en: "Downloads & the download manager" },
    excerpt: {
      de: "Downloads laufen im Hintergrund — und überleben das Schließen des Browsers.",
      en: "Downloads run in the background — and survive closing the browser.",
    },
    content: {
      de: [
        { type: "p", text: "Jeder Benutzer hat einen persönlichen Downloads-Ordner, der beim ersten Öffnen automatisch angelegt wird. Downloads laufen serverseitig als System-Job — du kannst den Browser schließen, der Download läuft weiter." },
        { type: "h2", text: "Einen Download starten" },
        { type: "steps", items: [
          "In der Dateien-App: klicke auf Download von URL …",
          "Füge den Link ein — der Download startet als Job im Job Center.",
          "Fortschritt, Pause und Abbrechen findest du im Job Center (Glöckchen-Symbol in der Shell).",
          "Fertig geladene Dateien landen automatisch in deinem persönlichen Downloads-Ordner.",
        ] },
        { type: "h2", text: "Für Entwickler" },
        { type: "p", text: "Das SDK bietet dieselbe Funktion für Apps: ora.downloads — inklusive SSRF-Schutz, Loopback-Adressen werden blockiert. Downloads erscheinen automatisch im Job Center des Nutzers." },
        { type: "tip", text: "Das SDK bietet dieselbe Funktion für Apps: ora.downloads — inklusive SSRF-Schutz, Loopback-Adressen werden blockiert." },
      ],
      en: [
        { type: "p", text: "Every user has a personal Downloads folder that is created automatically on first open. Downloads run server-side as system jobs — you can close the browser, the download continues." },
        { type: "h2", text: "Starting a download" },
        { type: "steps", items: [
          "In the Files app: click Download from URL …",
          "Paste the link — the download starts as a job in the Job Center.",
          "Progress, pause and cancel live in the Job Center (bell icon in the shell).",
          "Finished files land automatically in your personal Downloads folder.",
        ] },
        { type: "h2", text: "For developers" },
        { type: "p", text: "The SDK offers the same feature for apps: ora.downloads — including SSRF protection; loopback addresses are blocked. Downloads appear automatically in the user's Job Center." },
        { type: "tip", text: "The SDK offers the same feature for apps: ora.downloads — including SSRF protection; loopback addresses are blocked." },
      ],
    },
  },

  /* ═══════════ HOW-TO · Networking & Remote ═══════════ */
  {
    slug: "connecting-to-your-rumahl",
    categoryId: "networking",
    readTime: "3 min",
    updated: "2026-08-20",
    title: { de: "Verbindung zu deinem rumahl herstellen", en: "Connecting to your rumahl" },
    excerpt: {
      de: "Von jedem Gerät im Heimnetz auf das Dashboard zugreifen — mit fester IP für den Alltag.",
      en: "Access the dashboard from any device on your home network — with a fixed IP for everyday use.",
    },
    content: {
      de: [
        { type: "p", text: "Im Heimnetz ist der Zugriff kinderleicht: rumahl ist über seine IP-Adresse erreichbar — am besten mit einer festen IP oder einem lokalen DNS-Namen." },
        { type: "h2", text: "Auf das Dashboard zugreifen" },
        { type: "steps", items: [
          "Finde die IP deines Geräts: Einstellungen → Netzwerk zeigt die lokale IP (z. B. 192.168.1.50).",
          "Öffne im Browser: http://192.168.1.50:8126 (Dashboard) oder :8091 (Control Center).",
          "Optional: Vergib eine feste IP im Router (DHCP-Reservierung) und lege einen lokalen DNS-Namen an.",
        ] },
        { type: "h2", text: "Für den Alltag" },
        { type: "ul", items: [
          "Das Netzwerk-Monitoring zeigt dir verbundene Geräte automatisch im Dashboard.",
          "Ein Lesezeichen auf :8126 spart tägliches Eintippen der IP.",
          "Die API-Dokumentation findest du unter :8126/api/docs.",
        ] },
        { type: "tip", text: "Der Port 8126 ist der Hauptzugang; die API-Dokumentation findest du unter :8126/api/docs." },
      ],
      en: [
        { type: "p", text: "On your home network, access is easy: rumahl is reachable via its IP address — best with a fixed IP or a local DNS name." },
        { type: "h2", text: "Accessing the dashboard" },
        { type: "steps", items: [
          "Find your device's IP: Settings → Network shows the local IP (e.g. 192.168.1.50).",
          "Open in your browser: http://192.168.1.50:8126 (dashboard) or :8091 (control center).",
          "Optional: assign a fixed IP in your router (DHCP reservation) and create a local DNS name.",
        ] },
        { type: "h2", text: "For everyday use" },
        { type: "ul", items: [
          "Network monitoring shows connected devices automatically in the dashboard.",
          "A bookmark on :8126 saves typing the IP every day.",
          "The API documentation lives at :8126/api/docs.",
        ] },
        { type: "tip", text: "Port 8126 is the main access; the API documentation lives at :8126/api/docs." },
      ],
    },
  },
  {
    slug: "remote-access",
    categoryId: "networking",
    readTime: "5 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "Fernzugriff & externe Links", en: "Remote access & external links" },
    excerpt: {
      de: "Von unterwegs auf dein Zuhause zugreifen — sicher mit Tailscale, WireGuard und Share-Links.",
      en: "Reach your home from anywhere — safely with Tailscale, WireGuard and share links.",
    },
    content: {
      de: [
        { type: "p", text: "Für den Fernzugriff empfiehlt rumahl VPN-Lösungen: Tailscale (einfachster Start) oder WireGuard. So bleiben alle Verbindungen Ende-zu-Ende verschlüsselt, ohne Ports im Router zu öffnen." },
        { type: "h2", text: "VPN einrichten" },
        { type: "steps", items: [
          "Installiere Tailscale auf deinem rumahl-Gerät (oder konfiguriere WireGuard unter /etc/wireguard).",
          "Einstellungen → Remote-Zugriff zeigt dir den Tunnelstatus (Tailnet-IP, online/offline).",
          "Von unterwegs: Verbinde dein Gerät mit demselben Tailnet und öffne http://<tailnet-ip>:8126.",
        ] },
        { type: "h2", text: "Dateien extern teilen" },
        { type: "steps", items: [
          "In der Dateien-App: Kontextmenü → Externen Link erstellen.",
          "Der Link ist 72 Stunden gültig und bevorzugt die Tailnet-IP, wenn Tailscale online ist.",
          "Optional: Lege eine externe Basis-URL mit deiner Domain fest (Einstellungen → Remote-Zugriff).",
        ] },
        { type: "tip", text: "Externe Share-Links sind mit einem Token geschützt und laufen nach 72 Stunden ab. Niemals Ports wie 8126 direkt im Router freigeben, wenn eine VPN-Option existiert." },
      ],
      en: [
        { type: "p", text: "For remote access, rumahl recommends VPN solutions: Tailscale (easiest start) or WireGuard. This keeps all connections end-to-end encrypted, without opening ports on your router." },
        { type: "h2", text: "Setting up a VPN" },
        { type: "steps", items: [
          "Install Tailscale on your rumahl device (or configure WireGuard under /etc/wireguard).",
          "Settings → Remote access shows the tunnel status (tailnet IP, online/offline).",
          "On the road: connect your device to the same tailnet and open http://<tailnet-ip>:8126.",
        ] },
        { type: "h2", text: "Sharing files externally" },
        { type: "steps", items: [
          "In the Files app: context menu → Create external link.",
          "The link is valid for 72 hours and prefers the tailnet IP when Tailscale is online.",
          "Optional: set an external base URL with your domain (Settings → Remote access).",
        ] },
        { type: "tip", text: "External share links are token-protected and expire after 72 hours. Never expose ports like 8126 directly on the router when a VPN option exists." },
      ],
    },
  },

  /* ═══════════ DOCS · Security & Permissions ═══════════ */
  {
    slug: "user-profiles-guest-mode",
    categoryId: "security",
    readTime: "4 min",
    updated: "2026-08-20",
    title: { de: "Benutzerprofile & Gastmodus", en: "User profiles & guest mode" },
    excerpt: {
      de: "Eigene Desktops, Kinderschutz und Familienfreigaben — so funktionieren Profile.",
      en: "Personal desktops, child restrictions and family shares — how profiles work.",
    },
    content: {
      de: [
        { type: "p", text: "Profile machen aus einem Familien-Gerät persönliche Geräte: Jeder hat seinen eigenen Desktop, seine Apps, Dateien und Dashboards — und Eltern entscheiden, was Kinder sehen dürfen." },
        { type: "h2", text: "Profile einrichten" },
        { type: "steps", items: [
          "Öffne Einstellungen → System → Familienprofile.",
          "Lege für jede Person ein Konto an — Standard oder Kind (mit App-Whitelist).",
          "Bei Kind-Profilen wählst du, welche Apps im Launcher und in der Kommando-Palette erscheinen.",
        ] },
        { type: "h2", text: "Gastmodus & Familienfreigaben" },
        { type: "ul", items: [
          "Gastmodus: in den Sicherheitseinstellungen aktivieren — Besucher bekommen eine temporäre Sitzung ohne Persistenz",
          "Familienfreigaben: Ordner im Kontextmenü der Dateien-App teilen (nur lesen, für alle Familienmitglieder)",
          "Nach dem Abmelden eines Gastes ist nichts mehr vorhanden",
        ] },
        { type: "tip", text: "Gäste bekommen eine temporäre Sitzung ohne Persistenz — nach dem Abmelden ist nichts mehr da." },
      ],
      en: [
        { type: "p", text: "Profiles turn a family device into personal devices: everyone gets their own desktop, apps, files and dashboards — and parents decide what children may see." },
        { type: "h2", text: "Setting up profiles" },
        { type: "steps", items: [
          "Open Settings → System → Family profiles.",
          "Create an account for each person — Standard or Child (with app whitelist).",
          "For child profiles, choose which apps appear in the launcher and the command palette.",
        ] },
        { type: "h2", text: "Guest mode & family shares" },
        { type: "ul", items: [
          "Guest mode: enable it in the security settings — visitors get a temporary session without persistence",
          "Family shares: share folders via the Files app context menu (read-only, for all family members)",
          "After a guest signs out, nothing remains",
        ] },
        { type: "tip", text: "Guests get a temporary session without persistence — after signing out, nothing remains." },
      ],
    },
  },
  {
    slug: "security-monitor",
    categoryId: "security",
    readTime: "3 min",
    updated: "2026-08-20",
    title: { de: "Sicherheitsmonitor & Bedrohungserkennung", en: "Security monitor & threat detection" },
    excerpt: {
      de: "Alarme, Ressourcenüberwachung und Anomalie-Erkennung im Überblick.",
      en: "Alerts, resource monitoring and anomaly detection at a glance.",
    },
    content: {
      de: [
        { type: "p", text: "Der Sicherheitsmonitor ist das Lagebild deines Systems: Sicherheitsalarme nach Schweregrad, Echtzeit-Ressourcenverbrauch (CPU, RAM, Netzwerk, Disk) und erkannte Anomalien." },
        { type: "h2", text: "Was der Monitor zeigt" },
        { type: "ul", items: [
          "Sicherheitsalarme: kritisch/hoch/mittel/niedrig — mit Bestätigungs-Workflow (Acknowledge)",
          "Ressourcen: Live-Verbrauch pro Dienst und Gesamtsystem",
          "Anomalie-Erkennung: ungewöhnliches Verhalten wird markiert und korreliert",
          "Ereignis-Log: hash-verkettetes Audit-Log (manipulationssicher)",
        ] },
        { type: "h2", text: "Die Sicherheitsarchitektur" },
        { type: "ul", items: [
          "Plattform: AppArmor, Docker-Isolation, schreibgeschütztes Root-Dateisystem",
          "Daten: AES-256-GCM für Geheimnisse, verschlüsselte Speicherung",
          "Netzwerk: Domain-Whitelist, IP-Zugriffskontrolle, Sandbox",
        ] },
        { type: "tip", text: "Bei kritischen Alarmen zeigt der Monitor direkt den betroffenen Dienst und einen Lösungsvorschlag." },
      ],
      en: [
        { type: "p", text: "The security monitor is the situational picture of your system: security alerts by severity, real-time resource usage (CPU, RAM, network, disk) and detected anomalies." },
        { type: "h2", text: "What the monitor shows" },
        { type: "ul", items: [
          "Security alerts: critical/high/medium/low — with an acknowledgment workflow",
          "Resources: live usage per service and for the whole system",
          "Anomaly detection: unusual behaviour is flagged and correlated",
          "Event log: hash-chained audit log (tamper-proof)",
        ] },
        { type: "h2", text: "The security architecture" },
        { type: "ul", items: [
          "Platform: AppArmor, Docker isolation, read-only root filesystem",
          "Data: AES-256-GCM for secrets, encrypted storage",
          "Network: domain whitelist, IP access control, sandbox",
        ] },
        { type: "tip", text: "For critical alerts, the monitor points directly to the affected service and a suggested fix." },
      ],
    },
  },

  /* ═══════════ DOCS · System & Architecture ═══════════ */
  {
    slug: "architecture-overview",
    categoryId: "system",
    readTime: "6 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "Systemarchitektur im Überblick", en: "Architecture overview" },
    excerpt: {
      de: "Microservices, Ports und Sicherheitsschichten — wie rumahl OS von innen aussieht.",
      en: "Microservices, ports and security layers — what rumahl OS looks like from the inside.",
    },
    content: {
      de: [
        { type: "p", text: "rumahl OS ist ein Rust-Workspace aus mehr als 20 Crates, organisiert als lose gekoppelte Microservices. Jeder Dienst hat eine klare Aufgabe — und eine klare Port-Zuordnung." },
        { type: "h2", text: "Die wichtigsten Dienste" },
        { type: "ul", items: [
          "rumahl-home (:3001 Dev / :8126 Prod) — Haupt-API und Dashboard, Axum + SQLite",
          "rumahl-core (:8090) — Service Discovery und Plugin-Registry",
          "rumahl-supervisor (:8097) — Docker-Container-Management für Apps",
          "rumahl-appstore (:8098) — der App Store",
          "rumahl-security (:8095) — Bedrohungserkennung und Lockdown",
          "rumahl-secrets (:8093) — verschlüsselte Speicherung von Geheimnissen",
          "rumahl-control (:8091) — Kontrollzentrum und Systemdienste",
        ] },
        { type: "h2", text: "Das Plattform-Prinzip" },
        { type: "p", text: "Die Architektur trennt konsequent: Apps installieren Funktionen, der Core liefert die Plattform. Alles oberhalb der Berechtigungsgrenze ist App-Territorium — alles darunter gehört zum Core und bleibt stabil, getestet und dokumentiert." },
        { type: "h2", text: "Sicherheitsschichten" },
        { type: "ul", items: [
          "Authentifizierung & Autorisierung: JWT, API-Keys, PIN, RBAC",
          "Netzwerk: Domain-Whitelist, IP-Zugriffskontrolle, Sandbox",
          "Daten: AES-256-GCM, hash-verkettete Audit-Logs",
          "Plattform: AppArmor, Docker-Isolation, schreibgeschütztes Dateisystem",
        ] },
        { type: "tip", text: "Die vollständige API-Referenz mit allen Endpunkten findest du unter /api-reference." },
      ],
      en: [
        { type: "p", text: "rumahl OS is a Rust workspace of more than 20 crates, organised as loosely coupled microservices. Each service has a clear job — and a clear port assignment." },
        { type: "h2", text: "The most important services" },
        { type: "ul", items: [
          "rumahl-home (:3001 dev / :8126 prod) — main API and dashboard, Axum + SQLite",
          "rumahl-core (:8090) — service discovery and plugin registry",
          "rumahl-supervisor (:8097) — Docker container management for apps",
          "rumahl-appstore (:8098) — the app store",
          "rumahl-security (:8095) — threat detection and lockdown",
          "rumahl-secrets (:8093) — encrypted storage of secrets",
          "rumahl-control (:8091) — control center and system services",
        ] },
        { type: "h2", text: "The platform principle" },
        { type: "p", text: "The architecture separates consistently: apps install features, the core ships the platform. Everything above the permission boundary is app territory — everything below belongs to the core and stays stable, tested and documented." },
        { type: "h2", text: "Security layers" },
        { type: "ul", items: [
          "Authentication & authorization: JWT, API keys, PIN, RBAC",
          "Network: domain whitelist, IP access control, sandbox",
          "Data: AES-256-GCM, hash-chained audit logs",
          "Platform: AppArmor, Docker isolation, read-only filesystem",
        ] },
        { type: "tip", text: "The full API reference with all endpoints lives at /api-reference." },
      ],
    },
  },
  {
    slug: "permissions-reference",
    categoryId: "system",
    readTime: "5 min",
    updated: "2026-08-20",
    title: { de: "Berechtigungs-Referenz", en: "Permissions reference" },
    excerpt: {
      de: "Alle Berechtigungsgruppen im Überblick — die Vertrauensgrenze der Plattform.",
      en: "All permission groups at a glance — the trust boundary of the platform.",
    },
    content: {
      de: [
        { type: "p", text: "Berechtigungen sind die Vertrauensgrenze von rumahl: Neue Fähigkeiten des Systems werden immer mit einer Berechtigung ausgeliefert. Diese Referenz beschreibt die Gruppen." },
        { type: "h2", text: "App-Berechtigungen" },
        { type: "ul", items: [
          "AppStorage[Read/Write/Delete/Manage] — Speicher der App (Key-Value, Dateien, Datenbank)",
          "AppDatabaseSqlite/Manage — SQLite-Datenbank der App",
          "AppSchedule[Create/Read/Update/Delete] — geplante Aufgaben",
          "Messaging[Publish/Subscribe/Wildcard/Direct] — Messaging-System",
          "Webhook[Create/Read/Update/Delete/Manage] — Webhooks",
        ] },
        { type: "h2", text: "OS-Berechtigungen" },
        { type: "ul", items: [
          "os.terminal — Zugriff auf das integrierte Terminal",
          "os.network.write — Netzwerkkonfiguration ändern",
          "os.system.read — Systemstatus und Logs lesen",
          "os.services — Dienste starten, stoppen, neu starten",
          "Weitere OS-Berechtigungen folgen der gleichen Namenskonvention",
        ] },
        { type: "h2", text: "Laufzeit-Anfragen" },
        { type: "p", text: "Apps können Berechtigungen zur Laufzeit anfragen (z. B. „App X möchte auf Dateien zugreifen“). Der Nutzer entscheidet pro Anfrage — Ablehnungen sind jederzeit möglich, und erteilte Berechtigungen können in den Einstellungen widerrufen werden." },
        { type: "tip", text: "Die komplette Liste der Berechtigungen findest du in permissions.rs im rumahl-shared-Crate." },
      ],
      en: [
        { type: "p", text: "Permissions are the trust boundary of rumahl: new system capabilities always ship with a permission. This reference describes the groups." },
        { type: "h2", text: "App permissions" },
        { type: "ul", items: [
          "AppStorage[Read/Write/Delete/Manage] — the app's storage (key-value, files, database)",
          "AppDatabaseSqlite/Manage — the app's SQLite database",
          "AppSchedule[Create/Read/Update/Delete] — scheduled tasks",
          "Messaging[Publish/Subscribe/Wildcard/Direct] — the messaging system",
          "Webhook[Create/Read/Update/Delete/Manage] — webhooks",
        ] },
        { type: "h2", text: "OS permissions" },
        { type: "ul", items: [
          "os.terminal — access to the integrated terminal",
          "os.network.write — change network configuration",
          "os.system.read — read system status and logs",
          "os.services — start, stop and restart services",
          "Further OS permissions follow the same naming convention",
        ] },
        { type: "h2", text: "Runtime requests" },
        { type: "p", text: "Apps can request permissions at runtime (e.g. “App X wants to access files”). The user decides per request — rejections are possible at any time, and granted permissions can be revoked in the settings." },
        { type: "tip", text: "The complete list of permissions lives in permissions.rs in the rumahl-shared crate." },
      ],
    },
  },

  /* ═══════════ DEV · App Development ═══════════ */
  {
    slug: "building-your-first-app",
    categoryId: "develop",
    readTime: "6 min",
    updated: "2026-08-20",
    featured: true,
    title: { de: "Deine erste App bauen", en: "Building your first app" },
    excerpt: {
      de: "Vom Manifest bis zur ersten Berechtigung: der komplette Weg zu deiner ersten rumahl-App.",
      en: "From manifest to first permission: the complete path to your first rumahl app.",
    },
    content: {
      de: [
        { type: "p", text: "Apps in rumahl sind eigenständige Container mit Web-UI, die über den API-Gateway auf die Plattform zugreifen. Das Referenz-Beispiel ist die Notes-App — an ihr kannst du dich orientieren." },
        { type: "h2", text: "Grundgerüst einer App" },
        { type: "ul", items: [
          "Ein App-Manifest (manifest.json) mit Name, Berechtigungen und Lifecycle-Hooks",
          "Ein eigener Docker-Container mit Health-Check",
          "Eine Web-UI, die über den Launcher erreichbar ist",
          "Zugriff auf die Plattform über den API-Gateway mit App-Token",
        ] },
        { type: "h2", text: "Der erste Schritt" },
        { type: "steps", items: [
          "Kopiere das Beispiel: apps/examples/apps/rumahl-notes aus dem Repository.",
          "Passe Manifest und Namen an — lege die Berechtigungen fest, die deine App wirklich braucht.",
          "Baue und starte den Container lokal (rumahl-supervisor verwaltet ihn).",
          "Registriere die App im Entwickler-Dashboard und beantworte den Review.",
        ] },
        { type: "h2", text: "Berechtigungen wählen" },
        { type: "p", text: "Frage nur Berechtigungen an, die deine App wirklich braucht — das beschleunigt den Review und schafft Vertrauen bei den Nutzern. Fehlende Berechtigungen können zur Laufzeit nachgefragt werden." },
        { type: "tip", text: "Das Referenz-Beispiel apps/examples/apps/rumahl-notes zeigt alle Best Practices: App-Speicher, Health-Check, App-Token-Auth." },
      ],
      en: [
        { type: "p", text: "Apps in rumahl are self-contained containers with a web UI that access the platform through the API gateway. The reference example is the Notes app — use it as your template." },
        { type: "h2", text: "The skeleton of an app" },
        { type: "ul", items: [
          "An app manifest (manifest.json) with name, permissions and lifecycle hooks",
          "Your own Docker container with a health check",
          "A web UI reachable from the launcher",
          "Platform access through the API gateway with an app token",
        ] },
        { type: "h2", text: "The first step" },
        { type: "steps", items: [
          "Copy the example: apps/examples/apps/rumahl-notes from the repository.",
          "Adjust manifest and name — define the permissions your app really needs.",
          "Build and start the container locally (managed by rumahl-supervisor).",
          "Register the app in the developer dashboard and answer the review.",
        ] },
        { type: "h2", text: "Choosing permissions" },
        { type: "p", text: "Only request the permissions your app really needs — this speeds up the review and builds trust with users. Missing permissions can be requested at runtime." },
        { type: "tip", text: "The reference example apps/examples/apps/rumahl-notes shows all best practices: app storage, health check, app token auth." },
      ],
    },
  },
  {
    slug: "apps-vs-plugins",
    categoryId: "develop",
    readTime: "4 min",
    updated: "2026-08-20",
    title: { de: "Apps vs. Plugins — was passt?", en: "Apps vs. plugins — which fits?" },
    excerpt: {
      de: "Vollwertiger Container oder leichtgewichtige Erweiterung? Die Entscheidungshilfe.",
      en: "Full container or lightweight extension? The decision guide.",
    },
    content: {
      de: [
        { type: "p", text: "rumahl kennt zwei Wege, die Plattform zu erweitern: Apps und Plugins. Die Wahl hängt von deinem Projekt ab." },
        { type: "h2", text: "Apps — für vollwertige Anwendungen" },
        { type: "ul", items: [
          "Eigener Docker-Container, jede Sprache und jedes Framework",
          "Langlaufende Dienste und Microservices",
          "Eigene Web-UI mit vollem OS-Zugriff",
          "Verwaltet vom rumahl-supervisor mit Health-Checks",
        ] },
        { type: "h2", text: "Plugins — für Erweiterungen" },
        { type: "ul", items: [
          "JavaScript/TypeScript in der rumahl-Runtime-Sandbox",
          "Ressourcenbegrenzt und sofort installierbar",
          "Widgets für das Dashboard, Automatisierungen, KI-Tools für ORA",
          "Ideal für kleine, fokussierte Erweiterungen",
        ] },
        { type: "h2", text: "Entscheidungshilfe" },
        { type: "ul", items: [
          "Brauchst du eine Datenbank, Hintergrundprozesse oder eine eigene UI? → App",
          "Willst du ein Widget, eine Automatisierung oder ein ORA-Tool? → Plugin",
          "Unsicher? Beginne als Plugin und migriere, wenn die Grenzen erreicht sind.",
        ] },
        { type: "tip", text: "Beide Wege führen in den rumahl Store — die Review-Richtlinien gelten für beide gleich." },
      ],
      en: [
        { type: "p", text: "rumahl knows two ways to extend the platform: apps and plugins. The choice depends on your project." },
        { type: "h2", text: "Apps — for full applications" },
        { type: "ul", items: [
          "Own Docker container, any language and framework",
          "Long-running services and microservices",
          "Own web UI with full OS access",
          "Managed by rumahl-supervisor with health checks",
        ] },
        { type: "h2", text: "Plugins — for extensions" },
        { type: "ul", items: [
          "JavaScript/TypeScript in the rumahl runtime sandbox",
          "Resource-restricted and instantly installable",
          "Dashboard widgets, automations, AI tools for ORA",
          "Ideal for small, focused extensions",
        ] },
        { type: "h2", text: "Decision guide" },
        { type: "ul", items: [
          "Need a database, background processes or your own UI? → App",
          "Want a widget, an automation or an ORA tool? → Plugin",
          "Unsure? Start as a plugin and migrate when you hit its limits.",
        ] },
        { type: "tip", text: "Both paths lead to the rumahl Store — the review guidelines apply equally." },
      ],
    },
  },
  {
    slug: "sdk-quickstart",
    categoryId: "develop",
    readTime: "4 min",
    updated: "2026-08-20",
    title: { de: "SDK-Schnellstart (JavaScript)", en: "SDK quickstart (JavaScript)" },
    excerpt: {
      de: "Das ora.* SDK in fünf Minuten: Client verbinden, App-ID setzen, erste Aufrufe.",
      en: "The ora.* SDK in five minutes: connect the client, set the app ID, make first calls.",
    },
    content: {
      de: [
        { type: "p", text: "Das JavaScript-SDK ist der schnellste Weg in die Plattform. Alle Module folgen demselben Muster: Client erzeugen, App-ID setzen, Aufruf machen — jeder Aufruf ist berechtigungsgeprüft." },
        { type: "h2", text: "Installation und Verbindung" },
        { type: "code", text: "import { rumahlClient } from \"rumahl-sdk\";\n\nconst ora = rumahlClient({ baseUrl: \"http://localhost:8126\" });\nora.setAppId(\"my-app\"); // für App-spezifische Aufrufe (Secrets, Storage)" },
        { type: "h2", text: "Erste Aufrufe" },
        { type: "code", text: "// Benachrichtigung senden\nawait ora.notifications.send({\n  title: \"Backup fertig\",\n  message: \"Alles gut — 12,4 GB verifiziert\",\n});\n\n// Dateien auflisten\nconst { files } = await ora.files.list({ folderId: null });\n\n// Berechtigung zur Laufzeit anfragen\nawait ora.permissions.request(\"AppStorageRead\");\n\n// Job verfolgen\nconst job = await ora.jobs.create({ name: \"Import\", type: \"import\" });" },
        { type: "h2", text: "Die SDK-Oberfläche" },
        { type: "ul", items: [
          "ora.notifications, ora.files, ora.storage, ora.clipboard",
          "ora.permissions (Request-Flow), ora.jobs, ora.secrets",
          "ora.users, ora.devices, ora.home, ora.system.events",
        ] },
        { type: "tip", text: "SDKs gibt es für JavaScript/TypeScript, Go, Python, PHP, C++ und Rust — die ora.*-Oberfläche ist überall gleich." },
      ],
      en: [
        { type: "p", text: "The JavaScript SDK is the fastest way into the platform. All modules follow the same pattern: create a client, set the app ID, make a call — every call is permission-checked." },
        { type: "h2", text: "Installation and connection" },
        { type: "code", text: "import { rumahlClient } from \"rumahl-sdk\";\n\nconst ora = rumahlClient({ baseUrl: \"http://localhost:8126\" });\nora.setAppId(\"my-app\"); // required for app-scoped calls (secrets, storage)" },
        { type: "h2", text: "First calls" },
        { type: "code", text: "// Send a notification\nawait ora.notifications.send({\n  title: \"Backup done\",\n  message: \"All good — 12.4 GB verified\",\n});\n\n// List files\nconst { files } = await ora.files.list({ folderId: null });\n\n// Request a permission at runtime\nawait ora.permissions.request(\"AppStorageRead\");\n\n// Track a job\nconst job = await ora.jobs.create({ name: \"Import\", type: \"import\" });" },
        { type: "h2", text: "The SDK surface" },
        { type: "ul", items: [
          "ora.notifications, ora.files, ora.storage, ora.clipboard",
          "ora.permissions (request flow), ora.jobs, ora.secrets",
          "ora.users, ora.devices, ora.home, ora.system.events",
        ] },
        { type: "tip", text: "SDKs exist for JavaScript/TypeScript, Go, Python, PHP, C++ and Rust — the ora.* surface is the same everywhere." },
      ],
    },
  },
  {
    slug: "publishing-to-the-store",
    categoryId: "develop",
    readTime: "5 min",
    updated: "2026-08-20",
    title: { de: "App im rumahl Store veröffentlichen", en: "Publishing to the rumahl Store" },
    excerpt: {
      de: "Vom Review bis zur Veröffentlichung: was Entwickler über den Store wissen müssen.",
      en: "From review to release: what developers need to know about the Store.",
    },
    content: {
      de: [
        { type: "p", text: "Der rumahl Store ist die kuratierte Tür zur Plattform: Jede App wird auf Sicherheit, Datenschutz und Qualität geprüft, bevor sie für alle Nutzer erscheint." },
        { type: "h2", text: "Der Review-Prozess" },
        { type: "steps", items: [
          "Registriere dich als Entwickler (mindestens 18 Jahre, vollständige Angaben).",
          "Reiche deine App über das Entwickler-Dashboard ein.",
          "Der Review prüft Sicherheit, Datenschutz, Inhalte und technische Qualität.",
          "Ablehnungen werden begründet — innerhalb von 14 Tagen kannst du Einspruch einlegen.",
          "Nach Freigabe erscheint die App im Store; Updates werden erneut geprüft, wenn sie Wesentliches ändern.",
        ] },
        { type: "h2", text: "Datenschutzpflichten" },
        { type: "ul", items: [
          "Du bist Verantwortlicher im Sinne der DSGVO für die Datenverarbeitung deiner App",
          "Jede App braucht eine Datenschutzerklärung und Datenangaben im Store",
          "Rechte der Nutzer (Auskunft, Löschung, Widerspruch) müssen gewährleistet sein",
          "Auftragsverarbeiter nur mit Vertrag nach Art. 28 DSGVO",
        ] },
        { type: "h2", text: "Nach der Veröffentlichung" },
        { type: "ul", items: [
          "Apps müssen über einen angemessenen Zeitraum Updates und Sicherheitspatches erhalten",
          "Entfernungen und Sperrungen erfolgen nach den Store-Bedingungen (inkl. DSA-Verfahren)",
          "Du kannst deine Apps jederzeit entfernen und dein Konto kündigen",
        ] },
        { type: "tip", text: "Die vollständigen Regeln: Entwicklervereinbarung, Review-Richtlinien und Inhaltsrichtlinie unter /legal/app-store." },
      ],
      en: [
        { type: "p", text: "The rumahl Store is the curated door to the platform: every app is reviewed for safety, privacy and quality before it appears for all users." },
        { type: "h2", text: "The review process" },
        { type: "steps", items: [
          "Register as a developer (at least 18 years old, complete details).",
          "Submit your app through the developer dashboard.",
          "The review checks safety, privacy, content and technical quality.",
          "Rejections are reasoned — you may appeal within 14 days.",
          "After approval the app appears in the Store; updates are re-reviewed when they change essentials.",
        ] },
        { type: "h2", text: "Data protection obligations" },
        { type: "ul", items: [
          "You are a controller under the GDPR for your app's data processing",
          "Every app needs a privacy policy and data disclosures in the Store",
          "User rights (access, erasure, objection) must be guaranteed",
          "Processors only with a contract under Art. 28 GDPR",
        ] },
        { type: "h2", text: "After publication" },
        { type: "ul", items: [
          "Apps must receive updates and security patches for a reasonable period",
          "Removals and suspensions follow the Store terms (including DSA procedures)",
          "You can remove your apps and terminate your account at any time",
        ] },
        { type: "tip", text: "The complete rules: Developer Agreement, Review Guidelines and Content Policy under /legal/app-store." },
      ],
    },
  },
];

/* ═══════════ Helpers ═══════════ */

export function getArticle(slug: string): SupportArticle | undefined {
  return supportArticles.find((a) => a.slug === slug);
}

export function getCategory(id: string): ArticleCategory | undefined {
  return articleCategories.find((c) => c.id === id);
}

export function getCategoryLabel(id: string, lang: "de" | "en"): string {
  return getCategory(id)?.label[lang] ?? id;
}

export function getAreaLabel(area: ArticleArea, lang: "de" | "en"): string {
  return articleAreas[area].label[lang];
}

export function getAreaDescription(area: ArticleArea, lang: "de" | "en"): string {
  return articleAreas[area].description[lang];
}

export function getFeaturedArticles(): SupportArticle[] {
  return supportArticles.filter((a) => a.featured);
}

/** All articles grouped by area, then category (for the tree & browse view). */
export function groupByArea(articles: SupportArticle[]): {
  area: ArticleArea;
  categories: { category: ArticleCategory; articles: SupportArticle[] }[];
}[] {
  return (Object.keys(articleAreas) as ArticleArea[])
    .map((area) => ({
      area,
      categories: articleCategories
        .filter((c) => c.area === area)
        .map((category) => ({
          category,
          articles: articles.filter((a) => a.categoryId === category.id),
        }))
        .filter((c) => c.articles.length > 0),
    }))
    .filter((g) => g.categories.length > 0);
}

export function getArticlesByArea() {
  return groupByArea(supportArticles);
}

/** Merge two article pools (e.g. support guides + markdown docs) into one tree. */
export function getCombinedByArea(...pools: SupportArticle[][]): {
  area: ArticleArea;
  categories: { category: ArticleCategory; articles: SupportArticle[] }[];
}[] {
  return groupByArea(pools.flat());
}

export function getPrevNext(
  slug: string
): { prev?: SupportArticle; next?: SupportArticle } {
  const index = supportArticles.findIndex((a) => a.slug === slug);
  if (index === -1) return {};
  return {
    prev: index > 0 ? supportArticles[index - 1] : undefined,
    next: index < supportArticles.length - 1 ? supportArticles[index + 1] : undefined,
  };
}
