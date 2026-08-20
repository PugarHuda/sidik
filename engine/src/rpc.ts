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
  return createPublicClient({ chain: base, transport: http(LOGS_RPC) });
}
