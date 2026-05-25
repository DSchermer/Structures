// Cloudflare Worker entry point — handles /api/* routes and falls
// through to the ASSETS binding (the built Vite static site in ./dist).

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
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/health') return handleHealth(env);
  if (url.pathname === '/api/specs')  return handleSpecs(env);
  return json({ error: 'Not found', path: url.pathname }, 404);
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM SPEC)
            + (SELECT COUNT(*) FROM STRUCTURE)
            + (SELECT COUNT(*) FROM LINE_ITEM)
            + (SELECT COUNT(*) FROM PRICE_POINT)
            + (SELECT COUNT(*) FROM USER)
            + (SELECT COUNT(*) FROM TAG)
              AS row_count`
    ).first<{ row_count: number }>();
    return json({
      ok: true,
      d1_rows: row?.row_count ?? 0,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    return json({ ok: false, error: msg(err) }, 500);
  }
}

interface SpecRow {
  id: string;
  spec_number: string;
  customer_revision: string;
  spec_revision_count: number;
}
interface StructureRow {
  id: string;
  spec_id: string;
  part_number: string;
  parent_structure_id: string | null;
  cr: number;
  pr: number;
  line_item_count: number;
  sell_price: number | null;
}
interface TagRow {
  scope_id: string;
  name: string;
  kind: string;
}

async function handleSpecs(env: Env): Promise<Response> {
  try {
    const specsQ = await env.DB.prepare(`
      SELECT s.id, s.spec_number, s.customer_revision,
             (SELECT COUNT(*) FROM SPEC_REVISION WHERE spec_id = s.id) AS spec_revision_count
      FROM SPEC s
      ORDER BY s.spec_number
    `).all<SpecRow>();

    const specTagsQ = await env.DB.prepare(`
      SELECT st.spec_id AS scope_id, t.name, t.kind
      FROM SPEC_TAG st JOIN TAG t ON t.id = st.tag_id
      ORDER BY t.name
    `).all<TagRow>();

    const structuresQ = await env.DB.prepare(`
      SELECT s.id, s.spec_id, s.part_number, s.parent_structure_id,
             s.current_construction_revision_number AS cr,
             s.current_price_revision_number AS pr,
             (SELECT COUNT(*) FROM LINE_ITEM WHERE structure_id = s.id) AS line_item_count,
             (SELECT pp.price FROM PRICE_POINT pp
              WHERE pp.structure_id = s.id AND pp.scope = 'structure_sell'
              ORDER BY pp.set_at DESC LIMIT 1) AS sell_price
      FROM STRUCTURE s
      ORDER BY s.spec_id, (s.parent_structure_id IS NOT NULL), s.part_number
    `).all<StructureRow>();

    const structureTagsQ = await env.DB.prepare(`
      SELECT st.structure_id AS scope_id, t.name, t.kind
      FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE t.kind IN ('general', 'variant', 'system')
      ORDER BY t.kind, t.name
    `).all<TagRow>();

    const specTagsByScope = group(specTagsQ.results ?? [], (r) => r.scope_id);
    const structuresBySpec = group(structuresQ.results ?? [], (r) => r.spec_id);
    const structureTagsByScope = group(structureTagsQ.results ?? [], (r) => r.scope_id);

    const specs = (specsQ.results ?? []).map((s) => ({
      id: s.id,
      spec_number: s.spec_number,
      customer_revision: s.customer_revision,
      spec_revision_count: s.spec_revision_count,
      spec_tags: (specTagsByScope.get(s.id) ?? []).map((t) => t.name),
      parts: (structuresBySpec.get(s.id) ?? []).map((p) => {
        const tags = structureTagsByScope.get(p.id) ?? [];
        return {
          id: p.id,
          part_number: p.part_number,
          is_variant: p.parent_structure_id !== null,
          current_construction_revision_number: p.cr,
          current_price_revision_number: p.pr,
          line_item_count: p.line_item_count,
          sell_price: p.sell_price,
          general_tags: tags.filter((t) => t.kind === 'general').map((t) => t.name),
          variant_tags: tags.filter((t) => t.kind === 'variant').map((t) => t.name),
          system_tags:  tags.filter((t) => t.kind === 'system').map((t) => t.name),
        };
      }),
    }));

    return json({ specs });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

function group<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = m.get(k);
    if (arr) arr.push(item);
    else m.set(k, [item]);
  }
  return m;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
