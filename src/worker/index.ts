// Cloudflare Worker entry point — handles /api/* routes and falls
// through to the ASSETS binding (the built Vite static site in ./dist).
//
// This replaces the old `functions/api/*` Pages Functions convention.
// All API routes are dispatched from `handleApi` below.

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
interface Fetcher {
  fetch: (request: Request) => Promise<Response>;
}
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(url, env);
    }

    // Everything else → static asset served from ./dist
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/health') {
    return handleHealth(env);
  }
  return json({ error: 'Not found', path: url.pathname }, 404);
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM TAG WHERE kind = 'system')
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
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
