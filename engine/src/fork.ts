import { spawn } from "node:child_process";
import getPort from "get-port";
import {
  createTestClient, createPublicClient, createWalletClient, http, parseEther,
  BaseError, ContractFunctionRevertedError, ExecutionRevertedError,
} from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex } from "@sidik/shared";
import { REVERT_MAX, untrustedText } from "./untrusted.js";

// ponytail: fixed high gas cap for fork-only sends. Without an explicit gas
// limit, viem runs eth_estimateGas first, which itself fails on an ordinary
// revert — the tx never gets broadcast, so probes never get a real hash to
// trace. anvil doesn't care about real gas costs, so one generous constant
// is enough to force broadcast-then-revert-on-chain.
const FORK_GAS_LIMIT = 5_000_000n;

// Forking a busy archive RPC can take a while, and a rate-limited provider
// makes it take longer still — a tight budget turns a slow start into a
// spurious failure mid-demo.
const ANVIL_START_TIMEOUT_MS = 90_000;

async function spawnAnvil(rpc: string, block: bigint, port: number) {
  // ponytail: spawn("anvil", ...) resolves anvil.exe via PATH on Windows same as any
  // other binary — no shell:true needed unless PATH resolution proves otherwise.
  const proc = spawn("anvil", [
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
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
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

export async function withFork<T>(block: bigint, fn: (fork: ForkClient) => Promise<T>): Promise<T> {
  const rpc = process.env.BASE_ARCHIVE_RPC;
  if (!rpc) throw new Error("BASE_ARCHIVE_RPC is not set");

  const { proc, url } = await spawnAnvilWithRetry(rpc, block);
  const transport = http(url);
  const test = createTestClient({ mode: "anvil", chain: base, transport });
  const pub = createPublicClient({ chain: base, transport });

  const fork: ForkClient = {
    rpcUrl: url,
    impersonate: (a) => test.impersonateAccount({ address: a }),
    stopImpersonate: (a) => test.stopImpersonatingAccount({ address: a }),
    setBalanceEth: (a, eth) => test.setBalance({ address: a, value: parseEther(eth) }),
    read: (args) => pub.readContract(args as any) as any,
    async send({ from, to, data, value }) {
      // JSON-RPC account => anvil signs for impersonated/funded senders
      const wallet = createWalletClient({ account: from, chain: base, transport });
      try {
        const hash = await wallet.sendTransaction({
          to, data, value, account: from, chain: base, gas: FORK_GAS_LIMIT,
        } as any);
        const rcpt = await pub.waitForTransactionReceipt({ hash });
        // revertReason isn't on the receipt itself; leave undefined here —
        // callTrace(hash) is how probes get the on-chain detail.
        return { hash, reverted: rcpt.status === "reverted" };
      } catch (e: any) {
        // Only a genuine EVM revert (pre-broadcast, e.g. estimation still
        // failed some other way) counts as `reverted: true`. An infra/RPC
        // error must not masquerade as a revert — rethrow it.
        if (!isRevertError(e)) throw e;
        return { hash: "0x" as Hex, reverted: true, revertReason: shortRevert(e) };
      }
    },
    callTrace: (hash) => pub.request({ method: "debug_traceTransaction" as any,
      params: [hash, { tracer: "callTracer" }] as any }) as any,
  };

  try { return await fn(fork); }
  finally { proc.kill(); }
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
