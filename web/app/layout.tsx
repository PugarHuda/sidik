import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// ponytail: loader var names deliberately differ from the Tailwind theme
// token names (--font-sans / --font-mono, set in globals.css's `@theme inline`)
// to avoid a self-referential `var(--x)` inside `--x` declaration.
const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Three weights, not four: 700 was loaded on every page and used on none.
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const TITLE = "Sidik — proof, not promises";
const DESCRIPTION = "Sidik proves what a Base token does to you — by doing it in a fork.";

export const metadata: Metadata = {
  // Without this, Next resolves the card URL against whatever host served the
  // request — so a link shared from a preview deployment unfurls an image
  // hosted on that preview, and one rendered behind a proxy can resolve to
  // localhost. Same variable sitemap.ts and robots.ts already use.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidik-eight.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  // The default card, used by every page that does not build its own. The run
  // page overrides it with one carrying that token's verdict.
  openGraph: {
    title: TITLE, description: DESCRIPTION, type: "website",
    images: [{ url: "/api/og", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image", title: TITLE, description: DESCRIPTION,
    images: [{ url: "/api/og", width: 1200, height: 630, alt: TITLE }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ink text-fg">{children}</body>
    </html>
  );
}
