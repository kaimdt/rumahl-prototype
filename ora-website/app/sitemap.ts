import type { MetadataRoute } from "next";
import { docsArticles } from "@/lib/docs-data";
import { supportArticles } from "@/lib/support-articles";

const BASE_URL = "https://rumahl.com";

/** Static routes with their change frequency. */
const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "", priority: 1.0, changeFrequency: "weekly" },
  { path: "/os", priority: 0.9, changeFrequency: "monthly" },
  { path: "/features", priority: 0.8, changeFrequency: "monthly" },
  { path: "/ai", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/docs", priority: 0.9, changeFrequency: "weekly" },
  { path: "/api-reference", priority: 0.8, changeFrequency: "weekly" },
  { path: "/sdks", priority: 0.8, changeFrequency: "monthly" },
  { path: "/support", priority: 0.9, changeFrequency: "weekly" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/roadmap", priority: 0.5, changeFrequency: "weekly" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/community", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/status", priority: 0.4, changeFrequency: "daily" },
  { path: "/about", priority: 0.4, changeFrequency: "yearly" },
  { path: "/story", priority: 0.4, changeFrequency: "yearly" },
  { path: "/legal", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/impressum", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/tos", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/cookies", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/rumahlos/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/rumahlos/tos", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/app-store/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/app-store/developer-agreement", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/app-store/content-policy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/app-store/review-guidelines", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/app-store/privacy-requirements", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries = STATIC_ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));

  const docEntries = docsArticles.map((article) => ({
    url: `${BASE_URL}/docs/guides/${article.slug}`,
    lastModified: new Date(article.updated),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const supportEntries = supportArticles.map((article) => ({
    url: `${BASE_URL}/support/guides/${article.slug}`,
    lastModified: new Date(article.updated),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticEntries, ...docEntries, ...supportEntries];
}
