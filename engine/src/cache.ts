// ponytail: in-memory cache; swap for a KV if the demo must survive restarts.
const store = new Map<string, unknown>();

function key(token: string, block: bigint): string {
  return `${token.toLowerCase()}:${block}`;
}

export function getCached<T = unknown>(token: string, block: bigint): T | undefined {
  return store.get(key(token, block)) as T | undefined;
}

export function setCached<T = unknown>(token: string, block: bigint, value: T): void {
  store.set(key(token, block), value);
}
