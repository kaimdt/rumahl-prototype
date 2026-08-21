import type { NextConfig } from "next";

/**
 * status.rumahl.com — static export.
 * The Next.js app builds to plain HTML/JS (`out/`); the PHP backend
 * lives in the same document root under /api/.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
