import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex, Probe, ProbeCtx, RawResult, Verdict } from "@sidik/shared";
import { ERC20_ABI } from "../abi.js";
import { ZERO_ADDRESS } from "../base.js";
import { buyBudget, buyExactEth, sellAll } from "../dex.js";
import { amount } from "../format.js";
import { SWITCHES_SEARCHED, callData, switchesIn } from "../selectors.js";

/**
 * Whether the owner can still trap you AFTER you have bought.
 *
 * Every other probe asks what the token does right now. This one asks what
 * the token's owner can still decide to do to a holder who is already in --
 * and answers it the only way Sidik answers anything, by doing it: buy, take
 * a snapshot, sell once to establish that selling works, roll back to the
 * snapshot, let the owner pull what its bytecode carries, and sell again from
 * identical state.
 *
 * A contract that reads clean today and hands one address the power to stop
 * every sell tomorrow is the gap between "audited" and "safe", and reading
 * the source cannot prove which side of it a token is on.
 *
 * The two kinds of switch are measured SEPARATELY, each from that same
 * snapshot. Blocking the sell and printing supply move the state in different
 * directions, and running them in sequence would leave neither result
 * attributable to what caused it.
 */

// An address anvil will impersonate that is nobody in particular, used to
// show a switch is genuinely owner-gated rather than open to all comers.
//
// Written in its EIP-55 checksummed form, which is not cosmetic: viem's
// isAddress is strict by default, so a hand-typed literal with the wrong
// case is rejected outright. This one ended "5A1DEC" and every
// renounced-ownership token -- half of those carrying a switch, BRETT and
// AERO among them -- died on "Address must be a hex value of 20 bytes"
// rather than being probed. The message names the length; the fault was the
// case.
export const STRANGER: Hex = "0x00000000000000000000000000000000005A1Dec";

// Below this share of the baseline the exit did not merely get worse -- the
// position stopped being worth exiting. Set well clear of ordinary tax and
// price-impact differences between two sells of the same size.
const COLLAPSE_PCT = 10;
// A sell that still goes through but hands back under half of what the same
// sell paid moments earlier is a fee switch that was thrown, not noise.
const DEGRADED_PCT = 50;

interface SwitchCall { sig: string; ok: boolean; reason?: string }

function keptPct(after: bigint, before: bigint): number {
  if (before === 0n) return 0;
  return Number((after * 10000n) / before) / 100;
}

