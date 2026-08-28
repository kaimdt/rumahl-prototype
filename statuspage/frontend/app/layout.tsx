import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { FaviconUpdater } from "@/components/favicon";
import { TenantBranding } from "@/components/tenant-branding";
import "./globals.css";

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
    default: "rumahl Status",
    template: "%s — rumahl Status",
  },
  description:
    "Current status of rumahl — system components, incidents and uptime history for rumahl.com, the rumahl Store and the rumahl OS services.",
  robots: "index, follow",
  icons: {
    // served by the root router — color reflects the current status
    icon: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://status.rumahl.com",
    siteName: "rumahl Status",
    title: "rumahl Status",
    description:
      "Current status of rumahl — system components, incidents and uptime history.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden">
        <script dangerouslySetInnerHTML={{ __html: "try{if(location.hostname!=='status.rumahl.com'||location.pathname.startsWith('/s/'))document.documentElement.setAttribute('data-tenant-loading','true')}catch(e){}" }} />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <FaviconUpdater />
          <TenantBranding />
          <div className="statuspage-shell flex flex-col min-h-screen">
            <SiteHeader />
            <main className="statuspage-main flex-1">{children}</main>
            <SiteFooter />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
