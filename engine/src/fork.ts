import { spawn } from "node:child_process";
import { anvilCommand } from "./anvilBin";
import getPort from "get-port";
import {
  createTestClient, createPublicClient, createWalletClient, http, parseEther,
  BaseError, ContractFunctionRevertedError, ExecutionRevertedError,
} from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex } from "@sidik/shared";
import { REVERT_MAX, untrustedText } from "./untrusted";
import { forkProxyStats, startForkProxy, type ForkProxy } from "./forkProxy";
import { log } from "./log";

// One proxy per engine process, started the first time a fork is opened and
// kept for every fork after it. See forkProxy.ts for why anvil is not handed
// the archive RPC directly: the gateway answers anvil's nodeInfo probe with
// HTTP 400 and anvil refuses to fork at all.
let proxy: Promise<ForkProxy> | undefined;
function forkEndpoint(rpc: string): Promise<string> {
  proxy ??= startForkProxy(rpc);
  return proxy.then((p) => p.url);
}

// ponytail: fixed high gas cap for fork-only sends. Without an explicit gas
// limit, viem runs eth_estimateGas first, which itself fails on an ordinary
// revert — the tx never gets broadcast, so probes never get a real hash to
// trace. anvil doesn't care about real gas costs, so one generous constant
// is enough to force broadcast-then-revert-on-chain.
export const FORK_GAS_LIMIT = 5_000_000n;

/**
 * Every viem client that talks to an anvil fork goes through this.
 *
 * viem's http transport gives up after 10s and retries three times. A read
 * that misses anvil's cache is an archive fetch through the proxy, and under
 * a 429 burst the proxy's backoff alone runs past 20s — so under throttling
 * every probe's reads failed with "took too long" after ~40s, which was
 * recorded as the probe breaking. Two minutes matches what the fork itself
 * is allowed to spend on one replay.
 */
const FORK_RPC_TIMEOUT_MS = 120_000;
export function forkTransport(rpcUrl: string) {
  return http(rpcUrl, { timeout: FORK_RPC_TIMEOUT_MS, retryCount: 2 });
}

// Forking a busy archive RPC can take a while, and a rate-limited provider
// makes it take longer still — a tight budget turns a slow start into a
// spurious failure mid-demo.
const ANVIL_START_TIMEOUT_MS = 90_000;
const RECEIPT_TIMEOUT_MS = 600_000;
const PROBE_PING_TIMEOUT_MS = 2_000;

async function spawnAnvil(rpc: string, block: bigint, port: number) {
  // ponytail: spawn("anvil", ...) resolves anvil.exe via PATH on Windows same as any
  // other binary — no shell:true needed unless PATH resolution proves otherwise.
  // anvilCommand() returns exactly that name unless the host has no Foundry
  // and asked for one to be fetched; see anvilBin.ts.
  const proc = spawn(await anvilCommand(), [
    "--fork-url", rpc, "--fork-block-number", String(block),
    "--port", String(port), "--silent",
  ]);

  // Keep anvil's own diagnostics instead of discarding them: when it dies on
  // a bad RPC URL, a rate limit or an unusable fork block, that text is the
  // only thing that says which. Draining the pipes also stops a chatty anvil
  // from blocking on a full stdio buffer.
  let output = "";
  const keep = (chunk: unknown) => { output = (output + String(chunk)).slice(-2000); };
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  proc.on("exit", (code, signal) => { exited = { code, signal }; });
  proc.on("error", (e) => keep(`spawn error: ${e.message}`));

  const url = `http://127.0.0.1:${port}`;
  const deadline = performance.now() + ANVIL_START_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (exited) break; // died before ever serving — retrying the fetch is pointless
    try {
      // Bounded per attempt. Without this a socket that connects and then
      // goes quiet blocks the loop indefinitely, and the start deadline below
      // never gets a chance to fire.
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        signal: AbortSignal.timeout(PROBE_PING_TIMEOUT_MS) });
      if (r.ok) return { proc, url };
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  proc.kill();
  const why = exited ? `exited with code ${exited.code ?? exited.signal}` : `no response within ${ANVIL_START_TIMEOUT_MS}ms`;
  throw new Error(`anvil failed to start on port ${port} (${why})${output ? `: ${output.trim()}` : ""}`);
}

// Forking replays a burst of archive reads upstream, and a free-tier RPC
// answers some of them with 429 once a couple of forks overlap. That failure
// is transient and self-clearing, but without a retry it surfaced as a probe
// reporting NA — an infrastructure hiccup dressed up as a finding about the
// token. Retry the spawn rather than let that happen.
const ANVIL_SPAWN_ATTEMPTS = 3;
const ANVIL_RETRY_BACKOFF_MS = 1_500;

async function spawnAnvilWithRetry(rpc: string, block: bigint) {
  let last: unknown;
  for (let attempt = 1; attempt <= ANVIL_SPAWN_ATTEMPTS; attempt++) {
    // A fresh port each attempt: the previous one may still be held by the
    // process that just died.
    const port = await getPort();
    try {
      return await spawnAnvil(rpc, block, port);
    } catch (e) {
      last = e;
      if (attempt < ANVIL_SPAWN_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, ANVIL_RETRY_BACKOFF_MS * attempt));
      }
    }
  }
  throw last;
}

export interface OpenFork {
  fork: ForkClient;
  /** Tears the anvil process down. Safe to call more than once. */
  close(): void;
}

/**
 * One anvil, held open until the caller closes it.
 *
 * Exists because a run is an async generator: it has to yield an event after
 * every probe, and a value cannot be yielded from inside withFork's callback.
 * Opening the fork explicitly lets one process serve a whole run.
 */
