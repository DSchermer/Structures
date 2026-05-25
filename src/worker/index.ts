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
      return handleApi(url, request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(url: URL, request: Request, env: Env): Promise<Response> {
  if (url.pathname === '/api/health') return handleHealth(env);
  if (url.pathname === '/api/search') return handleSearch(env);
  if (url.pathname === '/api/tags')   return handleTags(env);
  if (url.pathname === '/api/users')  return handleUsers(env);

  // /api/structures/:id
  const structMatch = url.pathname.match(/^\/api\/structures\/([0-9a-f-]+)$/);
  if (structMatch) return handleStructure(env, structMatch[1]);

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
  name_lower?: string;
}

async function handleSearch(env: Env): Promise<Response> {
  try {
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
    `).all<TagRow>();

    const specTagsByScope = group(specTagsQ.results ?? [], (r) => r.scope_id);
    const structureTagsByScope = group(structureTagsQ.results ?? [], (r) => r.scope_id);

    const rows = (structuresQ.results ?? []).map((s) => {
      const tags = structureTagsByScope.get(s.id) ?? [];
      const specTags = specTagsByScope.get(s.spec_id) ?? [];
      const sysTagNames = tags.filter((t) => t.kind === 'system').map((t) => t.name_lower ?? t.name.toLowerCase());
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

// ----------------------- /api/structures/:id -----------------------

async function handleStructure(env: Env, id: string): Promise<Response> {
  try {
    const structQ = await env.DB.prepare(`
      SELECT
        s.*,
        sp.spec_number, sp.customer_revision AS spec_current_customer_revision,
        sr.customer_revision AS pinned_customer_revision,
        ps.id AS parent_id, ps.part_number AS parent_part_number,
        (sp.spec_number || s.part_number) AS top_level_part_number,
        u.display_name AS created_by_name,
        cl.holder_user_id AS lock_holder_id,
        cl.acquired_at AS lock_acquired_at,
        lu.display_name AS lock_holder_name
      FROM STRUCTURE s
      JOIN SPEC sp ON sp.id = s.spec_id
      JOIN SPEC_REVISION sr ON sr.id = s.spec_revision_id
      LEFT JOIN STRUCTURE ps ON ps.id = s.parent_structure_id
      LEFT JOIN USER u ON u.id = s.created_by_user_id
      LEFT JOIN CHECKOUT_LOCK cl ON cl.structure_id = s.id
      LEFT JOIN USER lu ON lu.id = cl.holder_user_id
      WHERE s.id = ?
    `).bind(id).first<any>();

    if (!structQ) return json({ error: 'Not found' }, 404);

    // Tags on this structure (general, variant, system) + spec tags
    const tagsQ = await env.DB.prepare(`
      SELECT t.id, t.name, t.kind, t.name_lower, st.applied_at,
             u.display_name AS applied_by_name
      FROM STRUCTURE_TAG st
      JOIN TAG t ON t.id = st.tag_id
      LEFT JOIN USER u ON u.id = st.applied_by_user_id
      WHERE st.structure_id = ?
      ORDER BY t.kind, t.name
    `).bind(id).all<{ id: string; name: string; kind: string; name_lower: string; applied_at: string; applied_by_name: string | null }>();

    const specTagsQ = await env.DB.prepare(`
      SELECT t.name FROM SPEC_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.spec_id = ?
      ORDER BY t.name
    `).bind(structQ.spec_id).all<{ name: string }>();

    // Line items + their chosen PRICE_POINT info
    const linesQ = await env.DB.prepare(`
      SELECT
        li.*,
        pp.price AS chosen_price,
        pp.scope AS chosen_price_scope,
        pp.quote_number AS chosen_quote_number,
        sa.part_number AS sub_assembly_part_number,
        sa_sp.spec_number AS sub_assembly_spec_number,
        sa.id AS sub_assembly_id
      FROM LINE_ITEM li
      LEFT JOIN PRICE_POINT pp ON pp.id = li.chosen_price_point_id
      LEFT JOIN STRUCTURE sa ON sa.id = li.sub_assembly_structure_id
      LEFT JOIN SPEC sa_sp ON sa_sp.id = sa.spec_id
      WHERE li.structure_id = ?
      ORDER BY li.sort_order ASC
    `).bind(id).all<any>();

    // Construction revisions + price revisions
    const crsQ = await env.DB.prepare(`
      SELECT cr.id, cr.revision_number, cr.committed_at, cr.notes, cr.change_set,
             u.display_name AS author_name
      FROM CONSTRUCTION_REVISION cr
      LEFT JOIN USER u ON u.id = cr.author_user_id
      WHERE cr.structure_id = ?
      ORDER BY cr.revision_number DESC
    `).bind(id).all<any>();

    const prsQ = await env.DB.prepare(`
      SELECT pr.id, pr.revision_number, pr.committed_at, pr.notes, pr.change_set,
             u.display_name AS author_name
      FROM PRICE_REVISION pr
      LEFT JOIN USER u ON u.id = pr.author_user_id
      WHERE pr.structure_id = ?
      ORDER BY pr.revision_number DESC
    `).bind(id).all<any>();

    // Active structure_sell or subassembly_cost PRICE_POINTs + their tags
    const ppsQ = await env.DB.prepare(`
      SELECT pp.id, pp.price, pp.scope, pp.set_at, pp.derived_from_construction_revision_id, pp.derived_from_price_revision_id,
             u.display_name AS set_by_name
      FROM PRICE_POINT pp
      LEFT JOIN USER u ON u.id = pp.set_by_user_id
      WHERE pp.structure_id = ?
      ORDER BY pp.set_at DESC
    `).bind(id).all<any>();

    const ppTagsQ = await env.DB.prepare(`
      SELECT ppt.price_point_id AS scope_id, t.name, t.kind, t.name_lower
      FROM PRICE_POINT_TAG ppt
      JOIN TAG t ON t.id = ppt.tag_id
      WHERE ppt.price_point_id IN (SELECT id FROM PRICE_POINT WHERE structure_id = ?)
    `).bind(id).all<TagRow>();
    const ppTagsByScope = group(ppTagsQ.results ?? [], (r) => r.scope_id);

    // Sibling variants: base = self if not variant, else parent
    const baseId = structQ.parent_structure_id ?? structQ.id;
    const siblingsQ = await env.DB.prepare(`
      SELECT s.id, s.part_number, (sp.spec_number || s.part_number) AS top_level_part_number
      FROM STRUCTURE s
      JOIN SPEC sp ON sp.id = s.spec_id
      WHERE s.parent_structure_id = ?
      ORDER BY s.part_number
    `).bind(baseId).all<{ id: string; part_number: string; top_level_part_number: string }>();

    const siblingIds = (siblingsQ.results ?? []).map((s) => s.id);
    let siblingTagsByScope = new Map<string, TagRow[]>();
    if (siblingIds.length) {
      const placeholders = siblingIds.map(() => '?').join(',');
      const siblingTagsQ = await env.DB.prepare(`
        SELECT st.structure_id AS scope_id, t.name, t.kind
        FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
        WHERE st.structure_id IN (${placeholders}) AND t.kind = 'variant'
        ORDER BY t.name
      `).bind(...siblingIds).all<TagRow>();
      siblingTagsByScope = group(siblingTagsQ.results ?? [], (r) => r.scope_id);
    }

    // Spec revisions (for "newer rev available" UI)
    const specRevsQ = await env.DB.prepare(`
      SELECT id, customer_revision, recorded_at FROM SPEC_REVISION
      WHERE spec_id = ?
      ORDER BY recorded_at DESC
    `).bind(structQ.spec_id).all<{ id: string; customer_revision: string; recorded_at: string }>();

    const tags = tagsQ.results ?? [];
    const sysTagNames = tags.filter((t) => t.kind === 'system').map((t) => t.name_lower);

    const detail = {
      id: structQ.id,
      spec_id: structQ.spec_id,
      spec_number: structQ.spec_number,
      spec_current_customer_revision: structQ.spec_current_customer_revision,
      pinned_customer_revision: structQ.pinned_customer_revision,
      part_number: structQ.part_number,
      top_level_part_number: structQ.top_level_part_number,
      is_variant: structQ.parent_structure_id !== null,
      parent: structQ.parent_id ? { id: structQ.parent_id, part_number: structQ.parent_part_number } : null,
      is_subassembly: sysTagNames.includes('subassembly'),
      is_archived:     sysTagNames.includes('archived'),
      is_locked:       sysTagNames.includes('locked'),
      is_below_target: sysTagNames.includes('below-target'),
      current_construction_revision_number: structQ.current_construction_revision_number,
      current_price_revision_number: structQ.current_price_revision_number,
      build_hours: structQ.build_hours,
      target_assembly_margin_pct: structQ.target_assembly_margin_pct,
      created_by_name: structQ.created_by_name,
      created_at: structQ.created_at,
      lock: structQ.lock_holder_id ? {
        holder_user_id: structQ.lock_holder_id,
        holder_name: structQ.lock_holder_name,
        acquired_at: structQ.lock_acquired_at,
      } : null,
      build_instructions: [structQ.build_instr_1, structQ.build_instr_2, structQ.build_instr_3, structQ.build_instr_4, structQ.build_instr_5].filter((x) => x),
      work_instructions:  [structQ.work_instr_1, structQ.work_instr_2, structQ.work_instr_3, structQ.work_instr_4, structQ.work_instr_5].filter((x) => x),
      spec_tags: (specTagsQ.results ?? []).map((t) => t.name),
      general_tags: tags.filter((t) => t.kind === 'general').map((t) => ({ name: t.name, applied_by: t.applied_by_name, applied_at: t.applied_at })),
      variant_tags: tags.filter((t) => t.kind === 'variant').map((t) => ({ name: t.name, applied_by: t.applied_by_name, applied_at: t.applied_at })),
      line_items: (linesQ.results ?? []).map((li) => ({
        id: li.id,
        sort_order: li.sort_order,
        component_part_number: li.component_part_number,
        part_description: li.part_description,
        quantity: li.quantity,
        unit_price: li.chosen_price ?? li.price_override,
        chosen_price_scope: li.chosen_price_scope,
        quote_number: li.chosen_quote_number,
        price_override: li.price_override,
        supplier: li.supplier,
        lead_time_days: li.lead_time_days,
        product_code: li.product_code,
        is_commissioned: !!li.is_commissioned,
        commission_cap_pct: li.commission_cap_pct,
        sub_assembly: li.sub_assembly_id ? {
          id: li.sub_assembly_id,
          part_number: li.sub_assembly_part_number,
          top_level_part_number: li.sub_assembly_spec_number + li.sub_assembly_part_number,
        } : null,
      })),
      construction_revisions: (crsQ.results ?? []).map((r) => ({
        id: r.id,
        revision_number: r.revision_number,
        author: r.author_name,
        committed_at: r.committed_at,
        notes: r.notes,
        change_set: parseJson(r.change_set),
      })),
      price_revisions: (prsQ.results ?? []).map((r) => ({
        id: r.id,
        revision_number: r.revision_number,
        author: r.author_name,
        committed_at: r.committed_at,
        notes: r.notes,
        change_set: parseJson(r.change_set),
      })),
      price_points: (ppsQ.results ?? []).map((p) => {
        const tags = ppTagsByScope.get(p.id) ?? [];
        const sys = tags.filter((t) => t.kind === 'system').map((t) => t.name_lower ?? t.name.toLowerCase());
        return {
          id: p.id,
          price: p.price,
          scope: p.scope,
          set_at: p.set_at,
          set_by: p.set_by_name,
          tags: tags.filter((t) => t.kind !== 'system').map((t) => t.name),
          is_superseded: sys.includes('superseded'),
          derived_from_cr: p.derived_from_construction_revision_id,
          derived_from_pr: p.derived_from_price_revision_id,
        };
      }),
      base_id: baseId,
      siblings: (siblingsQ.results ?? []).map((s) => ({
        id: s.id,
        part_number: s.part_number,
        top_level_part_number: s.top_level_part_number,
        variant_tags: (siblingTagsByScope.get(s.id) ?? []).map((t) => t.name),
        is_current: s.id === structQ.id,
      })),
      spec_revisions: specRevsQ.results ?? [],
    };

    return json(detail);
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

function parseJson(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
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
