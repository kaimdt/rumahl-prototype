export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  category: string;
  author: string;
  content: string[];
}

export const blogPosts: BlogPost[] = [
  {
    slug: "why-a-home-os",
    title: "Why the world needs a home operating system",
    excerpt:
      "Smart homes grew up as a collection of cloud apps. We think they deserve an operating system — one that runs in your house, not in someone else's data center.",
    date: "2026-08-10",
    readTime: "4 min",
    category: "Vision",
    author: "rumahl Team",
    content: [
      "Your home has a processor in the thermostat, a computer in the TV, a server in the router — and yet none of them speak to each other. The smart home revolution promised a connected home; what it delivered was a pile of apps, each with its own cloud, its own subscription and its own idea of what 'smart' means.",
      "We started rumahl with a simple observation: the home is not a collection of devices. It is a place. A place with people, routines, preferences and boundaries. Managing it through a dozen web portals from a dozen companies is like running a house by committee — where the committee never meets.",
      "A home operating system changes the frame. Instead of apps talking to the cloud and the cloud talking to you, everything runs on a device you own, in a room you control. Apps become tenants — permissioned, isolated, replaceable — not landlords. Your data lives where your life lives.",
      "This is why we built rumahl on three principles. Local-first: the system must work without an internet connection, because a home is not a dependency. Permissioned: every app asks before it touches your data, the way a guest asks before opening a drawer. Open: the platform is MIT-licensed, so the code belongs to everyone — not to a roadmap committee in another country.",
      "None of this is new technology. It is a new arrangement of technology — one that puts the household, not the vendor, at the center. And that, we believe, is what an operating system is for: not to run programs, but to run a place.",
    ],
  },
  {
    slug: "introducing-ora",
    title: "Introducing ORA — the assistant that lives in your home",
    excerpt:
      "ORA is our AI assistant — and unlike the chatbots you know, it runs entirely on your hardware. Here's why that matters.",
    date: "2026-07-28",
    readTime: "5 min",
    category: "AI",
    author: "rumahl Team",
    content: [
      "Every smart home assistant so far has been a stranger with a microphone: your voice goes to a data center, gets processed by someone else's model, and comes back as an answer — with your home's details stored as someone else's asset.",
      "ORA is different by construction. The assistant runs locally on your rumahl device, using local models. Your prompts, your device states, your automations — none of it leaves your home unless you explicitly choose a cloud feature and consent to it.",
      "Being local changes what an assistant can do. ORA doesn't just answer questions; it can act — because it lives on the same machine as your automations, permissions and devices. It can tell you why the heating ran all night, by actually checking the logs. It can propose an automation, and — with your permission — create it.",
      "We built ORA on the same trust boundary as everything else in rumahl: the permission system. The assistant has no special powers. If a task requires access to your files, your cameras or your energy data, it asks — exactly like any other app would.",
      "Local AI has real constraints. Models are smaller, and the hardware in a home server is not a data center. We think that trade is the whole point: a slightly smaller model that keeps your life private beats a slightly smarter one that doesn't.",
    ],
  },
  {
    slug: "apps-with-permissions",
    title: "Apps with permissions, not promises",
    excerpt:
      "The rumahl Store is built around one idea: an app should be able to do exactly what you allowed — and nothing else.",
    date: "2026-07-15",
    readTime: "4 min",
    category: "Platform",
    author: "rumahl Team",
    content: [
      "When you install an app on a phone, it asks for permissions — then, in practice, does what it wants. When you install an app on rumahl, the permission is not a dialog: it is the architecture.",
      "Every app in the rumahl Store runs against the same API surface, with explicit scopes: storage, database, scheduler, messaging, webhooks, files. The platform enforces these at the API gateway — not in the app's code, not in its terms of service. There is no permission an app can claim that the system does not check.",
      "Developers publish through a review process that checks safety, privacy and quality. Apps declare what data they process, and that declaration is shown in the Store before you install. You can review and revoke any permission at any time — and the app simply stops having it.",
      "This matters because a home is not a phone. A permission granted to an app in your home is a permission granted inside your private life. We treat it that way: destructive operations require explicit confirmation, the runtime sandbox limits resources, and apps can never reach beyond what you allowed.",
      "It also makes the Store safer for everyone. Because the platform — not the app — enforces boundaries, a compromised or abandoned app is contained. That is the promise of the rumahl Store: not that apps are good, but that they are bounded.",
    ],
  },
];
