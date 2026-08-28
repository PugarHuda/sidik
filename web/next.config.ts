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
  // No third-party script, style, font or image is loaded anywhere: fonts go
  // through next/font (self-hosted), the OG card is generated in-process.
  // 'unsafe-inline' for scripts is Next's own hydration payload; a nonce
  // through proxy.ts is the upgrade if a stricter policy is ever wanted.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  // Token addresses live in the query string; do not hand them to third
  // parties on outbound clicks to Basescan.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The JSON and the OpenAPI document are for other people's code: a
      // wallet popup, a Farcaster mini-app, an agent running in a browser.
      // Without this header none of them could read a verdict at all.
      ...["/api/token/:address", "/api/catalogue", "/openapi.json"].map((source) => ({
        source,
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        ],
      })),
    ];
  },
};

export default nextConfig;
