import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { FIXTURE_BLOCK, FIXTURE_COUNT, headlineOf, recordedRun } from "@sidik/shared";

export const runtime = "nodejs";

/**
 * The card a shared run link unfurls into.
 *
 * Every link to this project previously unfurled as the same grey rectangle,
 * so a proven honeypot and a clean token were indistinguishable in the one
 * place people actually see them: a Discord thread, a Telegram group, a post
 * on X. Those are the channels a hackathon entry is judged and upvoted
 * through, and this is a product whose entire output is a single word.
 *
 * Rendered here rather than through the `opengraph-image` file convention
 * because the run page identifies its token by query string, and that
 * convention only receives route params.
 */

const INK = "#0a0c0e";
const CARD = "#1b1f26";
const BORDER = "#2a2f38";
const FG = "#e7eaee";
const DIM = "#9aa3b2";
const ACCENT = "#8aa4ff";
const TONE: Record<string, string> = { PASS: "#34d399", FAIL: "#ff6b6b", NA: "#f5a623" };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * A token's symbol is text its author chose, and this renders it at 64px in
 * something people share. It is already flattened and capped where the run is
 * recorded; capped again here because the cost of being wrong is a picture,
 * not a log line.
 */
function safeSymbol(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > 18 ? `${flat.slice(0, 18)}…` : flat || "?";
}

function short(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const run = ADDRESS_RE.test(token) ? recordedRun(token) : undefined;

  const headline = run ? headlineOf(run.verdicts) : null;
  const symbol = run ? safeSymbol(run.scan.symbol) : "Sidik";
  const failing = run?.verdicts.find((v) => v.status === "FAIL");
  // A failing token leads with what was proven against it. A passing one
  // leads with the thing that is actually load-bearing: it was executed.
  const line = failing?.title
    ?? (run
      ? "Bought, sold and transferred against a fork of Base — every applicable probe passed"
      : "Proves what a Base token does to you, by doing it on a fork of Base");
  const txCount = run?.verdicts.reduce((n, v) => n + v.txHashes.length, 0) ?? 0;
  const block = Number(FIXTURE_BLOCK).toLocaleString("en-US");

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "space-between", background: INK, color: FG,
        padding: "64px 72px", fontFamily: "sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, background: ACCENT }} />
          <div style={{ fontSize: 26, letterSpacing: 8, color: ACCENT }}>SIDIK</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{symbol}</div>
            {headline && (
              <div style={{
                display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 4,
                color: TONE[headline], border: `2px solid ${TONE[headline]}`,
                borderRadius: 999, padding: "8px 26px",
              }}>
                {headline}
              </div>
            )}
          </div>
          <div style={{
            fontSize: 30, lineHeight: 1.35, color: FG, maxWidth: 1000,
            display: "flex",
          }}>
            {line.length > 130 ? `${line.slice(0, 130)}…` : line}
          </div>
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          borderTop: `1px solid ${BORDER}`, paddingTop: 24, background: INK,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, color: DIM, fontSize: 22 }}>
            <div style={{ display: "flex" }}>{run ? short(token) : "sidik-eight.vercel.app"}</div>
            <div style={{ display: "flex" }}>
              {run
                ? `${txCount} transactions mined on a fork of Base at block ${block}`
                : `${FIXTURE_COUNT} Base addresses executed against a fork at block ${block}`}
            </div>
          </div>
          <div style={{
            display: "flex", fontSize: 20, color: DIM, background: CARD,
            border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 18px",
          }}>
            executed, not inferred
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // The runs are pinned to one block, so a card cannot go stale between
        // deploys — and a new deploy is exactly when it changes.
        "cache-control": "public, max-age=300, stale-while-revalidate=86400",
      },
    },
  );
}
