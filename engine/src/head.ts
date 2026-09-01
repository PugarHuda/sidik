import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { BASE_FORK_BLOCK } from "./forkBlock";

/**
 * The block to fork for a run that is meant to describe Base *now*.
 *
 * Every recorded verdict in this project describes one pinned block, which is
 * the right choice for a catalogue: it is reproducible, and 207 runs taken
 * under identical conditions are comparable with each other. It is the wrong
 * answer to "is this token safe today", and that is the question somebody
 * pasting an address is actually asking.
 *
 * The pin stays the default. This is the other option, not a replacement.
 */

/**
 * How far behind the tip to fork.
 *
 * Not the tip itself: Base reorgs shallowly but it does reorg, and a fork
 * taken at a block that is later dropped would produce verdicts about a chain
 * that never happened. Twenty blocks is forty seconds — far enough back to be
 * settled, near enough that "now" is honest. The same margin recheck.mts has
 * used since 2026-08-28.
 */
const REORG_MARGIN = 20n;

export async function headBlock(rpcUrl: string): Promise<bigint> {
  const client = createPublicClient({ chain: base, transport: http(rpcUrl, { timeout: 20_000 }) });
  const tip = await client.getBlockNumber();
  return tip > REORG_MARGIN ? tip - REORG_MARGIN : tip;
}

/** How far the head has moved since the catalogue was pinned, in plain words. */
export function sincePin(block: bigint): { blocks: bigint; days: number } {
  const blocks = block > BASE_FORK_BLOCK ? block - BASE_FORK_BLOCK : 0n;
  // Base mines every two seconds, exactly — measured against the chain on
  // 2026-08-31, block 0 and the pin are 50,200,000 blocks and 100,400,000
  // seconds apart.
  return { blocks, days: Number(blocks) * 2 / 86_400 };
}