export function interpretOwnerTrap(raw: RawResult, ctx: ProbeCtx): Verdict {
  const label = "Owner can trap a holder after the buy";
  const claimed = "Once you hold it, exiting is up to you";
  const calls = (raw.calls ?? []) as SwitchCall[];
  const pulled = calls.filter((c) => c.ok).map((c) => c.sig);
  const searched = Number(raw.searched ?? SWITCHES_SEARCHED);
  // The switches present in the bytecode, which is not the same as the ones
  // that got called: a switch a stranger could pull short-circuits the owner
  // phases, and reading `found` off the call log would then report "none".
  const found = ((raw.found ?? calls.map((c) => c.sig)) as string[]);
  const numbers: Record<string, string> = {
    switchesSearched: String(searched),
    switchesFound: found.join(", ") || "none",
    switchesPulled: pulled.join(", ") || "none",
    owner: String(raw.owner ?? ZERO_ADDRESS),
  };
  const txHashes = [raw.buyTxHash, raw.baselineSellHash, raw.blockSellHash, raw.dumpTxHash, raw.diluteSellHash]
    .filter((h) => h && h !== "0x") as Hex[];

  // Nothing to operate. Say precisely what was searched for: an absence of
  // evidence is not evidence of absence, and a PASS here would claim more
  // than a bytecode scan can support.
  if (raw.noSwitches) {
    return {
      probe: "ownerTrap", status: "NA",
      title: "No owner switch Sidik can operate is present in this bytecode",
      rows: [{
        label, claimed,
        proven: `Searched the deployed bytecode for ${searched} known owner switches -- pause, blacklist, trading and fee setters, mint -- and found none. Privileged code may still exist under a name Sidik does not know.`,
        ok: false,
      }],
      numbers, txHashes: [],
      // There is no mechanism here to test, so this says nothing about the
      // token and must not drag its headline down -- the same distinction
      // lpRug draws on a V3 pool. 82 tokens were once summarised as NA purely
      // because of a probe that could not apply to them while they passed
      // everything that could.
      applicable: false,
    };
  }

  // The measurement needs a working sell to compare against. Without one
  // there is no "before", and reporting the "after" alone would blame this
  // probe's own owner action for a token that could never be sold anyway.
  if (raw.cannotTest) {
    return {
      probe: "ownerTrap", status: "NA",
      title: `Could not test the owner's switches on ${ctx.scan.symbol}`,
      rows: [{ label, claimed, proven: String(raw.cannotTest), ok: false }],
      numbers, txHashes,
    };
  }

  const baseline = BigInt(String(raw.baselineReceived ?? "0"));
  const before = amount(baseline, 18, "WETH");

  // A switch anybody can pull is worse than one only the owner can.
  if (raw.openToAnyone) {
    return {
      probe: "ownerTrap", status: "FAIL",
      title: `Anyone can call ${String(raw.openToAnyone)} on this token`,
      rows: [{
        label, claimed,
        proven: `${String(raw.openToAnyone)} executed from an address with no relationship to the token, and the exit stopped working afterwards — so the switch is not owner-gated at all`,
        ok: false,
      }],
      numbers, txHashes,
    };
  }

  if (raw.blockReverted) {
    return {
      probe: "ownerTrap", status: "FAIL",
      title: `The owner pulled ${pulled.join(" + ")} and the sell stopped working`,
      rows: [{
        label, claimed,
        proven: `The same sell that returned ${before} moments earlier reverted once the owner called ${pulled.join(" + ")}`,
        ok: false,
      }],
      numbers: { ...numbers, proceedsBefore: before, proceedsAfter: "reverted" },
      txHashes,
      reason: String(raw.blockReason ?? "the sell reverted"),
    };
  }

  // Everything below is a ratio against the first sell. Without a measurable
  // first sell there is no ratio to take, and dividing by it yields 0% --
  // which reads as a total loss the owner caused. Measuring zero and judging
  // on it is what once turned USDC into a honeypot.
  if (baseline === 0n) {
    return {
      probe: "ownerTrap", status: "NA",
      title: "Could not measure what the exit was worth before the owner acted",
      rows: [{
        label, claimed,
        proven: "The first sell went through but no proceeds could be measured, so there is nothing to compare a second one against",
        ok: false,
      }],
      numbers, txHashes,
    };
  }

  const pctText = (n: number) => `${n.toFixed(2).replace(/[.]00$/, "")}%`;

  if (raw.blockTried) {
    const after = BigInt(String(raw.blockReceived ?? "0"));
    const kept = keptPct(after, baseline);
    if (kept <= DEGRADED_PCT) {
      return {
        probe: "ownerTrap", status: "FAIL",
        title: `The owner pulled ${pulled.join(" + ")} and the exit lost ${(100 - kept).toFixed(0)}% of its value`,
        rows: [{
          label, claimed,
          proven: `The identical sell returned ${before} before the owner acted and ${amount(after, 18, "WETH")} after`,
          ok: false,
        }],
        numbers: {
          ...numbers, proceedsBefore: before,
          proceedsAfter: amount(after, 18, "WETH"), proceedsKept: pctText(kept),
        },
        txHashes,
      };
    }
  }

  if (raw.diluted) {
    const after = BigInt(String(raw.diluteReceived ?? "0"));
    const kept = keptPct(after, baseline);
    const now = amount(after, 18, "WETH");
    const supplyBefore = String(raw.supplyBefore ?? "0");
    const supplyAfter = String(raw.supplyAfter ?? "0");
    const minted = amount(BigInt(supplyAfter) - BigInt(supplyBefore), ctx.scan.decimals, ctx.scan.symbol);
    const diluteNumbers = {
      ...numbers,
      supplyBefore: amount(supplyBefore, ctx.scan.decimals, ctx.scan.symbol),
      supplyAfter: amount(supplyAfter, ctx.scan.decimals, ctx.scan.symbol),
      minted, proceedsBefore: before, proceedsAfter: now, proceedsKept: pctText(kept),
    };
    if (kept <= COLLAPSE_PCT) {
      return {
        probe: "ownerTrap", status: "FAIL",
        title: `The owner minted ${minted} and sold it -- the same exit then paid ${pctText(kept)} of what it had`,
        rows: [{
          label, claimed,
          proven: `mint(address,uint256) let the owner print new supply and sell it into the same pool. The identical sell went from ${before} to ${now}`,
          ok: false,
        }],
        numbers: diluteNumbers, txHashes,
      };
    }
    return {
      probe: "ownerTrap", status: "PASS",
      title: `The owner minted and dumped, and the exit still paid ${pctText(kept)} of ${before}`,
      rows: [{
        label, claimed,
        proven: `The owner printed ${minted} and sold it into the pool; the identical sell still returned ${now}`,
        ok: true,
      }],
      numbers: diluteNumbers, txHashes,
    };
  }

  // Every switch the owner has was thrown and the exit survived it. That is a
  // positive result produced by executing the attack, not by failing to find
  // one.
  if (pulled.length) {
    const after = BigInt(String(raw.blockReceived ?? raw.baselineReceived ?? "0"));
    return {
      probe: "ownerTrap", status: "PASS",
      title: `The owner pulled ${pulled.join(" + ")} and you could still sell`,
      rows: [{
        label, claimed,
        proven: `Impersonating ${String(raw.owner)}, Sidik called ${pulled.join(", ")} and then made the identical sell: ${before} before, ${amount(after, 18, "WETH")} after`,
        ok: true,
      }],
      numbers: {
        ...numbers, proceedsBefore: before,
        proceedsAfter: amount(after, 18, "WETH"),
        proceedsKept: pctText(keptPct(after, baseline)),
      },
      txHashes,
    };
  }

  // The switches are in the bytecode but could not be operated.
  const why = calls.map((c) => `${c.sig}: ${c.reason ?? "reverted"}`).join("; ");
  // A contract with no owner() at all is not a contract whose owner renounced,
  // and the two must not be told as one sentence. They also do not deserve the
  // same verdict.
  //
  // Renounced is provable: owner() reads as the zero address, nobody can sign
  // for it, and the calls reverted. That is a PASS with evidence.
  //
  // No owner() at all leaves Sidik unable to name who may operate the switch —
  // it could be a minter role, an access-control grant or a bridge. All that
  // was established is that an unrelated address could not. That is "tried and
  // could not tell", which is what NA means; a PASS would be a verdict with no
  // evidence behind it, the same reason lpRug declines when it cannot identify
  // an LP holder.
  if (raw.noOwnerFn) {
    return {
      probe: "ownerTrap", status: "NA",
      title: found.length === 1
        ? "The switch exists and Sidik could not establish who is allowed to pull it"
        : `${found.length} switches exist and Sidik could not establish who is allowed to pull them`,
      rows: [{
        label, claimed,
        proven: `The contract exposes no owner() to read, so there was no privileged address to impersonate. Calling ${found.join(", ")} from an unrelated address reverted every time, which rules out only that anyone can`,
        ok: false,
      }],
      numbers, txHashes, reason: why,
    };
  }

  if (raw.renounced) {
    return {
      probe: "ownerTrap", status: "PASS",
      title: found.length === 1
        ? "The switch exists, but ownership is renounced and the call reverted"
        : `All ${found.length} switches exist, but ownership is renounced and every call reverted`,
      rows: [{
        label, claimed,
        proven: `owner() is the zero address, so no one can satisfy an owner check. Calling ${found.join(", ")} from an unrelated address reverted every time`,
        ok: true,
      }],
      numbers, txHashes, reason: why,
    };
  }
  return {
    probe: "ownerTrap", status: "PASS",
    title: `The owner holds ${found.length === 1 ? "a switch" : `${found.length} switches`} but the contract refused every call`,
    rows: [{
      label, claimed,
      proven: `Calling ${found.join(", ")} as ${String(raw.owner)} reverted, so the switch is capped or gated by something the owner does not control`,
      ok: true,
    }],
    numbers, txHashes, reason: why,
  };
}

