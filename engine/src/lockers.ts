import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex } from "@sidik/shared";

/**
 * Who is holding the LP, before anyone is impersonated as them.
 *
 * anvil's impersonation bypasses the holder's own code, so pulling LP "as" a
 * locker contract proves the pool can be drained by someone the locker was
 * built to stop. Checked across the catalogue's 25 lpRug FAILs: nine holders
 * carry code — one Gnosis Safe, eight EIP-7702 delegations — and none of
 * those was told apart from a plain wallet.
 *
 * Locker addresses verified 2026-08-28: the V2 locker is an exact Sourcify
 * match (chain 8453) exposing getNumLocksForToken/TOKEN_LOCKS/LOCKS; the V3
 * locker is Blockscout-verified as UNCX_LiquidityLocker_UniV3. Team Finance
 * and PinkLock have no Base address that could be verified, so they are not
 * listed — an unrecognised locker reads as "LP held by contract", never as a
 * pullable wallet.
 */
export const UNCX_V2_LOCKER: Hex = "0xc4e637d37113192f4f1f060daebd7758de7f4131";
export const UNCX_V3_LOCKER: Hex = "0x231278edd38b00b07fbd52120cef685b9baebcc1";

const UNCX_V2_LOCKER_ABI = parseAbi([
  "function getNumLocksForToken(address lpToken) view returns (uint256)",
  "function TOKEN_LOCKS(address lpToken, uint256 index) view returns (uint256 lockID)",
  "function LOCKS(uint256 lockID) view returns (address lpToken, uint256 lockDate, uint256 amount, uint256 initialAmount, uint256 unlockDate, uint256 lockID_, address owner, uint16 countryCode)",
]);

/** Safe proxies answer masterCopy(); the selector sits in every Safe proxy's bytecode. */
const SAFE_MASTER_COPY = "a619486e";
/** EIP-7702: an EOA that delegated to code. 23 bytes, 0xef0100 + address. */
const EIP7702_PREFIX = "0xef0100";

export type HolderKind = "eoa" | "eoa-7702" | "safe" | "uncx-locker" | "contract";

/** Pure: what kind of account holds the LP, from its address and bytecode. */
export function classifyHolder(address: Hex, code: Hex | undefined): HolderKind {
  const a = address.toLowerCase();
  if (a === UNCX_V2_LOCKER || a === UNCX_V3_LOCKER) return "uncx-locker";
  if (!code || code === "0x") return "eoa";
  if (code.toLowerCase().startsWith(EIP7702_PREFIX)) return "eoa-7702";
  if (code.toLowerCase().includes(SAFE_MASTER_COPY)) return "safe";
  return "contract";
}

export async function codeAt(fork: ForkClient, address: Hex): Promise<Hex | undefined> {
  const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
  return pub.getCode({ address });
}

/**
 * The longest-dated UNCX V2 lock on an LP token, read off the fork. `amount`
 * is the LP still locked under that lock; `unlockDate` is a unix timestamp.
 */
export async function uncxV2Lock(fork: ForkClient, lpToken: Hex): Promise<{ unlockDate: bigint; amount: bigint } | undefined> {
  const n = await fork.read<bigint>({ address: UNCX_V2_LOCKER, abi: UNCX_V2_LOCKER_ABI, functionName: "getNumLocksForToken", args: [lpToken] });
  let best: { unlockDate: bigint; amount: bigint } | undefined;
  // ponytail: bounded at 20 locks per token; the catalogue's lockers hold one.
  for (let i = 0n; i < n && i < 20n; i++) {
    const id = await fork.read<bigint>({ address: UNCX_V2_LOCKER, abi: UNCX_V2_LOCKER_ABI, functionName: "TOKEN_LOCKS", args: [lpToken, i] });
    const lock = await fork.read<readonly [Hex, bigint, bigint, bigint, bigint, bigint, Hex, number]>({
      address: UNCX_V2_LOCKER, abi: UNCX_V2_LOCKER_ABI, functionName: "LOCKS", args: [id],
    });
    const [, , amount, , unlockDate] = lock;
    if (amount === 0n) continue;
    if (!best || unlockDate > best.unlockDate) best = { unlockDate, amount };
  }
  return best;
}

export function isoDate(unix: bigint): string {
  return new Date(Number(unix) * 1000).toISOString().slice(0, 10);
}
