import type { NextConfig } from "next";

// Baseline headers. Nothing here is load-bearing for how the app works — it
// serves no user content and holds no session — but a tool that judges other
// people's security posture should not be missing the obvious ones itself.
const SECURITY_HEADERS = [
  // The verdict stream is JSON and the pages are HTML; nothing benefits from
  // a browser guessing otherwise.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No reason for anyone to frame a page whose whole job is to be read.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Token addresses live in the query string; do not hand them to third
  // parties on outbound clicks to Basescan.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
