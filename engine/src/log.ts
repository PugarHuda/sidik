/**
 * One-line structured logs on stdout.
 *
 * The engine printed exactly one line in its life — "listening on :8787" — so
 * a run that took ninety seconds, spawned five anvils and answered NA left no
 * record of having happened. When a probe reports NA there was no way to tell
 * from the outside whether the token did something interesting or the RPC
 * rate-limited us, which is the one distinction this whole project rests on.
 *
 * JSON per line because that is what every log shipper already parses, and no
 * dependency because `console.log(JSON.stringify(...))` is the whole feature.
 *
 * Nothing here logs a key, a URL with credentials in it, or a token symbol.
 * Symbols are attacker-chosen text (see untrusted.ts) and a log line is
 * another place that text could go somewhere it is trusted; addresses are
 * public on chain and are what makes a line useful, so those stay.
 */
type Level = "info" | "warn" | "error";

export interface LogFields {
  event: string;
  token?: string;
  probe?: string;
  ms?: number;
  status?: string;
  count?: number;
  reason?: string;
}

function emit(level: Level, fields: LogFields): void {
  // Timestamps come from the runtime, not from the caller, so two lines can
  // always be ordered against each other.
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};

/** Milliseconds since `start`, rounded — durations are for reading, not maths. */
export function since(start: number): number {
  return Math.round(performance.now() - start);
}