export async function openFork(block: bigint): Promise<OpenFork> {
  const rpc = process.env.BASE_ARCHIVE_RPC;
  if (!rpc) throw new Error("BASE_ARCHIVE_RPC is not set");

  const { proc, url } = await spawnAnvilWithRetry(await forkEndpoint(rpc), block);
  const transport = forkTransport(url);
  const test = createTestClient({ mode: "anvil", chain: base, transport });
  // Plain client, no read batching. viem can coalesce same-tick reads through
  // Multicall3, and it was tried: the identical sequential code timed 7.1s,
  // 39.8s, 53.3s and 12.0s across four fresh forks. Upstream archive latency
  // swamps anything the client does, so any change here can be "proven" to
  // help by picking a run. Batching goes back in when there is a benchmark
  // that can see past the RPC.
  const pub = createPublicClient({ chain: base, transport });

  // Tracked so a probe that throws mid-impersonation cannot leave the account
  // impersonated for whatever runs next on this same fork.
  const impersonated = new Set<Hex>();

  const fork: ForkClient = {
    rpcUrl: url,
    async impersonate(a) { await test.impersonateAccount({ address: a }); impersonated.add(a); },
    async stopImpersonate(a) { await test.stopImpersonatingAccount({ address: a }); impersonated.delete(a); },
    async clearImpersonations() {
      for (const a of [...impersonated]) {
        // One that will not stop must not prevent the rest from stopping.
        try { await test.stopImpersonatingAccount({ address: a }); } catch { /* nothing left to do */ }
        impersonated.delete(a);
      }
    },
    setBalanceEth: (a, eth) => test.setBalance({ address: a, value: parseEther(eth) }),
    read: (args) => pub.readContract(args as any) as any,
    async send({ from, to, data, value, gas }) {
      // JSON-RPC account => anvil signs for impersonated/funded senders
      const wallet = createWalletClient({ account: from, chain: base, transport });
      try {
        const hash = await wallet.sendTransaction({
          to, data, value, account: from, chain: base, gas: gas ?? FORK_GAS_LIMIT,
        } as any);
        // anvil mines the moment it has the state, so this wait is really a
        // wait for archive reads through a throttled gateway. viem gives up
        // after 180s by default, and a V3 sell against a deep pool exceeded
        // that twice on 2026-08-28 while anvil was still fetching — the
        // receipt then arrived, to nobody. Ten minutes is the ceiling anvil's
        // own fork replay is given, so the wait matches it.
        const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
        // revertReason isn't on the receipt itself; leave undefined here.
        // dex.ts recovers it by replaying the call (deriveRevertReason).
        // gasUsed equal to the cap is how an out-of-gas revert is told from
        // a refusal; the logs are what the pool said it paid.
        return {
          hash, reverted: rcpt.status === "reverted", gasUsed: rcpt.gasUsed,
          logs: rcpt.logs.map((l) => ({ address: l.address as Hex, topics: [...l.topics] as Hex[], data: l.data as Hex })),
        };
      } catch (e: any) {
        // Only a genuine EVM revert (pre-broadcast, e.g. estimation still
        // failed some other way) counts as `reverted: true`. An infra/RPC
        // error must not masquerade as a revert — rethrow it.
        if (!isRevertError(e)) {
          // A receipt that never arrives is a transaction anvil accepted and
          // could not mine. Say which one: the hang is otherwise anonymous.
          if (e instanceof Error && /Timed out while waiting for transaction/.test(e.message)) {
            log.error({
              event: "fork.receiptTimeout", token: to, reason: `from=${from} gas=${(gas ?? FORK_GAS_LIMIT).toString()} data=${(data ?? "0x").slice(0, 10)}`,
            });
          }
          throw e;
        }
        return { hash: "0x" as Hex, reverted: true, revertReason: shortRevert(e) };
      }
    },
    // Nothing in a run advanced time before this existed, so every sell
    // happened seconds after its buy: a cooldown read as a honeypot and a
    // launch-window tax as a permanent one.
    async advance(seconds) {
      await test.increaseTime({ seconds });
      await test.mine({ blocks: 1 });
    },
    snapshot: () => test.snapshot(),
    revertTo: async (id) => { await test.revert({ id: id as Hex }); },
  };

  let closed = false;
  return {
    fork,
    close() {
      if (closed) return;
      closed = true;
      proc.kill();
      // The one line that tells a slow fork from a throttled one: a run whose
      // receipt waits hit 600s with `throttled` in the hundreds was
      // rate-limited, not broken. Cumulative since process start.
      log.info({ event: "fork.closed", count: Number(block), ...forkProxyStats() });
    },
  };
}

/** One anvil for one operation. Kept for callers that do not need to yield. */
export async function withFork<T>(block: bigint, fn: (fork: ForkClient) => Promise<T>): Promise<T> {
  const { fork, close } = await openFork(block);
  try { return await fn(fork); }
  finally { close(); }
}

function shortRevert(e: any): string {
  return untrustedText(e?.shortMessage || e?.message || String(e), REVERT_MAX);
}

// Minimal guard, not an error taxonomy: true only for revert-shaped errors
// (an actual EVM revert somewhere in the cause chain, or a message that says
// so). Everything else (RPC/network/timeout) is a real infra failure and
// must propagate, not be reported as a false "reverted".
export function isRevertError(e: unknown): boolean {
  if (e instanceof BaseError) {
    const revert = e.walk(
      (err) => err instanceof ContractFunctionRevertedError || err instanceof ExecutionRevertedError,
    );
    if (revert) return true;
  }
  const m = String((e as any)?.shortMessage ?? (e as any)?.message ?? "").toLowerCase();
  return m.includes("revert");
}
