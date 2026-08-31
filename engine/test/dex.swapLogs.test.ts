import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, pad } from "viem";
import type { Hex } from "@sidik/shared";
import { wethOutOfSwapLogs } from "../src/dex";

const SWAP = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);
const POOL = "0x1111111111111111111111111111111111111111" as Hex;
const ROUTER = "0x2222222222222222222222222222222222222222" as Hex;

function swapLog(sender: Hex, out: [bigint, bigint, bigint, bigint]) {
  return {
    address: POOL,
    topics: encodeEventTopics({ abi: [SWAP], eventName: "Swap", args: { sender, to: ROUTER } }) as Hex[],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], out,
    ),
  };
}
// A Sync(uint112,uint112) log from the same pool — not a Swap, must be skipped.
const sync = {
  address: POOL,
  topics: ["0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1" as Hex],
  data: pad("0x01") as Hex,
};

describe("wethOutOfSwapLogs — the router's swap, not the token's swapBack", () => {
  // The Base meme template sells its tax inside _transfer before the router
  // swaps: two Swap logs in one sell, the contract's first. The pool's WETH
  // delta summed both and credited the holder with the contract's cut —
  // "sell tax 0%" on a token hand-verified at 2.99%.
  it("takes the LAST Swap log from the pool", () => {
    const token = "0x3333333333333333333333333333333333333333" as Hex;
    const logs = [
      swapLog(token, [1000n, 0n, 0n, 500n]),   // swapBack: 500 WETH out to the contract
      sync,
      swapLog(ROUTER, [2000n, 0n, 0n, 100n]),  // router: 100 WETH out to the holder
      sync,
    ];
    expect(wethOutOfSwapLogs(logs, POOL, false)).toBe(100n);
  });

  it("reads the WETH side by token0 ordering", () => {
    const logs = [swapLog(ROUTER, [0n, 2000n, 100n, 0n])];
    expect(wethOutOfSwapLogs(logs, POOL, true)).toBe(100n);
    expect(wethOutOfSwapLogs(logs, POOL, false)).toBe(0n);
  });

  it("ignores logs from other contracts and answers undefined with no Swap at all", () => {
    const other = { ...swapLog(ROUTER, [0n, 0n, 0n, 999n]), address: ROUTER };
    expect(wethOutOfSwapLogs([other, sync], POOL, false)).toBeUndefined();
  });
});
