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

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sidik — proof, not promises",
  description: "Sidik proves what a Base token does to you — by doing it in a fork.",
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
