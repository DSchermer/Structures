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
  if (url.pathname === '/api/search') return handleSearch(env);
  if (url.pathname === '/api/tags')   return handleTags(env);
  if (url.pathname === '/api/users')  return handleUsers(env);
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

interface SearchRow {
  id: string;
  spec_id: string;
  spec_number: string;
  part_number: string;
  top_level_part_number: string;
  parent_structure_id: string | null;
  parent_part_number: string | null;
  current_construction_revision_number: number;
  current_price_revision_number: number;
  line_item_count: number;
  sell_price: number | null;
  subassembly_cost: number | null;
  checkout_holder_name: string | null;
  checkout_acquired_at: string | null;
}
interface TagRow {
  scope_id: string;
  name: string;
  kind: string;
}

async function handleSearch(env: Env): Promise<Response> {
  try {
    // Pull every structure with its spec context + counts + sell/cost + lock state.
    // For the demo's catalog size (~30 rows), returning all results to the
    // client and filtering there is fine; live-narrowing search stays snappy.
    const structuresQ = await env.DB.prepare(`
      SELECT
        s.id, s.spec_id, sp.spec_number, s.part_number,
        (sp.spec_number || s.part_number) AS top_level_part_number,
        s.parent_structure_id,
        ps.part_number AS parent_part_number,
        s.current_construction_revision_number,
        s.current_price_revision_number,
        (SELECT COUNT(*) FROM LINE_ITEM WHERE structure_id = s.id) AS line_item_count,
        (SELECT pp.price FROM PRICE_POINT pp
         WHERE pp.structure_id = s.id AND pp.scope = 'structure_sell'
         ORDER BY pp.set_at DESC LIMIT 1) AS sell_price,
        (SELECT pp.price FROM PRICE_POINT pp
         WHERE pp.structure_id = s.id AND pp.scope = 'subassembly_cost'
         ORDER BY pp.set_at DESC LIMIT 1) AS subassembly_cost,
        u.display_name AS checkout_holder_name,
        cl.acquired_at AS checkout_acquired_at
      FROM STRUCTURE s
      JOIN SPEC sp ON sp.id = s.spec_id
      LEFT JOIN STRUCTURE ps ON ps.id = s.parent_structure_id
      LEFT JOIN CHECKOUT_LOCK cl ON cl.structure_id = s.id
      LEFT JOIN USER u ON u.id = cl.holder_user_id
      ORDER BY sp.spec_number, (s.parent_structure_id IS NOT NULL), s.part_number
    `).all<SearchRow>();

    const specTagsQ = await env.DB.prepare(`
      SELECT st.spec_id AS scope_id, t.name, t.kind
      FROM SPEC_TAG st JOIN TAG t ON t.id = st.tag_id
    `).all<TagRow>();

    const structureTagsQ = await env.DB.prepare(`
      SELECT st.structure_id AS scope_id, t.name, t.kind, t.name_lower
      FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
    `).all<TagRow & { name_lower: string }>();

    const specTagsByScope = group(specTagsQ.results ?? [], (r) => r.scope_id);
    const structureTagsByScope = group(structureTagsQ.results ?? [], (r) => r.scope_id);

    const rows = (structuresQ.results ?? []).map((s) => {
      const tags = structureTagsByScope.get(s.id) ?? [];
      const specTags = specTagsByScope.get(s.spec_id) ?? [];
      const sysTagNames = tags.filter((t) => t.kind === 'system').map((t) => t.name_lower);
      return {
        id: s.id,
        spec_id: s.spec_id,
        spec_number: s.spec_number,
        part_number: s.part_number,
        top_level_part_number: s.top_level_part_number,
        is_variant: s.parent_structure_id !== null,
        parent_part_number: s.parent_part_number,
        is_subassembly: sysTagNames.includes('subassembly'),
        current_construction_revision_number: s.current_construction_revision_number,
        current_price_revision_number: s.current_price_revision_number,
        line_item_count: s.line_item_count,
        sell_price: s.sell_price,
        subassembly_cost: s.subassembly_cost,
        spec_tags: specTags.map((t) => t.name),
        general_tags: tags.filter((t) => t.kind === 'general').map((t) => t.name),
        variant_tags: tags.filter((t) => t.kind === 'variant').map((t) => t.name),
        is_archived:     sysTagNames.includes('archived'),
        is_locked:       sysTagNames.includes('locked'),
        is_below_target: sysTagNames.includes('below-target'),
        checkout_holder_name: s.checkout_holder_name,
        checkout_acquired_at: s.checkout_acquired_at,
      };
    });

    return json({ rows });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleTags(env: Env): Promise<Response> {
  try {
    const q = await env.DB.prepare(`
      SELECT name, kind FROM TAG
      WHERE kind IN ('spec', 'general', 'variant')
      ORDER BY kind, name
    `).all<{ name: string; kind: string }>();

    const byKind = group(q.results ?? [], (t) => t.kind);
    return json({
      spec:    (byKind.get('spec')    ?? []).map((t) => t.name),
      general: (byKind.get('general') ?? []).map((t) => t.name),
      variant: (byKind.get('variant') ?? []).map((t) => t.name),
    });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleUsers(env: Env): Promise<Response> {
  try {
    const q = await env.DB.prepare(`
      SELECT id, username, display_name, initials, role, is_admin
      FROM USER
      WHERE username <> '__system__' AND is_active = 1
      ORDER BY role DESC, display_name
    `).all<{ id: string; username: string; display_name: string; initials: string; role: string; is_admin: number }>();
    return json({ users: q.results ?? [] });
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
