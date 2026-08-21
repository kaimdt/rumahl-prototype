import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Serves the official one-line installer:
 *
 *   curl -fsSL https://rumahl.com/install | bash
 *
 * The script lives in service/install.sh (version-controlled, reviewable)
 * and is embedded into the build as a static response.
 */
export async function GET() {
  const script = await readFile(join(process.cwd(), "service", "install.sh"), "utf8");
  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
