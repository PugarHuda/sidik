/**
 * Addresses that cannot have a run, and why.
 *
 * "Sidik has not probed this" and "Sidik cannot probe this" are different
 * sentences, and the whole discipline of this project is refusing to let a
 * reader mistake one for the other. A bare 404 says the first when the truth
 * is the second, which is the same class of mistake as reporting N/A as clean.
 *
 * WETH earns its place here twice over: it is the asset every probe buys and
 * sells *with*, so no WETH/WETH pool exists to trade against and there is
 * nothing to execute — and it is the single most likely address anybody types
 * first, which made it the worst possible 404 on the site.
 *
 * Keys are lower-case. This is a list of facts about the chain, not a
 * denylist: nothing here is a judgement about the token.
 */
const UNPROBEABLE: Record<string, string> = {
  "0x4200000000000000000000000000000000000006":
    "WETH is the asset Sidik buys and sells with, so there is no WETH pool to trade it against. There is nothing here to execute — this is not a token that has yet to be probed.",
};

/** The reason no run can exist for this address, or undefined if one could. */
export function unprobeableReason(address: string | undefined): string | undefined {
  if (!address) return undefined;
  return UNPROBEABLE[address.toLowerCase()];
}