export const ownerTrapProbe: Probe = {
  id: "ownerTrap",
  title: "Owner's switches, pulled",
  applicableWhen: (s) => s.isErc20 && s.hasPool,
  async setup(fork: ForkClient, ctx: ProbeCtx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork: ForkClient, ctx: ProbeCtx): Promise<RawResult> {
    const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });

    const code = (await pub.getCode({ address: ctx.token })) ?? "0x";
    const switches = switchesIn(code);
    if (switches.length === 0) return { noSwitches: true, searched: SWITCHES_SEARCHED };
    const found = switches.map((s) => s.sig);

    const owner = ctx.scan.owner;
    // Recorded separately because they are separate observations: a contract
    // that never exposed owner() is not one whose owner gave up control.
    const noOwnerFn = !owner;
    const renounced = noOwnerFn || owner.toLowerCase() === ZERO_ADDRESS.toLowerCase();
    // With ownership renounced nobody can pass the owner check, so the actor
    // is a stranger and a revert every time is the expected result -- which is
    // the proof, not a reason to skip the probe.
    const actor: Hex = renounced ? STRANGER : owner;
    const calls: SwitchCall[] = [];

    const ethIn = await buyBudget(fork, ctx);
    const buy = await buyExactEth(fork, ctx, ethIn);
    if (!buy.ok) {
      return {
        searched: SWITCHES_SEARCHED, owner: actor, renounced, noOwnerFn, found,
        calls: switches.map((s) => ({ sig: s.sig, ok: false })),
        cannotTest: `The buy did not go through${buy.revertReason ? ` (${buy.revertReason})` : ""}, so there is no position to trap`,
      };
    }

    // anvil's snapshot/revert is what makes "the identical sell" a literal
    // claim: every sell below runs against byte-identical post-buy state.
    //
    // The id is CONSUMED by the revert. Rolling back to the same id three
    // times -- once per phase, which is what this did first -- silently does
    // nothing after the first, so the blocking phase would have run on top of
    // whatever the stranger phase left behind. A fresh snapshot every time is
    // the whole guarantee.
    let snapshot = await fork.snapshot();
    const restore = async () => {
      await fork.revertTo(snapshot);
      snapshot = await fork.snapshot();
    };

    const baseline = await sellAll(fork, ctx);
    if (!baseline.ok) {
      return {
        searched: SWITCHES_SEARCHED, owner: actor, renounced, noOwnerFn, found, buyTxHash: buy.hash,
        calls: switches.map((s) => ({ sig: s.sig, ok: false })),
        cannotTest: "The sell already fails before the owner touches anything, so no change could be attributed to a switch",
      };
    }
    const supply = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "totalSupply" });

    const blockers = switches.filter((s) => s.kind === "block");
    const minters = switches.filter((s) => s.kind === "dilute");
    let openToAnyone: string | undefined;

    // ---- phase zero: can a stranger pull it, and does it do anything? ------
    // Asked of every token, not only the ones that renounced. A switch with no
    // owner check at all is worse than owner power, and testing it only where
    // ownership had already been given up left that finding unreachable on
    // every token that still has an owner.
    //
    // A call that does not revert is NOT proof the switch was open. Plenty of
    // contracts accept a call from anyone and quietly do nothing, and some
    // answer any selector at all through a fallback. So the claim is settled
    // the same way every other claim here is: by what happened next. The
    // stranger's calls only count if the exit then broke, or supply moved.
    await restore();
    await fork.setBalanceEth(STRANGER, "10");
    await fork.impersonate(STRANGER);
    const accepted: string[] = [];
    for (const s of switches) {
      const tx = await fork.send({ from: STRANGER, to: ctx.token, data: callData(s, ctx.testWallet, STRANGER, supply) });
      if (!tx.reverted) accepted.push(s.sig);
    }
    await fork.stopImpersonate(STRANGER);
    if (accepted.length) {
      const supplyNow = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "totalSupply" });
      const strangerSell = await sellAll(fork, ctx);
      // The proceeds comparison only means anything when the first sell
      // measured something. keptPct of a zero baseline is 0, which reads as a
      // total loss -- and here it would have accused the contract of letting
      // anyone break it, on the strength of a measurement that never happened.
      const base = BigInt(baseline.received);
      const collapsed = base > 0n
        && keptPct(BigInt(strangerSell.received), base) <= DEGRADED_PCT;
      if (!strangerSell.ok || collapsed || supplyNow > supply) openToAnyone = accepted.join(" + ");
    }

    // ---- phase one: throw every blocking switch, then sell -----------------
    let blockSell: Awaited<ReturnType<typeof sellAll>> | undefined;
    if (blockers.length && !openToAnyone) {
      await restore();
      await fork.setBalanceEth(actor, "10");
      await fork.impersonate(actor);
      for (const s of blockers) {
        const tx = await fork.send({ from: actor, to: ctx.token, data: callData(s, ctx.testWallet, actor, supply) });
        calls.push({ sig: s.sig, ok: !tx.reverted, reason: tx.revertReason });
      }
      await fork.stopImpersonate(actor);
      blockSell = await sellAll(fork, ctx);
    }

    // ---- phase two: print supply and sell it into the same pool ------------
    let diluted = false;
    let supplyAfter = supply;
    let dumpTxHash: Hex | undefined;
    let diluteSell: Awaited<ReturnType<typeof sellAll>> | undefined;
    if (minters.length && !openToAnyone) {
      const mintSwitch = minters[0]!;
      await restore();
      await fork.setBalanceEth(actor, "10");
      await fork.impersonate(actor);
      const tx = await fork.send({ from: actor, to: ctx.token, data: callData(mintSwitch, ctx.testWallet, actor, supply) });
      calls.push({ sig: mintSwitch.sig, ok: !tx.reverted, reason: tx.revertReason });
      if (!tx.reverted) {
        supplyAfter = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "totalSupply" });
        if (supplyAfter > supply) {
          // No openToAnyone check here: when ownership is renounced the actor
          // IS the stranger, so phase zero already made this exact call and
          // already compared total supply afterwards.
          // Printed supply harms nobody until it reaches the pool the holder
          // has to sell into, so the owner sells it -- same router, same path.
          const minted = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [actor] });
          const dump = await sellAll(fork, { ...ctx, testWallet: actor }, minted);
          dumpTxHash = dump.hash;
          diluted = true;
        }
      }
      await fork.stopImpersonate(actor);
      if (diluted) diluteSell = await sellAll(fork, ctx);
    }

    return {
      searched: SWITCHES_SEARCHED, owner: actor, renounced, noOwnerFn, found, calls, openToAnyone,
      buyTxHash: buy.hash,
      baselineSellHash: baseline.hash, baselineReceived: baseline.received,
      // What was actually attempted, not what was available to attempt: phase
      // one is skipped when a stranger already broke it, and a true here with
      // no measurement behind it is a trap for whoever reorders interpret().
      blockTried: Boolean(blockSell),
      blockSellHash: blockSell?.hash,
      blockReverted: blockSell ? !blockSell.ok : false,
      blockReason: blockSell?.revertReason,
      blockReceived: blockSell?.received ?? "0",
      diluted, dumpTxHash,
      diluteSellHash: diluteSell?.hash,
      diluteReceived: diluteSell?.received ?? "0",
      supplyBefore: supply.toString(), supplyAfter: supplyAfter.toString(),
    };
  },
  interpret: interpretOwnerTrap,
};
