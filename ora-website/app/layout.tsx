import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import "./globals.css";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: {
    default: "ORA - Your Intelligent Home Platform",
    template: "%s — ORA",
  },
  description:
    "ORA is the open, local-first smart home platform that puts you in control. AI-powered automation, privacy-first design, and seamless device integration.",
  keywords: [
    "ORA",
    "smart home",
    "home automation",
    "AI",
    "local-first",
    "privacy",
    "IoT",
    "Home Assistant",
    "open source",
  ],
  authors: [{ name: "ORA Team" }],
  robots: "index, follow",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://ora-home.dev",
    siteName: "ORA",
    title: "ORA - Your Intelligent Home Platform",
    description:
      "ORA is the open, local-first smart home platform that puts you in control. AI-powered automation, privacy-first design, and seamless device integration.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ORA - Your Intelligent Home Platform",
    description:
      "ORA is the open, local-first smart home platform that puts you in control.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" type="image/png" href="/favicon.png" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
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
