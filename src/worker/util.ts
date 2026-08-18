// Small shared helpers: JSON responses, ids, timestamps, grouping.

export function parseJson(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

export function group<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = m.get(k);
    if (arr) arr.push(item);
    else m.set(k, [item]);
  }
  return m;
}

export function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

export function uuid(): string {
  return crypto.randomUUID();
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
