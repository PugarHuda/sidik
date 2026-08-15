import { spawn } from "node:child_process";
import getPort from "get-port";
import {
  createTestClient, createPublicClient, createWalletClient, http, parseEther,
  BaseError, ContractFunctionRevertedError, ExecutionRevertedError,
} from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex } from "@sidik/shared";

// ponytail: fixed high gas cap for fork-only sends. Without an explicit gas
// limit, viem runs eth_estimateGas first, which itself fails on an ordinary
// revert — the tx never gets broadcast, so probes never get a real hash to
// trace. anvil doesn't care about real gas costs, so one generous constant
// is enough to force broadcast-then-revert-on-chain.
const FORK_GAS_LIMIT = 5_000_000n;

async function spawnAnvil(rpc: string, block: bigint, port: number) {
  // ponytail: spawn("anvil", ...) resolves anvil.exe via PATH on Windows same as any
  // other binary — no shell:true needed unless PATH resolution proves otherwise.
  const proc = spawn("anvil", [
    "--fork-url", rpc, "--fork-block-number", String(block),
    "--port", String(port), "--silent",
  ]);
  // wait until the JSON-RPC responds
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      if (r.ok) return { proc, url };
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  proc.kill();
  throw new Error("anvil failed to start");
}

export async function withFork<T>(block: bigint, fn: (fork: ForkClient) => Promise<T>): Promise<T> {
  const rpc = process.env.BASE_ARCHIVE_RPC;
  if (!rpc) throw new Error("BASE_ARCHIVE_RPC is not set");

  const port = await getPort();
  const { proc, url } = await spawnAnvil(rpc, block, port);
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
  const m = e?.shortMessage || e?.message || String(e);
  return m.slice(0, 200);
}

// Minimal guard, not an error taxonomy: true only for revert-shaped errors
// (an actual EVM revert somewhere in the cause chain, or a message that says
// so). Everything else (RPC/network/timeout) is a real infra failure and
// must propagate, not be reported as a false "reverted".
function isRevertError(e: unknown): boolean {
  if (e instanceof BaseError) {
    const revert = e.walk(
      (err) => err instanceof ContractFunctionRevertedError || err instanceof ExecutionRevertedError,
    );
    if (revert) return true;
  }
  const m = String((e as any)?.shortMessage ?? (e as any)?.message ?? "").toLowerCase();
  return m.includes("revert");
}
