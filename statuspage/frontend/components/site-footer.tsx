import Link from "next/link";
import { Activity, Rss } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/40 mt-20">
      <div className="mx-auto max-w-5xl px-5 lg:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-primary" strokeWidth={2} />
          <span>
            <Link href="https://rumahl.com" className="hover:text-foreground transition-colors">
              rumahl.com
            </Link>
            <span className="mx-2 text-border">·</span>
            <Link
              href="https://store.rumahl.com"
              className="hover:text-foreground transition-colors"
            >
              App Store
            </Link>
          </span>
        </div>
        <div className="flex items-center gap-4 text-[13px]">
          <Link
            href="/history/"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Uptime history
          </Link>
          <Link
            href="/api/feed"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Rss className="h-3.5 w-3.5" />
            RSS
          </Link>
        </div>
      </div>
      <div className="border-t border-border/30">
        <p className="mx-auto max-w-5xl px-5 lg:px-8 py-4 text-xs text-muted-foreground/60 text-center sm:text-left">
          status.rumahl.com — real-time monitoring of the rumahl platform.
        </p>
      </div>
    </footer>
  );
}
