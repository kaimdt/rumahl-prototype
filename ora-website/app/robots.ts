import type { MetadataRoute } from "next";

/**
 * robots.txt — search engines get full access, AI training crawlers are
 * restricted to the public documentation (/docs, /support) which is meant
 * to be shared and learned from. The rest of the site stays out of
 * training corpora.
 */
export default function robots(): MetadataRoute.Robots {
  const aiBots = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "anthropic-ai",
    "PerplexityBot",
    "Google-Extended",
    "CCBot",
    "Bytespider",
    "Amazonbot",
    "cohere-ai",
    "meta-externalagent",
    "Applebot-Extended",
    "Diffbot",
    "ImagesiftBot",
    "FacebookBot",
    "Timpibot",
    "PetalBot",
    "DataForSeoBot",
  ];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      // AI training crawlers: public docs/support only
      ...aiBots.map((bot) => ({
        userAgent: bot,
        allow: ["/docs", "/support"],
        disallow: "/",
      })),
    ],
    sitemap: "https://rumahl.com/sitemap.xml",
  };
}
