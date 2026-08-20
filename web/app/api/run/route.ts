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
    symbol: kind === "safe" ? "USDC" : kind === "honeypot" ? "Anastasia" : "FEE",
    decimals: kind === "safe" ? 6 : kind === "honeypot" ? 8 : 18,
    hasPool: true,
    poolAddress: kind === "honeypot"
      ? "0xDB4B1756e5B26E523228bf7566A58a8D5F7527dC"
      : "0x111111111111111111111111111111111111aaaa",
    owner: kind === "safe" ? undefined
      : kind === "honeypot" ? "0x0000000000000000000000000000000000000000"
      : "0x222222222222222222222222222222222222bbbb",
    topHolders: kind === "honeypot" ? []
      : [{ address: "0x333333333333333333333333333333333333cccc", balance: "12500000" }],
  };

  if (kind === "honeypot") {
    // Mirrors what the real engine actually proved about this address on a
    // fork at BASE_FORK_BLOCK. The banner already says "simulated", but the
    // address is a real named token — attributing invented behaviour to it
    // would be the exact thing this project argues against.
    const honeypotVerdict: Verdict = {
      probe: "honeypot",
      status: "FAIL",
      title: "Honeypot — you can buy but cannot sell",
      rows: [{ label: "Sell after buying", claimed: "Freely tradable", proven: "Sell reverted", ok: false }],
      numbers: { boughtAmount: "17661591544435" },
      txHashes: [
        "0xf88f79a6d0f06881c3bf1303d09c57fce21865a2071190303559678a399da389",
        "0xf2652c5666595ef5578c7c1b93f847792d26cc8330907df5e16ba3de1ef030e8",
      ],
      reason: "Execution reverted with reason: TransferHelper: TRANSFER_FROM_FAILED.",
    };
    const feeVerdict: Verdict = {
      probe: "hiddenFee",
      status: "PASS",
      title: "No hidden transfer fee",
      rows: [{ label: "Transfer 100% of tokens", claimed: "Recipient gets 100%", proven: "Recipient got 100%", ok: true }],
      numbers: { sent: "17661591544435", received: "17661591544435", feePct: "0%" },
      txHashes: ["0xc559eea80f741887bf676a66730cae1cd33048c17c204a026086f0ddc9f8701b"],
    };
    const lpVerdict: Verdict = {
      probe: "lpRug",
      status: "NA",
      title: "Could not identify who controls the LP",
      rows: [{ label: "LP owner can drain the pool", claimed: "Liquidity is locked/safe",
        proven: "Largest LP holder found controls only 0% of LP supply — too little to test a rug", ok: false }],
      numbers: { ownerLpPct: "0%", holderValueBefore: "0", holderValueAfter: "0",
        lpOwner: "0x0000000000000000000000000000000000000000" },
      txHashes: [],
    };
    return [
      [200, { type: "prescan", scan }],
      [250, { type: "plan", ids: ["honeypot", "hiddenFee", "lpRug"] }],
      [300, { type: "probe:start", id: "honeypot" }],
      [700, { type: "verdict", verdict: honeypotVerdict }],
      [250, { type: "probe:start", id: "hiddenFee" }],
      [600, { type: "verdict", verdict: feeVerdict }],
      [250, { type: "probe:start", id: "lpRug" }],
      [500, { type: "verdict", verdict: lpVerdict }],
      [300, { type: "narration", text: "The buy went through and the sell reverted — the classic honeypot shape, proven on a live fork rather than inferred from bytecode. The token charges no fee on ordinary transfers, and the pre-scan could not establish who controls the pool, so no rug claim is made either way. Its owner() returns the zero address, so it presents as having renounced ownership." }],
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
