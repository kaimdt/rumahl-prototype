import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { SmoothAnchors } from "@/components/smooth-anchors";
import "./globals.css";

/* Manrope — UI & Headlines (600–700 / 500–600 / 400–500)
   JetBrains Mono — Code, Terminal, IPs */
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: {
    default: "rumahl OS - Your Home Operating System",
    template: "%s — rumahl OS",
  },
  description:
    "rumahl OS is the open, local-first home operating system. Smart home, apps, media, and ORA — your AI assistant — all on your hardware.",
  keywords: [
    "rumahl",
    "rumahl OS",
    "home OS",
    "home operating system",
    "smart home",
    "home automation",
    "AI",
    "rumahl",
    "local-first",
    "privacy",
    "IoT",
    "Home Assistant",
    "open source",
  ],
  authors: [{ name: "rumahl Team" }],
  robots: "index, follow",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://rumahl.com",
    siteName: "rumahl OS",
    title: "rumahl OS - Your Home Operating System",
    description:
      "rumahl OS is the open, local-first home operating system. Smart home, apps, media, and ORA — your AI assistant — all on your hardware.",
  },
  twitter: {
    card: "summary_large_image",
    title: "rumahl OS - Your Home Operating System",
    description:
      "rumahl OS is the open, local-first home operating system that puts you in control.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" type="image/png" href="/favicon.png" />
        {/* Google Sitelinks Search Box — lets Google use the site search
            on the docs & support pages. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "rumahl",
              url: "https://rumahl.com",
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate:
                    "https://rumahl.com/support?q={search_term_string}",
                },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <SmoothAnchors />
          <a href="#main-content" className="sr-only skip-link">
            Skip to Content
          </a>
          <div className="flex flex-col min-h-screen">
            <Header />
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
