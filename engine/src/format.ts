import { formatUnits } from "viem";

/**
 * Turns a base-unit amount into something a person can read.
 *
 * Verdicts carried raw integers straight to the screen — a judge saw
 * `10702235470409660775853120` and had to know the token's decimals to make
 * anything of it. The precision is still on chain in the transaction; what
 * belongs on screen is the number as the holder would think of it.
 */
export function amount(raw: string | bigint, decimals: number, symbol?: string): string {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return String(raw); // not a number we can format — pass it through untouched
  }

  const [whole = "0", frac = ""] = formatUnits(value, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Two decimals once the whole part carries the meaning; for sub-1 amounts
  // that would round everything to 0.00, so keep the first significant digits.
  let shown: string;
  if (whole !== "0" && whole !== "-0") {
    shown = frac.slice(0, 2).replace(/0+$/, "");
  } else {
    const firstSignificant = frac.search(/[1-9]/);
    shown = firstSignificant === -1 ? "" : frac.slice(0, firstSignificant + 4).replace(/0+$/, "");
  }

  const text = shown ? `${grouped}.${shown}` : grouped;
  return symbol ? `${text} ${symbol}` : text;
}
