import type { NextConfig } from "next";
import path from "path";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error(
    "Missing required env NEXT_PUBLIC_API_URL. Build/start is blocked until it is configured."
  );
}

// Prevent double-slash rewrite destinations like
// https://backend.example.com//api/chat/health (can cause 308 before backend app code).
const normalizedApiUrl = apiUrl.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /**
   * Monorepo root: Turbopack/Next 16 resolves `next` from here (avoids wrong infer for `apps/web/app`).
   * `tailwindcss` must be available from the repo root — see root `package.json`.
   */
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${normalizedApiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
