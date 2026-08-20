import type { NextRequest } from "next/server";
import type { Hex, PreScan, Verdict } from "@sidik/shared";
import type { RunEvent } from "@/lib/sse";
import { EXAMPLES } from "@sidik/shared";

export const runtime = "nodejs";

const encoder = new TextEncoder();
const sseFrame = (e: RunEvent) => encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new Response("token query param is required", { status: 400 });

  const engineUrl = process.env.ENGINE_URL;
  // ?mock=1 is a dev convenience only — a configured ENGINE_URL in production
  // must never be short-circuited to fake data by a query param. Mock only
  // ever fires for real when there's no engine to fall back to.
  const forceMock = req.nextUrl.searchParams.get("mock") === "1" && process.env.NODE_ENV !== "production";

  // ponytail: no engine configured (or explicit dev-only ?mock=1) -> serve a
  // canned event sequence. This is both the local dev fallback (no RPC/
  // gateway wired up yet) and the offline demo path for judges without a
  // live engine. mockSseStream prepends a `demo` event so RunView can
  // render an unmissable "simulated data" banner — a mock verdict must
  // never be visually indistinguishable from a real fork proof.
  if (!engineUrl || forceMock) {
    return new Response(mockSseStream(token as Hex), {
      headers: sseHeaders,
    });
  }

  // Thin passthrough — no rewriting, just pipe the engine's SSE bytes straight through.
  const upstream = await fetch(`${engineUrl}/run?token=${encodeURIComponent(token)}`, {
    signal: req.signal,
  });
  return new Response(upstream.body, { status: upstream.status, headers: sseHeaders });
}

const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// ---- mock event stream (ponytail: dev/offline fallback only, never touches the real engine) ----

function mockSseStream(token: Hex): ReadableStream<Uint8Array> {
  const script: [number, RunEvent][] = [[0, { type: "demo" }], ...mockScript(token)];
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= script.length) {
        controller.close();
        return;
      }
      const [delayMs, event] = script[i++];
      await new Promise((r) => setTimeout(r, delayMs));
      controller.enqueue(sseFrame(event));
    },
  });
}

function mockScript(token: Hex): [number, RunEvent][] {
  const kind = EXAMPLES.find((e) => e.address.toLowerCase() === token.toLowerCase())?.kind ?? "safe";

  const scan: PreScan = {
    token,
    isErc20: true,
    symbol: kind === "safe" ? "USDC" : kind === "honeypot" ? "TRAP" : "FEE",
    decimals: kind === "safe" ? 6 : 18,
    hasPool: true,
    poolAddress: "0x111111111111111111111111111111111111aaaa",
    owner: kind === "safe" ? undefined : "0x222222222222222222222222222222222222bbbb",
    topHolders: [{ address: "0x333333333333333333333333333333333333cccc", balance: "12500000" }],
  };

  if (kind === "honeypot") {
    const honeypotVerdict: Verdict = {
      probe: "honeypot",
      status: "FAIL",
      title: "Token can be bought but not sold",
      rows: [
        { label: "Can sell after buying", claimed: "Yes — freely tradable", proven: "No — sell reverted", ok: false },
        { label: "Transfer to third party", claimed: "Unrestricted", proven: "Blocked (blacklist check on transfer)", ok: false },
      ],
      numbers: { "Buy tax": "0%", "Sell tax": "100% (reverts)" },
      txHashes: ["0xaa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa1"],
      reason: "sell() reverted: transfer blocked by hidden blacklist on non-owner sender",
    };
    const feeVerdict: Verdict = {
      probe: "hiddenFee",
      status: "FAIL",
      title: "Undocumented transfer fee",
      rows: [{ label: "Fee on transfer", claimed: "0% (none documented)", proven: "9% deducted on every transfer", ok: false }],
      numbers: { "Sent": "1,000 TRAP", "Received": "910 TRAP" },
      txHashes: ["0xbb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb2"],
    };
    return [
      [200, { type: "prescan", scan }],
      [250, { type: "plan", ids: ["honeypot", "hiddenFee"] }],
      [300, { type: "probe:start", id: "honeypot" }],
      [700, { type: "verdict", verdict: honeypotVerdict }],
      [250, { type: "probe:start", id: "hiddenFee" }],
      [600, { type: "verdict", verdict: feeVerdict }],
      [300, { type: "narration", text: "This token lets you buy freely but blocks every sell — the classic honeypot shape. On top of that, every transfer quietly loses 9% to a fee the contract never discloses. Proven in a live fork, not inferred from bytecode." }],
      [150, { type: "done" }],
    ];
  }

  if (kind === "highfee") {
    const verdict: Verdict = {
      probe: "hiddenFee",
      status: "FAIL",
      title: "Sell fee far exceeds documentation",
      rows: [
        { label: "Sell fee", claimed: "2% (per docs)", proven: "38% actually deducted", ok: false },
        { label: "Can sell at all", claimed: "Yes", proven: "Yes — but proceeds are gutted", ok: true },
      ],
      numbers: { "Expected proceeds": "0.980 ETH", "Actual proceeds": "0.620 ETH" },
      txHashes: ["0xcc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc3"],
      reason: "sell() succeeded but transferred far less than the documented 2% fee implies",
    };
    return [
      [200, { type: "prescan", scan }],
      [250, { type: "plan", ids: ["hiddenFee"] }],
      [300, { type: "probe:start", id: "hiddenFee" }],
      [750, { type: "verdict", verdict }],
      [300, { type: "narration", text: "You can sell this token — but the contract keeps 38% of the proceeds, nearly 20x the 2% fee it documents. Nothing about that is disclosed up front." }],
      [150, { type: "done" }],
    ];
  }

  // "safe" — also exercises the cache-replay path: verdicts arrive with no
  // preceding probe:start, same as engine/src/orchestrator.ts's cached-run
  // branch. RunView must render these without depending on probe:start.
  const sellVerdict: Verdict = {
    probe: "honeypot",
    status: "PASS",
    title: "Buy and sell both work as claimed",
    rows: [
      { label: "Can sell after buying", claimed: "Yes — freely tradable", proven: "Yes — sell succeeded", ok: true },
      { label: "Transfer to third party", claimed: "Unrestricted", proven: "Unrestricted", ok: true },
    ],
    numbers: { "Buy tax": "0%", "Sell tax": "0%" },
    txHashes: ["0xdd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd4"],
  };
  const feeVerdict: Verdict = {
    probe: "hiddenFee",
    status: "PASS",
    title: "No undocumented transfer fee",
    rows: [{ label: "Fee on transfer", claimed: "0%", proven: "0% — full amount received", ok: true }],
    numbers: { Sent: "1,000 USDC", Received: "1,000 USDC" },
    txHashes: ["0xee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee5"],
  };
  return [
    [200, { type: "prescan", scan }],
    [250, { type: "plan", ids: ["honeypot", "hiddenFee"] }],
    [400, { type: "verdict", verdict: sellVerdict }],
    [300, { type: "verdict", verdict: feeVerdict }],
    [300, { type: "narration", text: "Bought, sold, and transferred cleanly with no hidden fee. Nothing in this fork run contradicts what the token claims about itself." }],
    [150, { type: "done" }],
  ];
}
