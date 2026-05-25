// GET /api/health
// Returns { ok: true, d1_rows: N } where N counts the system-tag rows
// (5) + the __system__ user (1) = 6 after Phase 0 is fully wired.

interface D1Result<T> {
  results?: T[];
}
interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>(col?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<D1Result<T>>;
  run: () => Promise<{ success: boolean }>;
}
interface D1Database {
  prepare: (query: string) => D1PreparedStatement;
}
interface Env {
  DB: D1Database;
}
type PagesFunction<E = Env> = (context: {
  env: E;
  request: Request;
}) => Response | Promise<Response>;

export const onRequest: PagesFunction = async ({ env }) => {
  try {
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM TAG WHERE kind = 'system')
       + (SELECT COUNT(*) FROM USER WHERE username = '__system__')
         AS row_count`
    ).first<{ row_count: number }>();
    return json({
      ok: true,
      d1_rows: row?.row_count ?? 0,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    return json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      500
    );
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
