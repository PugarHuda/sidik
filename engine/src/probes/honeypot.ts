import type { RawResult, ProbeCtx, Verdict, Hex } from "@sidik/shared";

export function interpretHoneypot(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const bought = String(raw.boughtAmount ?? "0");
  const soldOk = Boolean(raw.soldOk);
  const txHashes = [raw.buyTxHash as Hex, raw.sellTxHash as Hex].filter(Boolean) as Hex[];

  if (bought === "0") {
    return {
      probe: "honeypot", status: "NA", title: "Could not buy — no liquidity to test",
      rows: [{ label: "Buy the token", claimed: "Tradable", proven: "Buy did not yield tokens", ok: false }],
      numbers: { boughtAmount: bought }, txHashes,
    };
  }
  if (!soldOk) {
    return {
      probe: "honeypot", status: "FAIL", title: "Honeypot — you can buy but cannot sell",
      rows: [{ label: "Sell after buying", claimed: "Freely tradable", proven: "Sell reverted", ok: false }],
      numbers: { boughtAmount: bought }, txHashes,
      reason: String(raw.sellRevertReason ?? "sell reverted"),
    };
  }
  return {
    probe: "honeypot", status: "PASS", title: "Not a honeypot — buy and sell both succeed",
    rows: [{ label: "Sell after buying", claimed: "Freely tradable", proven: "Sell succeeded", ok: true }],
    numbers: { boughtAmount: bought }, txHashes,
  };
}
