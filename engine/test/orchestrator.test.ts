import { describe, it, expect } from "vitest";
import { runSidik, type RunEvent } from "../src/orchestrator.js";
import type { ForkClient, Hex, PreScan } from "@sidik/shared";

const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex; // checksum-valid (USDC on Base)
const TEST_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Hex;

const scan: PreScan = {
  token: TOKEN,
  isErc20: true,
  symbol: "TST",
  decimals: 18,
  hasPool: true,
  topHolders: [],
};

// Stub ForkClient: honeypot probe's buy-then-sell round trip, all succeeding,
// driven purely off canned reads/sends — no network.
function makeStubFork(): ForkClient {
  const balances = [0n, 1000n, 1000n]; // buy-before, buy-after, sellAll-amount
  let i = 0;
  return {
    rpcUrl: "http://fake",
    impersonate: async () => {},
    stopImpersonate: async () => {},
    setBalanceEth: async () => {},
    read: async () => balances[Math.min(i++, balances.length - 1)] as unknown as any,
    send: async () => ({ hash: "0xhash" as Hex, reverted: false }),
    callTrace: async () => ({}),
  };
}

describe("runSidik", () => {
  it("emits prescan -> plan -> (probe:start, verdict)xN -> narration -> done, and turns a fork throw into an NA verdict", async () => {
    let forkCalls = 0;
    const events: RunEvent[] = [];

    for await (const ev of runSidik(TOKEN, {
      block: 1n,
      testWallet: TEST_WALLET,
      prescan: async () => scan,
      planProbes: async () => ["honeypot", "hiddenFee"],
      narrate: async () => "summary text",
      withFork: async (_block, fn) => {
        forkCalls++;
        // 1st call = prescan fork, 2nd = honeypot probe, 3rd = hiddenFee probe.
        if (forkCalls === 3) throw new Error("fork exploded");
        return fn(makeStubFork());
      },
      getCached: () => undefined,
      setCached: () => {},
    })) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual([
      "prescan", "plan", "probe:start", "verdict", "probe:start", "verdict", "narration", "done",
    ]);

    const verdicts = events.filter((e): e is RunEvent & { type: "verdict" } => e.type === "verdict")
      .map((e) => e.verdict);
    expect(verdicts[0].probe).toBe("honeypot");
    expect(verdicts[0].status).toBe("PASS");
    expect(verdicts[1].probe).toBe("hiddenFee");
    expect(verdicts[1].status).toBe("NA"); // fork threw -> NA, run continued
    expect(verdicts[1].title).toMatch(/hiddenFee/);

    const narration = events.find((e) => e.type === "narration");
    expect(narration && (narration as any).text).toBe("summary text");
  });

  it("replays a cached run without calling withFork/prescan/planProbes/narrate again", async () => {
    const cached = {
      scan,
      ids: ["honeypot"],
      verdicts: [{ probe: "honeypot", status: "PASS", title: "cached", rows: [], numbers: {}, txHashes: [] }],
      narration: "cached narration",
    };
    const events: RunEvent[] = [];
    for await (const ev of runSidik(TOKEN, {
      block: 1n,
      getCached: <T,>() => cached as unknown as T,
      setCached: () => { throw new Error("should not set cache on hit"); },
      withFork: async () => { throw new Error("should not fork on cache hit"); },
      prescan: async () => { throw new Error("should not prescan on cache hit"); },
      planProbes: async () => { throw new Error("should not plan on cache hit"); },
      narrate: async () => { throw new Error("should not narrate on cache hit"); },
    })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(["prescan", "plan", "verdict", "narration", "done"]);
  });
});
