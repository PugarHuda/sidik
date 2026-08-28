import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// ponytail: historical eth_getLogs goes to its own endpoint, NOT through the
// anvil fork. Verified 2026-08-20: Alchemy's free tier caps eth_getLogs at a
// 10-block range, which makes the approval/transfer scans useless (prescan
// swallowed the error and returned an empty holder list; approvalDrain threw).
// Base's own public RPC serves the same archive data over a workable range.
// Logs are historical, so reading them off-fork is equivalent — fork state
// only diverges from mainnet for blocks after the pin. Override with
// BASE_LOGS_RPC if the public endpoint starts rate-limiting.
const LOGS_RPC = process.env.BASE_LOGS_RPC ?? "https://mainnet.base.org";

// ponytail: `any` return, matching the existing call sites in prescan.ts /
// approvalDrain.ts — the chain-formatter generic isn't worth threading through.
export function logsClient(): any {
  // Retried and bounded on purpose. This is a free public endpoint, and a
  // single refused request here does not surface as an error — prescan
  // catches it and returns an empty holder sample, which lpRug then reports
  // as "no holder position to measure the pull against". That reads as a
  // finding about the token and is really a finding about the network.
  //
  // Measured: one token in 122 re-recorded runs flipped lpRug from FAIL to NA
  // on nothing but this, and running it again immediately returned FAIL. viem
  // retries three times at 150ms by default, which is too fast to outlast a
  // rate limit; five attempts backing off from half a second does.
  return createPublicClient({
    chain: base,
    transport: http(LOGS_RPC, { timeout: 20_000, retryCount: 5, retryDelay: 500 }),
  });
}
