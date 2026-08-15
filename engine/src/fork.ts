import { spawn } from "node:child_process";
import getPort from "get-port";
import { createTestClient, createPublicClient, createWalletClient, http, parseEther } from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex } from "@sidik/shared";

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
        const hash = await wallet.sendTransaction({ to, data, value, account: from, chain: base } as any);
        const rcpt = await pub.waitForTransactionReceipt({ hash });
        return { hash, reverted: rcpt.status === "reverted" };
      } catch (e: any) {
        // reverted before broadcast (eth_call style) — surface the reason
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
