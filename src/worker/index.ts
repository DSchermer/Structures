// Cloudflare Worker — /api/* router with /api/health, /api/search,
// /api/tags, /api/users, /api/structures/:id (read), /api/components,
// /api/price-points, and the Phase 4 draft endpoints (create / read /
// update / check-in / discard / check-out).

import { backsolve, findCapBreaches, type LineForBacksolve } from '../lib/backsolve';
import { fromE4, toE4, roundToCentE4 } from '../lib/money';

interface D1Result<T> { results?: T[]; }
interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>(col?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<D1Result<T>>;
  run: () => Promise<{ success: boolean }>;
}
interface D1Database {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
}
interface Fetcher { fetch: (request: Request) => Promise<Response>; }
interface Env { DB: D1Database; ASSETS: Fetcher; }

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
  const m = url.pathname.match.bind(url.pathname);

  if (url.pathname === '/api/health') return handleHealth(env);
  if (url.pathname === '/api/search') return handleSearch(env, url);
  if (url.pathname === '/api/tag-ids') return handleTagIds(env);
  if (url.pathname === '/api/users')  return handleUsers(env);
  if (url.pathname === '/api/components')  return handleComponents(env, url);
  if (url.pathname === '/api/price-points') {
    if (request.method === 'POST') return handleCreateComponentCostPp(env, request);
    return handlePricePoints(env, url);
  }

  let pm: RegExpMatchArray | null;
  if ((pm = m(/^\/api\/price-points\/([0-9a-fA-F-]+)\/toggle-superseded$/)) && request.method === 'POST') {
    return handleTogglePpSuperseded(env, pm[1], request);
  }

  if (url.pathname === '/api/specs') {
    if (request.method === 'POST') return handleCreateSpec(env, request);
    return handleSpecs(env);
  }
  if (url.pathname === '/api/structures' && request.method === 'POST') {
    return handleCreateStructure(env, request);
  }
  if (url.pathname === '/api/inbox') return handleInbox(env, url);

  let am: RegExpMatchArray | null;
  if ((am = m(/^\/api\/assignments\/([0-9a-fA-F-]+)$/)))                           return handleAssignment(env, am[1]);
  if ((am = m(/^\/api\/assignments\/([0-9a-fA-F-]+)\/acknowledge$/)) && request.method === 'POST') {
    return handleAcknowledge(env, am[1], request);
  }

  let mm: RegExpMatchArray | null;
  if ((mm = m(/^\/api\/structures\/([0-9a-fA-F-]+)$/)))                       return handleStructure(env, mm[1], url.searchParams.get('at_cr'));
  if ((mm = m(/^\/api\/structures\/([0-9a-fA-F-]+)\/checkout$/)) && request.method === 'POST') {
    return handleCheckout(env, mm[1], request);
  }
  if ((mm = m(/^\/api\/drafts\/([0-9a-fA-F-]+)$/))) {
    if (request.method === 'GET')   return handleGetDraft(env, mm[1]);
    if (request.method === 'PATCH') return handlePatchDraft(env, mm[1], request);
  }
  if ((mm = m(/^\/api\/drafts\/([0-9a-fA-F-]+)\/checkin$/)) && request.method === 'POST') {
    return handleCheckin(env, mm[1], request);
  }
  if ((mm = m(/^\/api\/drafts\/([0-9a-fA-F-]+)\/discard$/)) && request.method === 'POST') {
    return handleDiscard(env, mm[1], request);
  }

  return json({ error: 'Not found', path: url.pathname, method: request.method }, 404);
}

// =============================================================
// Read endpoints
// =============================================================

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
    return json({ ok: true, d1_rows: row?.row_count ?? 0, checked_at: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: msg(err) }, 500);
  }
}

interface SearchRow {
  id: string;
  spec_id: string;
  spec_number: string;
  part_number: string;
  description: string | null;
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
interface TagRow { scope_id: string; name: string; kind: string; name_lower?: string; }

async function handleSearch(env: Env, url: URL): Promise<Response> {
  try {
    // §5.1: CR-0 (never-committed) drafts are hidden from everyone except
    // the lock holder. If user_id is supplied, include their own CR-0 drafts.
    const userId = url.searchParams.get('user_id') ?? '';
    const structuresQ = await env.DB.prepare(`
      SELECT
        s.id, s.spec_id, sp.spec_number, s.part_number, s.description,
        (sp.spec_number || s.part_number) AS top_level_part_number,
        s.parent_structure_id,
        ps.part_number AS parent_part_number,
        s.current_construction_revision_number,
        s.current_price_revision_number,
        (SELECT COUNT(*) FROM LINE_ITEM WHERE structure_id = s.id) AS line_item_count,
        (SELECT COALESCE(pp.price_e4 / 10000.0, pp.price) FROM PRICE_POINT pp
         WHERE pp.structure_id = s.id AND pp.scope = 'structure_sell'
         ORDER BY pp.set_at DESC LIMIT 1) AS sell_price,
        (SELECT COALESCE(pp.price_e4 / 10000.0, pp.price) FROM PRICE_POINT pp
         WHERE pp.structure_id = s.id AND pp.scope = 'subassembly_cost'
         ORDER BY pp.set_at DESC LIMIT 1) AS subassembly_cost,
        u.display_name AS checkout_holder_name,
        cl.holder_user_id AS checkout_holder_id,
        cl.acquired_at AS checkout_acquired_at
      FROM STRUCTURE s
      JOIN SPEC sp ON sp.id = s.spec_id
      LEFT JOIN STRUCTURE ps ON ps.id = s.parent_structure_id
      LEFT JOIN CHECKOUT_LOCK cl ON cl.structure_id = s.id
      LEFT JOIN USER u ON u.id = cl.holder_user_id
      WHERE s.current_construction_revision_number > 0
         OR (s.current_construction_revision_number = 0 AND cl.holder_user_id = ?)
      ORDER BY sp.spec_number, (s.parent_structure_id IS NOT NULL), s.part_number
    `).bind(userId).all<SearchRow & { checkout_holder_id: string | null }>();

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
      const sys = tags.filter((t) => t.kind === 'system').map((t) => (t.name_lower ?? t.name).toLowerCase());
      return {
        id: s.id,
        spec_id: s.spec_id,
        spec_number: s.spec_number,
        part_number: s.part_number,
        description: s.description,
        top_level_part_number: s.top_level_part_number,
        is_variant: s.parent_structure_id !== null,
        parent_part_number: s.parent_part_number,
        is_subassembly: sys.includes('subassembly'),
        current_construction_revision_number: s.current_construction_revision_number,
        current_price_revision_number: s.current_price_revision_number,
        line_item_count: s.line_item_count,
        sell_price: s.sell_price,
        subassembly_cost: s.subassembly_cost,
        spec_tags: specTags.map((t) => t.name),
        general_tags: tags.filter((t) => t.kind === 'general').map((t) => t.name),
        variant_tags: tags.filter((t) => t.kind === 'variant').map((t) => t.name),
        is_archived:     sys.includes('archived'),
        is_locked:       sys.includes('locked'),
        is_below_target: sys.includes('below-target'),
        checkout_holder_name: s.checkout_holder_name,
        checkout_holder_id:   s.checkout_holder_id,
        checkout_acquired_at: s.checkout_acquired_at,
        is_uncommitted_draft: s.current_construction_revision_number === 0,
      };
    });

    return json({ rows });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleTagIds(env: Env): Promise<Response> {
  try {
    const q = await env.DB.prepare(`
      SELECT id, name, kind FROM TAG
      WHERE kind IN ('spec', 'general', 'variant', 'sell', 'cost')
      ORDER BY kind, name
    `).all<{ id: string; name: string; kind: string }>();
    return json({ tags: q.results ?? [] });
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

async function handleComponents(env: Env, url: URL): Promise<Response> {
  try {
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    // COMPONENT is the canonical catalog; the price library only tells us what
    // has been quoted, which is a subset.
    const result = await env.DB.prepare(`
      SELECT c.component_part_number AS name, c.description,
             c.default_supplier, c.default_product_code, c.default_lead_time_days,
             (SELECT COUNT(*) FROM PRICE_POINT pp
               WHERE pp.scope = 'component_cost'
                 AND pp.component_part_number = c.component_part_number) AS price_point_count
      FROM COMPONENT c
      ORDER BY c.component_part_number
    `).all<any>();
    let rows = result.results ?? [];
    if (q) {
      rows = rows.filter((r) =>
        String(r.name).toLowerCase().startsWith(q) ||
        String(r.description ?? '').toLowerCase().includes(q));
    }
    return json({ components: rows });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handlePricePoints(env: Env, url: URL): Promise<Response> {
  try {
    const component = url.searchParams.get('component');
    if (component) {
      // BOM-picker mode: filter to one component
      const q = await env.DB.prepare(`
        SELECT pp.id, COALESCE(pp.price_e4 / 10000.0, pp.price) AS price, pp.quote_number, pp.set_at,
               u.display_name AS set_by,
               GROUP_CONCAT(t.name, ',') AS tag_csv
        FROM PRICE_POINT pp
        LEFT JOIN USER u ON u.id = pp.set_by_user_id
        LEFT JOIN PRICE_POINT_TAG ppt ON ppt.price_point_id = pp.id
        LEFT JOIN TAG t ON t.id = ppt.tag_id
        WHERE pp.scope = 'component_cost' AND pp.component_part_number = ?
        GROUP BY pp.id
        ORDER BY pp.set_at DESC
      `).bind(component).all<any>();
      const points = (q.results ?? []).map((p) => ({
        id: p.id, price: p.price, quote_number: p.quote_number, set_at: p.set_at, set_by: p.set_by,
        tags: (p.tag_csv ? String(p.tag_csv).split(',').filter(Boolean) : []),
        is_superseded: (p.tag_csv ?? '').toLowerCase().includes('superseded'),
      }));
      const comp = await env.DB.prepare(`SELECT description, default_supplier, default_product_code, default_lead_time_days FROM COMPONENT WHERE component_part_number = ?`).bind(component).first<any>();
      return json({ price_points: points, component: comp ?? null });
    }
    // Library mode: every PP with scope + tag info + linked structure
    const ppsQ = await env.DB.prepare(`
      SELECT pp.id, pp.scope, COALESCE(pp.price_e4 / 10000.0, pp.price) AS price, pp.quote_number, pp.set_at,
             pp.component_part_number, pp.target_assembly_margin_pct,
             c.description AS component_description,
             u.display_name AS set_by,
             s.id AS structure_id,
             (sp.spec_number || s.part_number) AS structure_top_level_part_number
      FROM PRICE_POINT pp
      LEFT JOIN USER u ON u.id = pp.set_by_user_id
      LEFT JOIN STRUCTURE s ON s.id = pp.structure_id
      LEFT JOIN SPEC sp ON sp.id = s.spec_id
      LEFT JOIN COMPONENT c ON c.component_part_number = pp.component_part_number
      ORDER BY pp.set_at DESC, pp.id DESC
    `).all<any>();
    const tagsQ = await env.DB.prepare(`
      SELECT ppt.price_point_id AS scope_id, t.name, t.kind, t.name_lower
      FROM PRICE_POINT_TAG ppt JOIN TAG t ON t.id = ppt.tag_id
    `).all<TagRow>();
    const tagsByScope = group(tagsQ.results ?? [], (r) => r.scope_id);
    const library = (ppsQ.results ?? []).map((p) => {
      const tags = tagsByScope.get(p.id) ?? [];
      const sys = tags.filter((t) => t.kind === 'system').map((t) => (t.name_lower ?? t.name).toLowerCase());
      return {
        id: p.id,
        scope: p.scope,
        price: p.price,
        quote_number: p.quote_number,
        set_at: p.set_at,
        set_by: p.set_by,
        component_part_number: p.component_part_number,
        component_description: p.component_description,
        structure: p.structure_id ? { id: p.structure_id, top_level_part_number: p.structure_top_level_part_number } : null,
        tags: tags.filter((t) => t.kind !== 'system').map((t) => ({ name: t.name, kind: t.kind })),
        is_superseded: sys.includes('superseded'),
        target_assembly_margin_pct: p.target_assembly_margin_pct,
      };
    });
    return json({ price_points: library });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

interface CreateComponentCostBody {
  current_user_id: string;
  component_part_number: string;
  price: number;
  quote_number: string;
  tag_names?: string[];
  // Canonical component fields. Required when the component is new to the
  // catalog; optional (and updates the record) when it already exists.
  description?: string | null;
  default_supplier?: string | null;
  default_product_code?: string | null;
  default_lead_time_days?: number | null;
}

async function handleCreateComponentCostPp(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as CreateComponentCostBody;
    const component = (body.component_part_number ?? '').trim();
    const quote = (body.quote_number ?? '').trim();
    if (!body.current_user_id) return json({ error: 'current_user_id required' }, 400);
    if (!component)             return json({ error: 'component_part_number required' }, 400);
    if (component.startsWith(' ') || component.endsWith(' ')) return json({ error: 'component_part_number cannot have leading or trailing whitespace' }, 400);
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) return json({ error: 'price must be a non-negative number' }, 400);
    if (!quote)                 return json({ error: 'quote_number required for component_cost PRICE_POINTs' }, 400);

    // A quote must resolve to a known component. If this part is new to the
    // catalog we need a description up front — otherwise the price library
    // gains a row nobody can identify, which is the problem COMPONENT exists
    // to prevent.
    const existingComp = await env.DB.prepare(
      `SELECT component_part_number, description FROM COMPONENT WHERE component_part_number = ?`
    ).bind(component).first<{ component_part_number: string; description: string }>();
    const suppliedDesc = (body.description ?? '').trim();
    if (!existingComp && !suppliedDesc) {
      return json({
        error: `${component} is not in the component catalog yet. Provide a description so the price library can identify it.`,
        needs_component: true,
      }, 422);
    }

    // Quotes arrive as decimal units; convert once, exactly, at the boundary.
    const priceE4 = toE4(body.price);
    const ppId = uuid();
    const now = isoNow();
    const stmts: D1PreparedStatement[] = [];

    if (!existingComp) {
      stmts.push(env.DB.prepare(`
        INSERT INTO COMPONENT
          (component_part_number, description, default_supplier, default_product_code,
           default_lead_time_days, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(component, suppliedDesc, (body.default_supplier ?? '').trim() || null,
              (body.default_product_code ?? '').trim() || null,
              body.default_lead_time_days ?? null, body.current_user_id, now));
    } else if (suppliedDesc && suppliedDesc !== existingComp.description) {
      // Engineer corrected the description while recording a quote.
      stmts.push(env.DB.prepare(
        `UPDATE COMPONENT SET description = ?, updated_at = ? WHERE component_part_number = ?`
      ).bind(suppliedDesc, now, component));
    }

    stmts.push(env.DB.prepare(`
      INSERT INTO PRICE_POINT
        (id, component_part_number, structure_id, scope, price, price_e4, quote_number,
         derived_from_construction_revision_id, derived_from_price_revision_id,
         target_assembly_margin_pct, set_by_user_id, set_at)
      VALUES (?, ?, NULL, 'component_cost', ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).bind(ppId, component, fromE4(priceE4), priceE4, quote, body.current_user_id, now));

    // Tags: get-or-create with kind='cost' (engineers create cost tags freely per §5.2)
    const tagNames = (body.tag_names ?? []).map((n) => n?.trim()).filter((n): n is string => !!n);
    for (const name of tagNames) {
      const lower = name.toLowerCase();
      const existing = await env.DB.prepare(`SELECT id FROM TAG WHERE name_lower = ? AND kind = 'cost'`).bind(lower).first<{ id: string }>();
      let tagId: string;
      if (existing) {
        tagId = existing.id;
      } else {
        tagId = uuid();
        stmts.push(env.DB.prepare(`INSERT INTO TAG (id, name, name_lower, kind) VALUES (?, ?, ?, 'cost')`).bind(tagId, name, lower));
      }
      stmts.push(env.DB.prepare(`INSERT INTO PRICE_POINT_TAG (price_point_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, ?, ?)`).bind(ppId, tagId, body.current_user_id, now));
    }

    await env.DB.batch(stmts);
    return json({ id: ppId });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleTogglePpSuperseded(env: Env, ppId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { current_user_id: string };
    const SUPERSEDED_TAG_ID = '10000000-0000-0000-0000-000000000005';
    const existing = await env.DB.prepare(`SELECT 1 FROM PRICE_POINT_TAG WHERE price_point_id = ? AND tag_id = ?`).bind(ppId, SUPERSEDED_TAG_ID).first();
    if (existing) {
      await env.DB.prepare(`DELETE FROM PRICE_POINT_TAG WHERE price_point_id = ? AND tag_id = ?`).bind(ppId, SUPERSEDED_TAG_ID).run();
      return json({ ok: true, is_superseded: false });
    }
    await env.DB.prepare(`INSERT INTO PRICE_POINT_TAG (price_point_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, ?, ?)`).bind(ppId, SUPERSEDED_TAG_ID, body.current_user_id, isoNow()).run();
    return json({ ok: true, is_superseded: true });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

// =============================================================
// /api/structures/:id (full detail; used by detail page + draft loader)
// =============================================================

async function handleStructure(env: Env, id: string, atCrId: string | null): Promise<Response> {
  try {
    const data = await loadStructureDetail(env, id);
    if (!data) return json({ error: 'Not found' }, 404);
    if (atCrId) {
      const snap = await env.DB.prepare(`SELECT snapshot_json, taken_at FROM CONSTRUCTION_REVISION_SNAPSHOT WHERE construction_revision_id = ?`).bind(atCrId).first<{ snapshot_json: string; taken_at: string }>();
      const cr   = data.construction_revisions.find((r: any) => r.id === atCrId);
      if (snap && cr) {
        return json(overlaySnapshot(data, atCrId, cr.revision_number, JSON.parse(snap.snapshot_json), snap.taken_at));
      }
      // Snapshot missing → return current with a flag so the UI can show the banner anyway
      return json({ ...data, viewing_at: { cr_id: atCrId, revision_number: cr?.revision_number ?? null, snapshot_available: false } });
    }
    return json(data);
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

function overlaySnapshot(data: any, crId: string, revisionNumber: number, snapshot: any, takenAt: string): any {
  const sf = snapshot.structure_fields ?? {};
  const liveById = new Map<string, any>((data.line_items ?? []).map((li: any): [string, any] => [li.id, li]));
  const snapshotLines = (snapshot.line_items ?? []).map((s: any) => {
    const live: any = liveById.get(s.id);
    return {
      id: s.id,
      sort_order: s.sort_order,
      component_part_number: s.component_part_number,
      part_description: s.part_description,
      quantity: s.quantity,
      unit_price: s.unit_price,
      chosen_price_scope: live?.chosen_price_scope ?? null,
      quote_number: live?.quote_number ?? null,
      price_override: s.price_override,
      supplier: s.supplier,
      lead_time_days: s.lead_time_days,
      product_code: s.product_code,
      is_commissioned: !!s.is_commissioned,
      commission_cap_pct: s.commission_cap_pct,
      sub_assembly: live?.sub_assembly ?? null,
    };
  });
  return {
    ...data,
    part_number: sf.part_number ?? data.part_number,
    description: sf.description ?? data.description,
    top_level_part_number: (data.spec_number ?? '') + (sf.part_number ?? data.part_number),
    build_hours: sf.build_hours ?? data.build_hours,
    target_assembly_margin_pct: sf.target_assembly_margin_pct ?? data.target_assembly_margin_pct,
    build_instructions: [sf.build_instr_1, sf.build_instr_2, sf.build_instr_3, sf.build_instr_4, sf.build_instr_5].filter((x: string | null) => x),
    work_instructions:  [sf.work_instr_1,  sf.work_instr_2,  sf.work_instr_3,  sf.work_instr_4,  sf.work_instr_5].filter((x: string | null) => x),
    line_items: snapshotLines,
    general_tags: (snapshot.tags ?? []).filter((t: any) => t.kind === 'general').map((t: any) => ({ name: t.name, applied_by: null, applied_at: null })),
    variant_tags: (snapshot.tags ?? []).filter((t: any) => t.kind === 'variant').map((t: any) => ({ name: t.name, applied_by: null, applied_at: null })),
    viewing_at: { cr_id: crId, revision_number: revisionNumber, snapshot_available: true, snapshot_taken_at: takenAt },
  };
}

async function loadStructureDetail(env: Env, id: string): Promise<any | null> {
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
  if (!structQ) return null;

  const tagsQ = await env.DB.prepare(`
    SELECT t.id, t.name, t.kind, t.name_lower, st.applied_at,
           u.display_name AS applied_by_name
    FROM STRUCTURE_TAG st
    JOIN TAG t ON t.id = st.tag_id
    LEFT JOIN USER u ON u.id = st.applied_by_user_id
    WHERE st.structure_id = ?
    ORDER BY t.kind, t.name
  `).bind(id).all<any>();

  const specTagsQ = await env.DB.prepare(`
    SELECT t.name FROM SPEC_TAG st JOIN TAG t ON t.id = st.tag_id
    WHERE st.spec_id = ? ORDER BY t.name
  `).bind(structQ.spec_id).all<{ name: string }>();

  const linesQ = await env.DB.prepare(`
    SELECT li.*, COALESCE(pp.price_e4 / 10000.0, pp.price) AS chosen_price, pp.scope AS chosen_price_scope,
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

  const crsQ = await env.DB.prepare(`
    SELECT cr.id, cr.revision_number, cr.committed_at, cr.notes, cr.change_set,
           u.display_name AS author_name
    FROM CONSTRUCTION_REVISION cr LEFT JOIN USER u ON u.id = cr.author_user_id
    WHERE cr.structure_id = ?
    ORDER BY cr.revision_number DESC
  `).bind(id).all<any>();

  const prsQ = await env.DB.prepare(`
    SELECT pr.id, pr.revision_number, pr.committed_at, pr.notes, pr.change_set,
           u.display_name AS author_name
    FROM PRICE_REVISION pr LEFT JOIN USER u ON u.id = pr.author_user_id
    WHERE pr.structure_id = ?
    ORDER BY pr.revision_number DESC
  `).bind(id).all<any>();

  const ppsQ = await env.DB.prepare(`
    SELECT pp.id, COALESCE(pp.price_e4 / 10000.0, pp.price) AS price, pp.scope, pp.set_at, pp.derived_from_construction_revision_id, pp.derived_from_price_revision_id,
           pp.target_assembly_margin_pct,
           u.display_name AS set_by_name
    FROM PRICE_POINT pp
    LEFT JOIN USER u ON u.id = pp.set_by_user_id
    WHERE pp.structure_id = ?
    ORDER BY pp.set_at DESC
  `).bind(id).all<any>();

  const ppTagsQ = await env.DB.prepare(`
    SELECT ppt.price_point_id AS scope_id, t.name, t.kind, t.name_lower
    FROM PRICE_POINT_TAG ppt JOIN TAG t ON t.id = ppt.tag_id
    WHERE ppt.price_point_id IN (SELECT id FROM PRICE_POINT WHERE structure_id = ?)
  `).bind(id).all<TagRow>();
  const ppTagsByScope = group(ppTagsQ.results ?? [], (r) => r.scope_id);

  const baseId = structQ.parent_structure_id ?? structQ.id;
  const siblingsQ = await env.DB.prepare(`
    SELECT s.id, s.part_number, (sp.spec_number || s.part_number) AS top_level_part_number
    FROM STRUCTURE s JOIN SPEC sp ON sp.id = s.spec_id
    WHERE s.parent_structure_id = ? AND s.current_construction_revision_number > 0
    ORDER BY s.part_number
  `).bind(baseId).all<any>();

  const siblingIds = (siblingsQ.results ?? []).map((s: any) => s.id as string);
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

  const specRevsQ = await env.DB.prepare(`
    SELECT id, customer_revision, recorded_at FROM SPEC_REVISION
    WHERE spec_id = ? ORDER BY recorded_at DESC
  `).bind(structQ.spec_id).all<any>();

  const tags = tagsQ.results ?? [];
  const sysTagNames = tags.filter((t: any) => t.kind === 'system').map((t: any) => t.name_lower);

  return {
    id: structQ.id,
    spec_id: structQ.spec_id,
    spec_number: structQ.spec_number,
    spec_current_customer_revision: structQ.spec_current_customer_revision,
    pinned_customer_revision: structQ.pinned_customer_revision,
    part_number: structQ.part_number,
    description: structQ.description,
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
    build_instructions: [structQ.build_instr_1, structQ.build_instr_2, structQ.build_instr_3, structQ.build_instr_4, structQ.build_instr_5].filter((x: string | null) => x),
    work_instructions:  [structQ.work_instr_1, structQ.work_instr_2, structQ.work_instr_3, structQ.work_instr_4, structQ.work_instr_5].filter((x: string | null) => x),
    spec_tags: (specTagsQ.results ?? []).map((t) => t.name),
    general_tags: tags.filter((t: any) => t.kind === 'general').map((t: any) => ({ name: t.name, applied_by: t.applied_by_name, applied_at: t.applied_at })),
    variant_tags: tags.filter((t: any) => t.kind === 'variant').map((t: any) => ({ name: t.name, applied_by: t.applied_by_name, applied_at: t.applied_at })),
    line_items: (linesQ.results ?? []).map((li: any) => ({
      id: li.id, sort_order: li.sort_order,
      component_part_number: li.component_part_number, part_description: li.part_description,
      quantity: li.quantity,
      unit_price: li.chosen_price ?? li.price_override,
      chosen_price_scope: li.chosen_price_scope, quote_number: li.chosen_quote_number,
      price_override: li.price_override,
      supplier: li.supplier, lead_time_days: li.lead_time_days, product_code: li.product_code,
      is_commissioned: !!li.is_commissioned, commission_cap_pct: li.commission_cap_pct,
      sub_assembly: li.sub_assembly_id ? {
        id: li.sub_assembly_id, part_number: li.sub_assembly_part_number,
        top_level_part_number: li.sub_assembly_spec_number + li.sub_assembly_part_number,
      } : null,
    })),
    construction_revisions: (crsQ.results ?? []).map((r: any) => ({
      id: r.id, revision_number: r.revision_number, author: r.author_name,
      committed_at: r.committed_at, notes: r.notes, change_set: parseJson(r.change_set),
    })),
    price_revisions: (prsQ.results ?? []).map((r: any) => ({
      id: r.id, revision_number: r.revision_number, author: r.author_name,
      committed_at: r.committed_at, notes: r.notes, change_set: parseJson(r.change_set),
    })),
    price_points: (ppsQ.results ?? []).map((p: any) => {
      const tags = ppTagsByScope.get(p.id) ?? [];
      const sys = tags.filter((t) => t.kind === 'system').map((t) => (t.name_lower ?? t.name).toLowerCase());
      return {
        id: p.id, price: p.price, scope: p.scope, set_at: p.set_at, set_by: p.set_by_name,
        tags: tags.filter((t) => t.kind !== 'system').map((t) => t.name),
        is_superseded: sys.includes('superseded'),
        derived_from_cr: p.derived_from_construction_revision_id,
        derived_from_pr: p.derived_from_price_revision_id,
        target_assembly_margin_pct: p.target_assembly_margin_pct,
      };
    }),
    base_id: baseId,
    siblings: (siblingsQ.results ?? []).map((s: any) => ({
      id: s.id, part_number: s.part_number, top_level_part_number: s.top_level_part_number,
      variant_tags: (siblingTagsByScope.get(s.id) ?? []).map((t) => t.name),
      is_current: s.id === structQ.id,
    })),
    spec_revisions: specRevsQ.results ?? [],
  };
}

// =============================================================
// Draft creation / read / update / discard / checkin
// =============================================================

interface CreateStructureBody {
  spec_id: string;             // which spec this lives under
  parent_structure_id?: string; // non-null = variant
  part_number: string;         // engineer-entered (e.g. 'P002' or 'P001-ARC')
  description?: string | null; // short one-line title; cloned from source for variants
  base_from_structure_id?: string; // clone BOM + general tags from this structure
  // Preferred variant entry point: the structure the engineer picked as the
  // source. May be a base part OR another variant (sibling-spawn) — the server
  // resolves parent_structure_id to a BASE part either way.
  variant_source_structure_id?: string;
  current_user_id: string;     // who's holding the lock
}

// GET /api/specs — the spec picker on the "new part under an existing spec" and
// "new variant" paths. Counts only committed structures; CR-0 drafts are private.
async function handleSpecs(env: Env): Promise<Response> {
  try {
    const q = await env.DB.prepare(`
      SELECT sp.id, sp.spec_number, sp.customer_revision,
             (SELECT COUNT(*) FROM STRUCTURE s
               WHERE s.spec_id = sp.id AND s.current_construction_revision_number > 0) AS structure_count
      FROM SPEC sp
      ORDER BY sp.spec_number
    `).all<{ id: string; spec_number: string; customer_revision: string; structure_count: number }>();
    return json({ specs: q.results ?? [] });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

interface CreateSpecBody {
  spec_number: string;
  customer_revision: string;
  part_number: string;
  description?: string | null;
  current_user_id: string;
}

// POST /api/specs — the New Spec creation flow (§5.4). The only path that
// introduces a SPEC row. Atomic: SPEC + initial SPEC_REVISION + placeholder
// STRUCTURE (CR 0 / PR 0) + DRAFT_STRUCTURE + CHECKOUT_LOCK, or nothing.
async function handleCreateSpec(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as CreateSpecBody;
    const specNumber = (body.spec_number ?? '').trim();
    const custRev    = (body.customer_revision ?? '').trim();
    const partNumber = (body.part_number ?? '').trim();

    if (!body.current_user_id) return json({ error: 'current_user_id required' }, 400);
    if (!specNumber)           return json({ error: 'spec_number required' }, 400);
    if (!custRev)              return json({ error: 'customer_revision required' }, 400);
    if (partNumber.length < 1 || partNumber.length > 25) {
      return json({ error: 'part_number must be 1-25 characters' }, 400);
    }

    const dup = await env.DB.prepare(`SELECT id FROM SPEC WHERE spec_number = ?`).bind(specNumber).first<{ id: string }>();
    if (dup) {
      return json({
        error: `Spec ${specNumber} already exists. Use "New part under an existing spec" instead.`,
        existing_spec_id: dup.id,
      }, 409);
    }

    const specId = uuid();
    const srId = uuid();
    const structId = uuid();
    const now = isoNow();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO SPEC (id, spec_number, customer_revision, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(specId, specNumber, custRev, body.current_user_id, now),
      env.DB.prepare(`
        INSERT INTO SPEC_REVISION (id, spec_id, customer_revision, author_user_id, recorded_at, notes, change_set)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(srId, specId, custRev, body.current_user_id, now, 'Initial spec revision',
              JSON.stringify({ spec_created: true, customer_revision: { old: null, new: custRev } })),
      env.DB.prepare(`
        INSERT INTO STRUCTURE
          (id, part_number, description, spec_id, spec_revision_id, parent_structure_id,
           current_construction_revision_number, current_price_revision_number,
           created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, 0, 0, ?, ?)
      `).bind(structId, partNumber, (body.description ?? '').trim() || null, specId, srId, body.current_user_id, now),
      env.DB.prepare(`
        INSERT INTO DRAFT_STRUCTURE
          (structure_id, editor_user_id, part_number, description, spec_id, spec_revision_id,
           parent_structure_id, draft_started_at, last_edited_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).bind(structId, body.current_user_id, partNumber, (body.description ?? '').trim() || null, specId, srId, now, now),
      env.DB.prepare(`INSERT INTO CHECKOUT_LOCK (structure_id, holder_user_id, acquired_at) VALUES (?, ?, ?)`)
        .bind(structId, body.current_user_id, now),
    ]);

    return json({ id: structId, spec_id: specId });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleCreateStructure(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as CreateStructureBody;
    if (!body.spec_id || !body.part_number || !body.current_user_id) {
      return json({ error: 'spec_id, part_number, and current_user_id required' }, 400);
    }
    const partNumber = body.part_number.trim();
    if (partNumber.length < 1 || partNumber.length > 25) {
      return json({ error: 'part_number must be 1-25 characters' }, 400);
    }

    // Uniqueness check — also flag CR-0 drafts (invisible to non-holders)
    const dup = await env.DB.prepare(`
      SELECT s.id, s.current_construction_revision_number AS cr, cl.holder_user_id, u.display_name AS holder_name
      FROM STRUCTURE s
      LEFT JOIN CHECKOUT_LOCK cl ON cl.structure_id = s.id
      LEFT JOIN USER u ON u.id = cl.holder_user_id
      WHERE s.spec_id = ? AND s.part_number = ?
    `).bind(body.spec_id, partNumber).first<{ id: string; cr: number; holder_user_id: string | null; holder_name: string | null }>();
    if (dup) {
      if (dup.cr === 0 && dup.holder_user_id) {
        const yours = dup.holder_user_id === body.current_user_id;
        const msg = yours
          ? `You already have an in-progress draft named ${partNumber} under this spec. Resume it from the search results.`
          : `${partNumber} is currently being drafted by ${dup.holder_name}. Coordinate with them or pick a different name.`;
        return json({ error: msg, existing_id: dup.id }, 409);
      }
      return json({ error: `Part number ${partNumber} already exists under this spec.`, existing_id: dup.id }, 409);
    }

    // Resolve spec_revision_id (most recent)
    const sr = await env.DB.prepare(`SELECT id FROM SPEC_REVISION WHERE spec_id = ? ORDER BY recorded_at DESC LIMIT 1`).bind(body.spec_id).first<{ id: string }>();
    if (!sr) return json({ error: 'Spec has no SPEC_REVISION rows' }, 500);

    // Variant source resolution (§5.4). The engineer may pick a base part or
    // another variant as the source. Sibling-spawn resolves the new structure's
    // parent to the SOURCE'S BASE — never the source itself — so variant depth
    // stays capped at 1 by construction, while the clone still comes from the
    // source the engineer actually chose.
    let parentId    = body.parent_structure_id ?? null;
    let cloneFromId = body.base_from_structure_id ?? null;
    if (body.variant_source_structure_id) {
      const src = await env.DB.prepare(`
        SELECT id, parent_structure_id, current_construction_revision_number AS cr
        FROM STRUCTURE WHERE id = ?
      `).bind(body.variant_source_structure_id).first<{ id: string; parent_structure_id: string | null; cr: number }>();
      if (!src) return json({ error: 'variant_source_structure_id does not exist' }, 400);
      // The source must be committed. Cloning reads the LIVE tables, so a CR-0
      // source (whose content still lives in DRAFT_*) would silently produce an
      // empty BOM rather than a copy.
      if (src.cr < 1) {
        return json({ error: 'Variant source must be checked in at least once — you cannot spawn a variant from an uncommitted draft.' }, 409);
      }
      parentId    = src.parent_structure_id ?? src.id;
      cloneFromId = src.id;
    }

    // Variant-of validation: parent must exist + be a base part
    if (parentId) {
      const p = await env.DB.prepare(`SELECT id, parent_structure_id FROM STRUCTURE WHERE id = ?`).bind(parentId).first<{ id: string; parent_structure_id: string | null }>();
      if (!p) return json({ error: 'parent_structure_id does not exist' }, 400);
      if (p.parent_structure_id) return json({ error: 'Cannot create a variant of a variant (depth = 1)' }, 400);
      if (!cloneFromId) cloneFromId = parentId;
    }

    // Pull source structure (if cloning)
    let source: any | null = null;
    if (cloneFromId) {
      source = await env.DB.prepare(`SELECT * FROM STRUCTURE WHERE id = ?`).bind(cloneFromId).first<any>();
    }

    const newId = uuid();
    const now = isoNow();

    const stmts: D1PreparedStatement[] = [];

    stmts.push(env.DB.prepare(`
      INSERT INTO STRUCTURE
        (id, part_number, description, spec_id, spec_revision_id, parent_structure_id,
         current_construction_revision_number, current_price_revision_number,
         build_hours, target_assembly_margin_pct,
         build_instr_1, build_instr_2, build_instr_3, build_instr_4, build_instr_5,
         work_instr_1, work_instr_2, work_instr_3, work_instr_4, work_instr_5,
         created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId, partNumber, (body.description ?? '').trim() || source?.description || null, body.spec_id, sr.id, parentId,
      source?.build_hours ?? null,
      source?.target_assembly_margin_pct ?? null,
      source?.build_instr_1 ?? null, source?.build_instr_2 ?? null, source?.build_instr_3 ?? null, source?.build_instr_4 ?? null, source?.build_instr_5 ?? null,
      source?.work_instr_1 ?? null, source?.work_instr_2 ?? null, source?.work_instr_3 ?? null, source?.work_instr_4 ?? null, source?.work_instr_5 ?? null,
      body.current_user_id, now
    ));

    // DRAFT_STRUCTURE mirror
    stmts.push(env.DB.prepare(`
      INSERT INTO DRAFT_STRUCTURE
        (structure_id, editor_user_id, part_number, description, spec_id, spec_revision_id, parent_structure_id,
         build_hours, target_assembly_margin_pct,
         build_instr_1, build_instr_2, build_instr_3, build_instr_4, build_instr_5,
         work_instr_1, work_instr_2, work_instr_3, work_instr_4, work_instr_5,
         draft_started_at, last_edited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId, body.current_user_id, partNumber, (body.description ?? '').trim() || source?.description || null, body.spec_id, sr.id, parentId,
      source?.build_hours ?? null, source?.target_assembly_margin_pct ?? null,
      source?.build_instr_1 ?? null, source?.build_instr_2 ?? null, source?.build_instr_3 ?? null, source?.build_instr_4 ?? null, source?.build_instr_5 ?? null,
      source?.work_instr_1 ?? null, source?.work_instr_2 ?? null, source?.work_instr_3 ?? null, source?.work_instr_4 ?? null, source?.work_instr_5 ?? null,
      now, now
    ));

    stmts.push(env.DB.prepare(`INSERT INTO CHECKOUT_LOCK (structure_id, holder_user_id, acquired_at) VALUES (?, ?, ?)`).bind(newId, body.current_user_id, now));

    // Clone LINE_ITEMs → DRAFT_LINE_ITEMs (if cloning)
    if (cloneFromId) {
      const lines = await env.DB.prepare(`SELECT * FROM LINE_ITEM WHERE structure_id = ? ORDER BY sort_order`).bind(cloneFromId).all<any>();
      for (const li of lines.results ?? []) {
        stmts.push(env.DB.prepare(`
          INSERT INTO DRAFT_LINE_ITEM
            (id, structure_id, sort_order, component_part_number, part_description, quantity,
             chosen_price_point_id, price_override, price_override_e4, supplier, lead_time_days, product_code,
             is_commissioned, commission_cap_pct, sub_assembly_structure_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          uuid(), newId, li.sort_order, li.component_part_number, li.part_description, li.quantity,
          li.chosen_price_point_id, li.price_override, li.price_override_e4, li.supplier, li.lead_time_days, li.product_code,
          li.is_commissioned, li.commission_cap_pct, li.sub_assembly_structure_id
        ));
      }
      // Clone general/variant tags. Audit fields carry over VERBATIM from the
      // source (§5.4): a cloned "arctic" tag keeps whoever first applied it and
      // when, so "first time this concept was tagged in this family" survives
      // down the variant tree. The clone action itself is recorded on the new
      // STRUCTURE's created_by_user_id / created_at, not here.
      const tags = await env.DB.prepare(`
        SELECT st.tag_id, st.applied_by_user_id, st.applied_at, st.reason
        FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
        WHERE st.structure_id = ? AND t.kind IN ('general', 'variant')
      `).bind(cloneFromId).all<{ tag_id: string; applied_by_user_id: string; applied_at: string; reason: string | null }>();
      for (const t of tags.results ?? []) {
        stmts.push(env.DB.prepare(`INSERT INTO DRAFT_STRUCTURE_TAG (structure_id, tag_id, applied_by_user_id, applied_at, reason) VALUES (?, ?, ?, ?, ?)`)
          .bind(newId, t.tag_id, t.applied_by_user_id, t.applied_at, t.reason));
      }
    }

    await env.DB.batch(stmts);
    return json({ id: newId });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleCheckout(env: Env, structureId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { current_user_id: string };
    if (!body.current_user_id) return json({ error: 'current_user_id required' }, 400);

    const existing = await env.DB.prepare(`SELECT holder_user_id FROM CHECKOUT_LOCK WHERE structure_id = ?`).bind(structureId).first<{ holder_user_id: string }>();
    if (existing && existing.holder_user_id !== body.current_user_id) {
      return json({ error: 'Already checked out by another engineer' }, 409);
    }
    if (existing) return json({ id: structureId }); // already holds; resume

    // Clone live → DRAFT
    const struct = await env.DB.prepare(`SELECT * FROM STRUCTURE WHERE id = ?`).bind(structureId).first<any>();
    if (!struct) return json({ error: 'Structure not found' }, 404);

    // Check for archived/locked system tags (mutex)
    const sysTags = await env.DB.prepare(`
      SELECT t.name_lower FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.structure_id = ? AND t.kind = 'system'
    `).bind(structureId).all<{ name_lower: string }>();
    const sysNames = (sysTags.results ?? []).map((t) => t.name_lower);
    if (sysNames.includes('archived')) return json({ error: 'Structure is archived. Unarchive first to edit.' }, 409);
    if (sysNames.includes('locked'))   return json({ error: 'Structure is locked. Unlock first to edit.' }, 409);

    const now = isoNow();
    const stmts: D1PreparedStatement[] = [];
    stmts.push(env.DB.prepare(`INSERT INTO CHECKOUT_LOCK (structure_id, holder_user_id, acquired_at) VALUES (?, ?, ?)`).bind(structureId, body.current_user_id, now));
    stmts.push(env.DB.prepare(`
      INSERT INTO DRAFT_STRUCTURE
        (structure_id, editor_user_id, part_number, description, spec_id, spec_revision_id, parent_structure_id,
         build_hours, target_assembly_margin_pct,
         build_instr_1, build_instr_2, build_instr_3, build_instr_4, build_instr_5,
         work_instr_1, work_instr_2, work_instr_3, work_instr_4, work_instr_5,
         draft_started_at, last_edited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      structureId, body.current_user_id, struct.part_number, struct.description, struct.spec_id, struct.spec_revision_id, struct.parent_structure_id,
      struct.build_hours, struct.target_assembly_margin_pct,
      struct.build_instr_1, struct.build_instr_2, struct.build_instr_3, struct.build_instr_4, struct.build_instr_5,
      struct.work_instr_1, struct.work_instr_2, struct.work_instr_3, struct.work_instr_4, struct.work_instr_5,
      now, now
    ));

    const lines = await env.DB.prepare(`SELECT * FROM LINE_ITEM WHERE structure_id = ? ORDER BY sort_order`).bind(structureId).all<any>();
    for (const li of lines.results ?? []) {
      stmts.push(env.DB.prepare(`
        INSERT INTO DRAFT_LINE_ITEM
          (id, structure_id, sort_order, component_part_number, part_description, quantity,
           chosen_price_point_id, price_override, price_override_e4, supplier, lead_time_days, product_code,
           is_commissioned, commission_cap_pct, sub_assembly_structure_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(li.id, structureId, li.sort_order, li.component_part_number, li.part_description, li.quantity,
              li.chosen_price_point_id, li.price_override, li.price_override_e4, li.supplier, li.lead_time_days, li.product_code,
              li.is_commissioned, li.commission_cap_pct, li.sub_assembly_structure_id));
    }

    const tagsQ = await env.DB.prepare(`
      SELECT st.tag_id FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.structure_id = ? AND t.kind IN ('general', 'variant')
    `).bind(structureId).all<{ tag_id: string }>();
    for (const t of tagsQ.results ?? []) {
      stmts.push(env.DB.prepare(`INSERT INTO DRAFT_STRUCTURE_TAG (structure_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, ?, ?)`).bind(structureId, t.tag_id, body.current_user_id, now));
    }

    await env.DB.batch(stmts);
    return json({ id: structureId });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleGetDraft(env: Env, structureId: string): Promise<Response> {
  try {
    const draft = await env.DB.prepare(`SELECT * FROM DRAFT_STRUCTURE WHERE structure_id = ?`).bind(structureId).first<any>();
    if (!draft) return json({ error: 'No draft for this structure' }, 404);

    const struct = await env.DB.prepare(`
      SELECT s.*, sp.spec_number, (sp.spec_number || s.part_number) AS live_top_level_part_number,
             ps.part_number AS parent_part_number
      FROM STRUCTURE s
      JOIN SPEC sp ON sp.id = s.spec_id
      LEFT JOIN STRUCTURE ps ON ps.id = s.parent_structure_id
      WHERE s.id = ?
    `).bind(structureId).first<any>();

    const spec = await env.DB.prepare(`SELECT spec_number FROM SPEC WHERE id = ?`).bind(draft.spec_id).first<{ spec_number: string }>();
    const specTagsQ = await env.DB.prepare(`
      SELECT t.name FROM SPEC_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.spec_id = ?
      ORDER BY t.name
    `).bind(draft.spec_id).all<{ name: string }>();
    const lines = await env.DB.prepare(`
      SELECT dli.*, COALESCE(pp.price_e4 / 10000.0, pp.price) AS chosen_price, sa.part_number AS sub_assembly_part_number
      FROM DRAFT_LINE_ITEM dli
      LEFT JOIN PRICE_POINT pp ON pp.id = dli.chosen_price_point_id
      LEFT JOIN STRUCTURE sa ON sa.id = dli.sub_assembly_structure_id
      WHERE dli.structure_id = ?
      ORDER BY dli.sort_order
    `).bind(structureId).all<any>();
    const draftTags = await env.DB.prepare(`
      SELECT t.id, t.name, t.kind FROM DRAFT_STRUCTURE_TAG dst JOIN TAG t ON t.id = dst.tag_id
      WHERE dst.structure_id = ?
    `).bind(structureId).all<{ id: string; name: string; kind: string }>();

    const editor = await env.DB.prepare(`SELECT display_name FROM USER WHERE id = ?`).bind(draft.editor_user_id).first<{ display_name: string }>();

    // Sub-assemblies publish a rolled-up cost, not a sell price, and have no
    // margin of their own (§5.5) — the editor needs to know which it is.
    const subAsmQ = await env.DB.prepare(`
      SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.structure_id = ? AND t.kind = 'system' AND t.name_lower = 'subassembly'
    `).bind(structureId).first();

    // Active siblings' variant-tag sets, for the sibling-spawn banner (§5.4).
    // Returned as raw sets rather than a precomputed verdict so the editor can
    // re-evaluate the tie live as the engineer adds or removes tags — the
    // banner has to clear the moment the tie breaks, not on the next reload.
    // G5c at check-in remains the authoritative gate.
    const siblingVariantTagSets: Array<{ name: string; tag_ids: string[] }> = [];
    if (draft.parent_structure_id) {
      const sibsQ = await env.DB.prepare(`
        SELECT s.id, (sp.spec_number || s.part_number) AS name
        FROM STRUCTURE s JOIN SPEC sp ON sp.id = s.spec_id
        WHERE s.parent_structure_id = ? AND s.id <> ?
          AND NOT EXISTS (
            SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
            WHERE st.structure_id = s.id AND t.kind = 'system' AND t.name_lower = 'archived'
          )
      `).bind(draft.parent_structure_id, structureId).all<{ id: string; name: string }>();
      for (const sib of sibsQ.results ?? []) {
        const stq = await env.DB.prepare(`
          SELECT st.tag_id FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
          WHERE st.structure_id = ? AND t.kind = 'variant'
        `).bind(sib.id).all<{ tag_id: string }>();
        siblingVariantTagSets.push({ name: sib.name, tag_ids: (stq.results ?? []).map((r) => r.tag_id) });
      }
    }

    return json({
      structure_id: structureId,
      editor_user_id: draft.editor_user_id,
      editor_name: editor?.display_name ?? null,
      spec_id: draft.spec_id,
      spec_number: spec?.spec_number ?? '',
      spec_revision_id: draft.spec_revision_id,
      part_number: draft.part_number,
      description: draft.description,
      parent_structure_id: draft.parent_structure_id,
      parent_part_number: struct?.parent_part_number ?? null,
      build_hours: draft.build_hours,
      target_assembly_margin_pct: draft.target_assembly_margin_pct,
      build_instr_1: draft.build_instr_1, build_instr_2: draft.build_instr_2, build_instr_3: draft.build_instr_3, build_instr_4: draft.build_instr_4, build_instr_5: draft.build_instr_5,
      work_instr_1:  draft.work_instr_1,  work_instr_2:  draft.work_instr_2,  work_instr_3:  draft.work_instr_3,  work_instr_4:  draft.work_instr_4,  work_instr_5:  draft.work_instr_5,
      live_current_construction_revision_number: struct?.current_construction_revision_number ?? 0,
      live_current_price_revision_number: struct?.current_price_revision_number ?? 0,
      live_top_level_part_number: struct?.live_top_level_part_number ?? '',
      lines: (lines.results ?? []).map((li: any) => ({
        id: li.id,
        sort_order: li.sort_order,
        component_part_number: li.component_part_number,
        part_description: li.part_description,
        quantity: li.quantity,
        chosen_price_point_id: li.chosen_price_point_id,
        unit_price: li.chosen_price ?? li.price_override,
        price_override: li.price_override,
        supplier: li.supplier,
        lead_time_days: li.lead_time_days,
        product_code: li.product_code,
        is_commissioned: !!li.is_commissioned,
        commission_cap_pct: li.commission_cap_pct,
        sub_assembly_structure_id: li.sub_assembly_structure_id,
        sub_assembly_part_number: li.sub_assembly_part_number,
      })),
      tags: draftTags.results ?? [],
      spec_tags: (specTagsQ.results ?? []).map((t) => t.name),
      sibling_variant_tag_sets: siblingVariantTagSets,
      is_subassembly: !!subAsmQ,
    });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

// PATCH /api/drafts/:id — replaces the draft contents wholesale (simple, atomic).
interface DraftPatch {
  current_user_id: string;
  part_number: string;
  description: string | null;
  build_hours: number;
  target_assembly_margin_pct: number;
  build_instr_1?: string | null;
  build_instr_2?: string | null;
  build_instr_3?: string | null;
  build_instr_4?: string | null;
  build_instr_5?: string | null;
  work_instr_1?:  string | null;
  work_instr_2?:  string | null;
  work_instr_3?:  string | null;
  work_instr_4?:  string | null;
  work_instr_5?:  string | null;
  lines: Array<{
    id?: string;
    sort_order: number;
    component_part_number: string;
    part_description: string;
    quantity: number;
    chosen_price_point_id: string | null;
    price_override: number | null;
    supplier: string;
    lead_time_days: number;
    product_code: string;
    is_commissioned: boolean;
    commission_cap_pct: number | null;
    sub_assembly_structure_id: string | null;
  }>;
  tag_ids: string[];
}

async function handlePatchDraft(env: Env, structureId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as DraftPatch;
    const lock = await env.DB.prepare(`SELECT holder_user_id FROM CHECKOUT_LOCK WHERE structure_id = ?`).bind(structureId).first<{ holder_user_id: string }>();
    if (!lock) return json({ error: 'No active lock; cannot edit' }, 409);
    if (lock.holder_user_id !== body.current_user_id) return json({ error: 'Only the lock holder can edit this draft' }, 409);

    const now = isoNow();
    const stmts: D1PreparedStatement[] = [];

    stmts.push(env.DB.prepare(`
      UPDATE DRAFT_STRUCTURE SET
        part_number = ?, description = ?, build_hours = ?, target_assembly_margin_pct = ?,
        build_instr_1 = ?, build_instr_2 = ?, build_instr_3 = ?, build_instr_4 = ?, build_instr_5 = ?,
        work_instr_1 = ?, work_instr_2 = ?, work_instr_3 = ?, work_instr_4 = ?, work_instr_5 = ?,
        last_edited_at = ?
      WHERE structure_id = ?
    `).bind(
      body.part_number, (body.description ?? '').trim() || null, body.build_hours, body.target_assembly_margin_pct,
      body.build_instr_1 ?? null, body.build_instr_2 ?? null, body.build_instr_3 ?? null, body.build_instr_4 ?? null, body.build_instr_5 ?? null,
      body.work_instr_1 ?? null,  body.work_instr_2 ?? null,  body.work_instr_3 ?? null,  body.work_instr_4 ?? null,  body.work_instr_5 ?? null,
      now, structureId
    ));

    stmts.push(env.DB.prepare(`DELETE FROM DRAFT_LINE_ITEM WHERE structure_id = ?`).bind(structureId));
    for (const li of body.lines) {
      stmts.push(env.DB.prepare(`
        INSERT INTO DRAFT_LINE_ITEM
          (id, structure_id, sort_order, component_part_number, part_description, quantity,
           chosen_price_point_id, price_override, price_override_e4, supplier, lead_time_days, product_code,
           is_commissioned, commission_cap_pct, sub_assembly_structure_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        li.id ?? uuid(), structureId, li.sort_order, li.component_part_number, li.part_description, li.quantity,
        li.chosen_price_point_id, li.price_override,
        li.price_override == null ? null : toE4(li.price_override),
        li.supplier, li.lead_time_days, li.product_code,
        li.is_commissioned ? 1 : 0, li.commission_cap_pct, li.sub_assembly_structure_id
      ));
    }

    stmts.push(env.DB.prepare(`DELETE FROM DRAFT_STRUCTURE_TAG WHERE structure_id = ?`).bind(structureId));
    for (const tagId of body.tag_ids) {
      stmts.push(env.DB.prepare(`INSERT INTO DRAFT_STRUCTURE_TAG (structure_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, ?, ?)`).bind(structureId, tagId, body.current_user_id, now));
    }

    await env.DB.batch(stmts);
    return json({ ok: true });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleDiscard(env: Env, structureId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { current_user_id: string };
    const lock = await env.DB.prepare(`SELECT holder_user_id FROM CHECKOUT_LOCK WHERE structure_id = ?`).bind(structureId).first<{ holder_user_id: string }>();
    if (!lock) return json({ error: 'No lock to discard' }, 409);
    if (lock.holder_user_id !== body.current_user_id) return json({ error: 'Only the lock holder can discard' }, 409);

    const struct = await env.DB.prepare(`SELECT current_construction_revision_number FROM STRUCTURE WHERE id = ?`).bind(structureId).first<{ current_construction_revision_number: number }>();
    if (!struct) return json({ error: 'Structure not found' }, 404);

    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(`DELETE FROM DRAFT_STRUCTURE_TAG WHERE structure_id = ?`).bind(structureId),
      env.DB.prepare(`DELETE FROM DRAFT_LINE_ITEM WHERE structure_id = ?`).bind(structureId),
      env.DB.prepare(`DELETE FROM DRAFT_STRUCTURE WHERE structure_id = ?`).bind(structureId),
      env.DB.prepare(`DELETE FROM CHECKOUT_LOCK WHERE structure_id = ?`).bind(structureId),
    ];
    if (struct.current_construction_revision_number === 0) {
      // T6 — never committed; drop the STRUCTURE shell too
      stmts.push(env.DB.prepare(`DELETE FROM STRUCTURE WHERE id = ?`).bind(structureId));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, dropped_structure: struct.current_construction_revision_number === 0 });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

// =============================================================
// Check-in (commit) — §5.7 cascade
// =============================================================

interface CheckinBody {
  current_user_id: string;
  cr_notes?: string | null;
  pr_notes?: string | null;
  sell_tag_names?: string[];          // e.g. ['sell-2026']  (auto-prepended)
  assigned_to_user_id?: string | null; // OM recipient (CR only)
  assignment_note?: string | null;
}

async function handleCheckin(env: Env, structureId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as CheckinBody;
    const lock = await env.DB.prepare(`SELECT holder_user_id FROM CHECKOUT_LOCK WHERE structure_id = ?`).bind(structureId).first<{ holder_user_id: string }>();
    if (!lock) return json({ error: 'No lock; nothing to check in' }, 409);
    if (lock.holder_user_id !== body.current_user_id) return json({ error: 'Only the lock holder can check in' }, 409);

    // Pull live structure + draft + lines + tags
    const live = await env.DB.prepare(`SELECT * FROM STRUCTURE WHERE id = ?`).bind(structureId).first<any>();
    if (!live) return json({ error: 'Structure missing' }, 500);
    const draft = await env.DB.prepare(`SELECT * FROM DRAFT_STRUCTURE WHERE structure_id = ?`).bind(structureId).first<any>();
    if (!draft) return json({ error: 'No draft to check in' }, 409);
    const liveLines = await env.DB.prepare(`SELECT * FROM LINE_ITEM WHERE structure_id = ? ORDER BY sort_order`).bind(structureId).all<any>();
    const draftLines = await env.DB.prepare(`SELECT * FROM DRAFT_LINE_ITEM WHERE structure_id = ? ORDER BY sort_order`).bind(structureId).all<any>();
    const liveTagsQ = await env.DB.prepare(`SELECT st.tag_id, t.kind, t.name FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id WHERE st.structure_id = ?`).bind(structureId).all<{ tag_id: string; kind: string; name: string }>();
    const draftTagsQ = await env.DB.prepare(`SELECT dst.tag_id, t.kind, t.name, t.name_lower FROM DRAFT_STRUCTURE_TAG dst JOIN TAG t ON t.id = dst.tag_id WHERE dst.structure_id = ?`).bind(structureId).all<{ tag_id: string; kind: string; name: string; name_lower: string }>();

    // =====  GATES  =====
    // G2 always-required
    const partNumber = (draft.part_number ?? '').trim();
    if (!partNumber || partNumber.length > 25) return json({ error: 'G2: part_number must be 1-25 chars' }, 422);
    const description = (draft.description ?? '').trim();
    if (!description)          return json({ error: 'G2: description is required' }, 422);
    if (description.length > 120) return json({ error: 'G2: description must be 120 characters or fewer' }, 422);
    if (!draft.build_hours || draft.build_hours <= 0) return json({ error: 'G2: build_hours must be > 0' }, 422);
    if (draft.target_assembly_margin_pct === null || draft.target_assembly_margin_pct === undefined) return json({ error: 'G2: target_assembly_margin_pct required' }, 422);
    if (draft.target_assembly_margin_pct < 0 || draft.target_assembly_margin_pct >= 1) return json({ error: 'G2: target_assembly_margin_pct must be in [0, 1)' }, 422);

    // G3: ≥ 1 line
    if ((draftLines.results ?? []).length === 0) return json({ error: 'G3: structure has no line items' }, 422);

    // G6: unique (spec_id, part_number) excluding self
    const dup = await env.DB.prepare(`SELECT id FROM STRUCTURE WHERE spec_id = ? AND part_number = ? AND id <> ?`).bind(draft.spec_id, partNumber, structureId).first();
    if (dup) return json({ error: `G6: part_number ${partNumber} already exists under this spec` }, 422);

    // G6b: archive interlock. Check-out already refuses archived structures;
    // this is the last-line guard against an archive landing mid-draft.
    const archivedQ = await env.DB.prepare(`
      SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.structure_id = ? AND t.kind = 'system' AND t.name_lower = 'archived'
    `).bind(structureId).first();
    if (archivedQ) return json({ error: 'G6b: structure is archived; unarchive first' }, 422);

    // Detect changed streams (CR vs PR)
    const crChanged = isCrChanged(live, draft, liveLines.results ?? [], draftLines.results ?? [], liveTagsQ.results ?? [], draftTagsQ.results ?? []);
    const prChanged = isPrChanged(live, draft, liveLines.results ?? [], draftLines.results ?? []);

    // G1: at least one stream changed
    if (!crChanged && !prChanged) return json({ error: 'G1: no changes to commit' }, 422);

    // G4cr: per-line CR fields
    if (crChanged) {
      for (const li of draftLines.results ?? []) {
        if (!li.component_part_number) return json({ error: `G4cr: line ${li.sort_order} missing component_part_number` }, 422);
        if (!li.part_description)      return json({ error: `G4cr: line ${li.sort_order} missing part_description` }, 422);
        if (!li.quantity || li.quantity <= 0) return json({ error: `G4cr: line ${li.sort_order} quantity must be > 0` }, 422);
        if (!li.supplier)              return json({ error: `G4cr: line ${li.sort_order} missing supplier` }, 422);
        if (li.lead_time_days === null || li.lead_time_days === undefined) return json({ error: `G4cr: line ${li.sort_order} missing lead_time_days` }, 422);
        if (!li.product_code)          return json({ error: `G4cr: line ${li.sort_order} missing product_code` }, 422);
        // A sub-assembly line must point at a STRUCTURE that actually carries
        // the `subassembly` system tag — otherwise its cost was never published.
        if (li.sub_assembly_structure_id) {
          const taggedQ = await env.DB.prepare(`
            SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
            WHERE st.structure_id = ? AND t.kind = 'system' AND t.name_lower = 'subassembly'
          `).bind(li.sub_assembly_structure_id).first();
          if (!taggedQ) return json({ error: `G4cr: line ${li.sort_order} references a structure that is not marked as a sub-assembly` }, 422);
        }
      }
    }

    // G4pr: per-line PR fields
    if (prChanged) {
      for (const li of draftLines.results ?? []) {
        const hasChosen = li.chosen_price_point_id !== null;
        const hasOverride = li.price_override !== null;
        if (hasChosen === hasOverride) return json({ error: `G4pr: line ${li.sort_order} must have exactly one of chosen_price_point_id or price_override` }, 422);
        if (li.is_commissioned) {
          const cap = li.commission_cap_pct;
          if (cap === null || cap <= 0 || cap >= 1) return json({ error: `G4pr: line ${li.sort_order} commission_cap_pct must be in (0, 1)` }, 422);
        } else if (li.commission_cap_pct !== null) {
          return json({ error: `G4pr: line ${li.sort_order} non-commissioned line must have NULL commission_cap_pct` }, 422);
        }
      }
    }

    // G4c (shared): sub-assembly self-reference or cycle. Depth is unbounded by
    // design — only loops are rejected. Re-checked even on PR-only commits.
    const cycle = await detectSubAssemblyCycle(env, structureId, draftLines.results ?? []);
    if (cycle) return json({ error: `G4c: sub-assembly cycle detected — ${cycle}` }, 422);

    // G4d (shared): the same component may not appear on two lines. One line per
    // part; quantity carries the count. Comparison is exact-text, matching G6.
    const seenComponents = new Set<string>();
    for (const li of draftLines.results ?? []) {
      const key = li.component_part_number;
      if (!key) continue; // absence is G4cr's problem, not G4d's
      if (seenComponents.has(key)) {
        return json({ error: `G4d: duplicate line item — component ${key} appears more than once. Use a single line and raise the quantity.` }, 422);
      }
      seenComponents.add(key);
    }

    // Variant gates (CR-side; the CR carries variant tags forward on PR-only commits)
    const draftTags = draftTagsQ.results ?? [];
    if (draft.parent_structure_id) {
      // G5a: variant depth = 1 — the parent must itself be a base part.
      const parentQ = await env.DB.prepare(`SELECT parent_structure_id FROM STRUCTURE WHERE id = ?`).bind(draft.parent_structure_id).first<{ parent_structure_id: string | null }>();
      if (!parentQ) return json({ error: 'G5a: parent structure does not exist' }, 422);
      if (parentQ.parent_structure_id) return json({ error: 'G5a: variant depth = 1 — cannot commit a variant of a variant' }, 422);

      // G5b: at least one variant tag, on every CR check-in including the first.
      const variantTagIds = new Set(draftTags.filter((t) => t.kind === 'variant').map((t) => t.tag_id));
      if (variantTagIds.size === 0) return json({ error: 'G5b: variant requires at least one variant tag' }, 422);

      // G5c: sibling distinctness — the variant-tag set must not exactly match
      // that of any ACTIVE (non-archived) sibling under the same base part.
      const sibsQ = await env.DB.prepare(`
        SELECT s.id, (sp.spec_number || s.part_number) AS name
        FROM STRUCTURE s
        JOIN SPEC sp ON sp.id = s.spec_id
        WHERE s.parent_structure_id = ? AND s.id <> ?
          AND NOT EXISTS (
            SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
            WHERE st.structure_id = s.id AND t.kind = 'system' AND t.name_lower = 'archived'
          )
      `).bind(draft.parent_structure_id, structureId).all<{ id: string; name: string }>();
      for (const sib of sibsQ.results ?? []) {
        const sibTagsQ = await env.DB.prepare(`
          SELECT st.tag_id FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
          WHERE st.structure_id = ? AND t.kind = 'variant'
        `).bind(sib.id).all<{ tag_id: string }>();
        const sibIds = (sibTagsQ.results ?? []).map((r) => r.tag_id);
        if (sibIds.length === variantTagIds.size && sibIds.every((id) => variantTagIds.has(id))) {
          return json({ error: `G5c: variant-tag set is identical to sibling ${sib.name}. Add or remove at least one variant tag to differentiate.` }, 422);
        }
      }
    }

    // Run back-solve
    const linesForBack: LineForBacksolve[] = (draftLines.results ?? []).map((li: any) => ({
      id: li.id,
      component: li.component_part_number,
      unit_price_e4: 0, // resolved below
      quantity: li.quantity ?? 0,
      is_commissioned: !!li.is_commissioned,
      commission_cap_pct: li.commission_cap_pct,
    }));

    // Resolve each line's unit cost in exact e4 — from the pinned PRICE_POINT,
    // or from the engineer's override.
    for (let i = 0; i < (draftLines.results ?? []).length; i++) {
      const li = (draftLines.results ?? [])[i];
      if (li.chosen_price_point_id) {
        const pp = await env.DB.prepare(`SELECT price, price_e4 FROM PRICE_POINT WHERE id = ?`)
          .bind(li.chosen_price_point_id).first<{ price: number; price_e4: number | null }>();
        linesForBack[i].unit_price_e4 = pp?.price_e4 ?? toE4(pp?.price ?? 0);
      } else {
        linesForBack[i].unit_price_e4 = li.price_override_e4 ?? toE4(li.price_override ?? 0);
      }
    }
    const bs = backsolve(linesForBack, draft.target_assembly_margin_pct);

    // G4pr cap-breach assertion (§5.5). The back-solve sets each commissioned
    // line's revenue to cost/(1-cap), so its margin equals the cap in exact
    // arithmetic; this re-checks after rounding, which is the step that could
    // push a line past its contractual ceiling.
    if (prChanged) {
      const breaches = findCapBreaches(bs, linesForBack);
      if (breaches.length > 0) {
        const b = breaches[0];
        return json({
          error: `G4pr: line ${b.component ?? b.id} breaches its commission cap — `
               + `achieved ${(b.achieved * 100).toFixed(4)}% against a cap of ${(b.cap * 100).toFixed(2)}%`,
          breaches,
        }, 422);
      }
    }

    // ===== COMMIT =====
    const nextCr = crChanged ? (live.current_construction_revision_number ?? 0) + 1 : (live.current_construction_revision_number ?? 0);
    const nextPr = prChanged ? (live.current_price_revision_number ?? 0) + 1        : (live.current_price_revision_number ?? 0);
    const now = isoNow();
    const stmts: D1PreparedStatement[] = [];

    // Promote DRAFT_STRUCTURE → STRUCTURE
    stmts.push(env.DB.prepare(`
      UPDATE STRUCTURE SET
        part_number = ?, description = ?, build_hours = ?, target_assembly_margin_pct = ?,
        build_instr_1 = ?, build_instr_2 = ?, build_instr_3 = ?, build_instr_4 = ?, build_instr_5 = ?,
        work_instr_1 = ?, work_instr_2 = ?, work_instr_3 = ?, work_instr_4 = ?, work_instr_5 = ?,
        current_construction_revision_number = ?, current_price_revision_number = ?,
        spec_revision_id = ?, parent_structure_id = ?
      WHERE id = ?
    `).bind(
      draft.part_number, description, draft.build_hours, draft.target_assembly_margin_pct,
      draft.build_instr_1, draft.build_instr_2, draft.build_instr_3, draft.build_instr_4, draft.build_instr_5,
      draft.work_instr_1, draft.work_instr_2, draft.work_instr_3, draft.work_instr_4, draft.work_instr_5,
      nextCr, nextPr, draft.spec_revision_id, draft.parent_structure_id, structureId
    ));

    // Promote LINE_ITEMs (drop live, insert from draft)
    stmts.push(env.DB.prepare(`DELETE FROM LINE_ITEM WHERE structure_id = ?`).bind(structureId));
    for (const li of (draftLines.results ?? [])) {
      stmts.push(env.DB.prepare(`
        INSERT INTO LINE_ITEM
          (id, structure_id, sort_order, component_part_number, part_description, quantity,
           chosen_price_point_id, price_override, price_override_e4, supplier, lead_time_days, product_code,
           is_commissioned, commission_cap_pct, sub_assembly_structure_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(li.id, structureId, li.sort_order, li.component_part_number, li.part_description, li.quantity,
              li.chosen_price_point_id, li.price_override, li.price_override_e4, li.supplier, li.lead_time_days, li.product_code,
              li.is_commissioned, li.commission_cap_pct, li.sub_assembly_structure_id));
    }

    // Promote tags — preserve system tags on live, replace general/variant from draft
    stmts.push(env.DB.prepare(`
      DELETE FROM STRUCTURE_TAG WHERE structure_id = ?
        AND tag_id IN (SELECT id FROM TAG WHERE kind IN ('general', 'variant'))
    `).bind(structureId));
    for (const t of draftTags) {
      stmts.push(env.DB.prepare(`INSERT INTO STRUCTURE_TAG (structure_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, ?, ?)`)
        .bind(structureId, t.tag_id, body.current_user_id, now));
    }

    // CR insert (if applicable) + matching point-in-time snapshot
    let crId: string | null = null;
    if (crChanged) {
      crId = uuid();
      const cs = buildCrChangeSet(live, draft, liveLines.results ?? [], draftLines.results ?? [], liveTagsQ.results ?? [], draftTagsQ.results ?? []);
      stmts.push(env.DB.prepare(`
        INSERT INTO CONSTRUCTION_REVISION (id, structure_id, revision_number, author_user_id, committed_at, change_set, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crId, structureId, nextCr, body.current_user_id, now, JSON.stringify(cs), body.cr_notes ?? null));

      // Snapshot: capture everything the viewer needs to render this revision
      const snapshot = {
        structure_fields: {
          part_number:                draft.part_number,
          description:                draft.description,
          build_hours:                draft.build_hours,
          target_assembly_margin_pct: draft.target_assembly_margin_pct,
          spec_revision_id:           draft.spec_revision_id,
          build_instr_1:              draft.build_instr_1,
          build_instr_2:              draft.build_instr_2,
          build_instr_3:              draft.build_instr_3,
          build_instr_4:              draft.build_instr_4,
          build_instr_5:              draft.build_instr_5,
          work_instr_1:               draft.work_instr_1,
          work_instr_2:               draft.work_instr_2,
          work_instr_3:               draft.work_instr_3,
          work_instr_4:               draft.work_instr_4,
          work_instr_5:               draft.work_instr_5,
        },
        line_items: (draftLines.results ?? []).map((li: any, i: number) => ({
          id: li.id,
          sort_order: li.sort_order,
          component_part_number: li.component_part_number,
          part_description: li.part_description,
          quantity: li.quantity,
          unit_price: fromE4(linesForBack[i].unit_price_e4),
          chosen_price_point_id: li.chosen_price_point_id,
          price_override: li.price_override,
          supplier: li.supplier,
          lead_time_days: li.lead_time_days,
          product_code: li.product_code,
          is_commissioned: !!li.is_commissioned,
          commission_cap_pct: li.commission_cap_pct,
          sub_assembly_structure_id: li.sub_assembly_structure_id,
        })),
        tags: draftTags.map((t: any) => ({ name: t.name, kind: t.kind })),
      };
      stmts.push(env.DB.prepare(`
        INSERT INTO CONSTRUCTION_REVISION_SNAPSHOT (construction_revision_id, snapshot_json, taken_at)
        VALUES (?, ?, ?)
      `).bind(crId, JSON.stringify(snapshot), now));
    } else {
      // Use the latest existing CR for sell PP provenance
      const lastCr = await env.DB.prepare(`SELECT id FROM CONSTRUCTION_REVISION WHERE structure_id = ? ORDER BY revision_number DESC LIMIT 1`).bind(structureId).first<{ id: string }>();
      crId = lastCr?.id ?? null;
    }

    // PR insert
    let prId: string | null = null;
    if (prChanged) {
      prId = uuid();
      const cs = buildPrChangeSet(live, draft, liveLines.results ?? [], draftLines.results ?? []);
      stmts.push(env.DB.prepare(`
        INSERT INTO PRICE_REVISION (id, structure_id, revision_number, author_user_id, committed_at, change_set, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(prId, structureId, nextPr, body.current_user_id, now, JSON.stringify(cs), body.pr_notes ?? null));
    } else {
      const lastPr = await env.DB.prepare(`SELECT id FROM PRICE_REVISION WHERE structure_id = ? ORDER BY revision_number DESC LIMIT 1`).bind(structureId).first<{ id: string }>();
      prId = lastPr?.id ?? null;
    }

    const subAsmQ = await env.DB.prepare(`
      SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.structure_id = ? AND t.kind = 'system' AND t.name_lower = 'subassembly'
    `).bind(structureId).first();
    const subAsm = !!subAsmQ;

    // Insert new structure_sell (or subassembly_cost) PP — captures the
    // target_assembly_margin_pct that was in force at this commit so the
    // PP is self-describing.
    const newPpId = uuid();
    // A sub-assembly publishes its rolled-up cost, also rounded to the cent.
    const subAsmCostE4 = roundToCentE4(bs.total_cost_e4);
    if (subAsm) {
      stmts.push(env.DB.prepare(`
        INSERT INTO PRICE_POINT (id, component_part_number, structure_id, scope, price, price_e4, quote_number,
                                 derived_from_construction_revision_id, derived_from_price_revision_id,
                                 target_assembly_margin_pct, set_by_user_id, set_at)
        VALUES (?, NULL, ?, 'subassembly_cost', ?, ?, NULL, ?, ?, ?, ?, ?)
      `).bind(newPpId, structureId, fromE4(subAsmCostE4), subAsmCostE4, crId, prId, draft.target_assembly_margin_pct, body.current_user_id, now));
    } else {
      stmts.push(env.DB.prepare(`
        INSERT INTO PRICE_POINT (id, component_part_number, structure_id, scope, price, price_e4, quote_number,
                                 derived_from_construction_revision_id, derived_from_price_revision_id,
                                 target_assembly_margin_pct, set_by_user_id, set_at)
        VALUES (?, NULL, ?, 'structure_sell', ?, ?, NULL, ?, ?, ?, ?, ?)
      `).bind(newPpId, structureId, fromE4(bs.baseline_sell_price_e4), bs.baseline_sell_price_e4, crId, prId, draft.target_assembly_margin_pct, body.current_user_id, now));
    }

    // Tag the new PP — engineer-supplied tags are authoritative.
    // Only fall back to a sell-<year>/cost-<year> default if they
    // didn't enter anything in the check-in dialog.
    const wantedKind = subAsm ? 'cost' : 'sell';
    const supplied = (body.sell_tag_names ?? []).map((n) => n?.trim()).filter((n): n is string => !!n);
    const fallback = subAsm ? 'cost-2026' : 'sell-2026';
    const wantedNames = supplied.length > 0 ? supplied : [fallback];

    // Look up tag ids for the names; create them if missing (kind = sell or cost)
    for (const tagName of wantedNames) {
      const existing = await env.DB.prepare(`SELECT id FROM TAG WHERE name_lower = ? AND kind = ?`).bind(tagName.toLowerCase(), wantedKind).first<{ id: string }>();
      let tagId: string;
      if (existing) {
        tagId = existing.id;
      } else {
        tagId = uuid();
        stmts.push(env.DB.prepare(`INSERT INTO TAG (id, name, name_lower, kind) VALUES (?, ?, ?, ?)`).bind(tagId, tagName, tagName.toLowerCase(), wantedKind));
      }
      stmts.push(env.DB.prepare(`INSERT INTO PRICE_POINT_TAG (price_point_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, ?, ?)`).bind(newPpId, tagId, body.current_user_id, now));
    }

    // below-target system tag
    const belowTagId = '10000000-0000-0000-0000-000000000004';
    const liveBelow = (liveTagsQ.results ?? []).some((t) => t.tag_id === belowTagId);
    if (!subAsm) {
      if (bs.is_below_target && !liveBelow) {
        stmts.push(env.DB.prepare(`INSERT INTO STRUCTURE_TAG (structure_id, tag_id, applied_by_user_id, applied_at) VALUES (?, ?, '00000000-0000-0000-0000-000000000001', ?)`).bind(structureId, belowTagId, now));
      } else if (!bs.is_below_target && liveBelow) {
        stmts.push(env.DB.prepare(`DELETE FROM STRUCTURE_TAG WHERE structure_id = ? AND tag_id = ?`).bind(structureId, belowTagId));
      }
    }

    // Drop draft + lock
    stmts.push(env.DB.prepare(`DELETE FROM DRAFT_STRUCTURE_TAG WHERE structure_id = ?`).bind(structureId));
    stmts.push(env.DB.prepare(`DELETE FROM DRAFT_LINE_ITEM WHERE structure_id = ?`).bind(structureId));
    stmts.push(env.DB.prepare(`DELETE FROM DRAFT_STRUCTURE WHERE structure_id = ?`).bind(structureId));
    stmts.push(env.DB.prepare(`DELETE FROM CHECKOUT_LOCK WHERE structure_id = ?`).bind(structureId));

    // Conditional ASSIGNMENT (CR only)
    let assignmentId: string | null = null;
    if (crChanged && body.assigned_to_user_id && crId) {
      assignmentId = uuid();
      stmts.push(env.DB.prepare(`
        INSERT INTO ASSIGNMENT (id, structure_id, construction_revision_id, assigned_by_user_id, assigned_to_user_id, assigned_at, note, acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(assignmentId, structureId, crId, body.current_user_id, body.assigned_to_user_id, now, body.assignment_note ?? null));
    }

    await env.DB.batch(stmts);

    return json({
      ok: true,
      structure_id: structureId,
      cr_committed: crChanged ? nextCr : null,
      pr_committed: prChanged ? nextPr : null,
      baseline_price: fromE4(subAsm ? subAsmCostE4 : bs.baseline_sell_price_e4),
      achieved_margin_pct: bs.achieved_margin_pct,
      is_below_target: bs.is_below_target,
      assignment_id: assignmentId,
    });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

// =============================================================
// /api/inbox + /api/assignments/:id (+ acknowledge)
// =============================================================

async function handleInbox(env: Env, url: URL): Promise<Response> {
  try {
    const userId = url.searchParams.get('user_id');
    const tab    = url.searchParams.get('tab') ?? 'open';
    if (!userId) return json({ error: 'user_id required' }, 400);
    const ack = tab === 'completed' ? 1 : 0;

    const q = await env.DB.prepare(`
      SELECT a.id, a.structure_id, a.construction_revision_id,
             a.assigned_at, a.acknowledged_at, a.acknowledged, a.note,
             u.display_name AS assigned_by_name,
             s.part_number, (sp.spec_number || s.part_number) AS top_level_part_number,
             sp.spec_number,
             cr.revision_number AS cr_number,
             cr.notes AS cr_notes,
             (SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id WHERE st.structure_id = s.id AND t.name_lower = 'archived') AS is_archived,
             (SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id WHERE st.structure_id = s.id AND t.name_lower = 'below-target') AS is_below_target,
             (SELECT COUNT(*) FROM ASSIGNMENT pending
              WHERE pending.structure_id = a.structure_id AND pending.assigned_to_user_id = a.assigned_to_user_id AND pending.acknowledged = 0) AS pending_count_for_structure
      FROM ASSIGNMENT a
      JOIN USER u ON u.id = a.assigned_by_user_id
      JOIN STRUCTURE s ON s.id = a.structure_id
      JOIN SPEC sp ON sp.id = s.spec_id
      JOIN CONSTRUCTION_REVISION cr ON cr.id = a.construction_revision_id
      WHERE a.assigned_to_user_id = ? AND a.acknowledged = ?
      ORDER BY ${ack === 0 ? 'a.assigned_at DESC' : 'a.acknowledged_at DESC'}
    `).bind(userId, ack).all<any>();

    return json({
      assignments: (q.results ?? []).map((a) => ({
        id: a.id,
        structure_id: a.structure_id,
        construction_revision_id: a.construction_revision_id,
        cr_number: a.cr_number,
        cr_notes: a.cr_notes,
        top_level_part_number: a.top_level_part_number,
        spec_number: a.spec_number,
        part_number: a.part_number,
        assigned_by_name: a.assigned_by_name,
        assigned_at: a.assigned_at,
        acknowledged_at: a.acknowledged_at,
        note: a.note,
        is_archived:     !!a.is_archived,
        is_below_target: !!a.is_below_target,
        pending_count_for_structure: a.pending_count_for_structure,
      })),
    });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleAssignment(env: Env, id: string): Promise<Response> {
  try {
    const a = await env.DB.prepare(`
      SELECT a.*, u.display_name AS assigned_by_name, om.display_name AS recipient_name,
             cr.revision_number, cr.committed_at AS cr_committed_at, cr.notes AS cr_notes,
             cr.change_set AS cr_change_set,
             s.id AS structure_id, s.part_number,
             (sp.spec_number || s.part_number) AS top_level_part_number,
             sp.spec_number, sp.customer_revision AS spec_customer_revision,
             (SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id WHERE st.structure_id = s.id AND t.name_lower = 'archived') AS is_archived,
             (SELECT 1 FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id WHERE st.structure_id = s.id AND t.name_lower = 'below-target') AS is_below_target
      FROM ASSIGNMENT a
      JOIN USER u  ON u.id  = a.assigned_by_user_id
      JOIN USER om ON om.id = a.assigned_to_user_id
      JOIN CONSTRUCTION_REVISION cr ON cr.id = a.construction_revision_id
      JOIN STRUCTURE s ON s.id = a.structure_id
      JOIN SPEC sp ON sp.id = s.spec_id
      WHERE a.id = ?
    `).bind(id).first<any>();
    if (!a) return json({ error: 'Not found' }, 404);

    // Live structure detail for "the entire current structure as of that CR"
    // Render the structure AS OF the assigned CR, not as it is now. If the
    // structure has been revised since, live state would pair this revision's
    // diff with a later body — OM would enter values that were never in the
    // revision they were handed. Same overlay the ?at_cr= viewer uses.
    const live = await loadStructureDetail(env, a.structure_id);
    let detail = live;
    let stale = false;
    if (live) {
      const snap = await env.DB.prepare(
        `SELECT snapshot_json, taken_at FROM CONSTRUCTION_REVISION_SNAPSHOT WHERE construction_revision_id = ?`
      ).bind(a.construction_revision_id).first<{ snapshot_json: string; taken_at: string }>();
      if (snap) {
        detail = overlaySnapshot(live, a.construction_revision_id, a.revision_number,
                                 JSON.parse(snap.snapshot_json), snap.taken_at);
      }
      stale = live.current_construction_revision_number > a.revision_number;
    }

    return json({
      assignment: {
        id: a.id,
        assigned_by_name: a.assigned_by_name,
        recipient_name: a.recipient_name,
        assigned_to_user_id: a.assigned_to_user_id,
        assigned_at: a.assigned_at,
        acknowledged: !!a.acknowledged,
        acknowledged_at: a.acknowledged_at,
        note: a.note,
      },
      cr: {
        id: a.construction_revision_id,
        revision_number: a.revision_number,
        committed_at: a.cr_committed_at,
        notes: a.cr_notes,
        change_set: parseJson(a.cr_change_set),
      },
      structure: {
        id: a.structure_id,
        top_level_part_number: a.top_level_part_number,
        spec_number: a.spec_number,
        part_number: a.part_number,
        spec_customer_revision: a.spec_customer_revision,
        is_archived: !!a.is_archived,
        is_below_target: !!a.is_below_target,
        // True when the structure has moved on past the revision assigned here.
        has_newer_revision: stale,
        current_construction_revision_number: live?.current_construction_revision_number ?? null,
      },
      detail,
    });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

async function handleAcknowledge(env: Env, id: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { current_user_id: string };
    const a = await env.DB.prepare(`SELECT assigned_to_user_id, acknowledged, acknowledged_at FROM ASSIGNMENT WHERE id = ?`).bind(id).first<{ assigned_to_user_id: string; acknowledged: number; acknowledged_at: string | null }>();
    if (!a) return json({ error: 'Not found' }, 404);
    if (a.assigned_to_user_id !== body.current_user_id) return json({ error: 'Only the OM recipient can acknowledge' }, 403);
    if (a.acknowledged === 1) {
      // idempotent — return the existing state
      return json({ ok: true, already_acknowledged: true, acknowledged_at: a.acknowledged_at });
    }
    const now = isoNow();
    await env.DB.prepare(`UPDATE ASSIGNMENT SET acknowledged = 1, acknowledged_at = ? WHERE id = ?`).bind(now, id).run();
    return json({ ok: true, acknowledged_at: now });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}

// =============================================================
// helpers
// =============================================================

// G4c — walk the sub-assembly graph outward from the draft's own BOM and report
// the first loop back to `structureId`. Depth is unbounded (§5.7: "rejects cycles
// only — there is no depth cap"); the `seen` set is what keeps traversal finite,
// including across any pre-existing cycle elsewhere in the catalog.
// Returns a human-readable reason, or null when the graph is acyclic.
async function detectSubAssemblyCycle(env: Env, structureId: string, draftLines: any[]): Promise<string | null> {
  for (const li of draftLines) {
    if (li.sub_assembly_structure_id === structureId) {
      return `line ${li.sort_order} (${li.component_part_number}) references this structure as its own sub-assembly`;
    }
  }

  const seen = new Set<string>([structureId]);
  const queue: string[] = draftLines
    .map((li) => li.sub_assembly_structure_id)
    .filter((id: string | null): id is string => !!id);

  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);

    const kids = await env.DB.prepare(`
      SELECT sub_assembly_structure_id AS id FROM LINE_ITEM
      WHERE structure_id = ? AND sub_assembly_structure_id IS NOT NULL
    `).bind(id).all<{ id: string }>();

    for (const k of kids.results ?? []) {
      if (k.id === structureId) return `the sub-assembly graph loops back to this structure via ${id}`;
      queue.push(k.id);
    }
  }
  return null;
}

function isCrChanged(live: any, draft: any, liveLines: any[], draftLines: any[], liveTags: any[], draftTags: any[]): boolean {
  // CR-side: BOM shape + per-line construction fields + structure construction fields + general/variant tags + instructions + spec_revision_id
  if (live.current_construction_revision_number === 0) return true; // never committed
  if (live.part_number !== draft.part_number) return true;
  if ((live.description ?? null) !== (draft.description ?? null)) return true;
  if (Number(live.build_hours) !== Number(draft.build_hours)) return true;
  if (live.spec_revision_id !== draft.spec_revision_id) return true;
  for (const f of ['build_instr_1', 'build_instr_2', 'build_instr_3', 'build_instr_4', 'build_instr_5',
                    'work_instr_1', 'work_instr_2', 'work_instr_3', 'work_instr_4', 'work_instr_5']) {
    if ((live as any)[f] !== (draft as any)[f]) return true;
  }
  if (liveLines.length !== draftLines.length) return true;
  const liveById = new Map(liveLines.map((l) => [l.id, l]));
  for (const dl of draftLines) {
    const ll = liveById.get(dl.id);
    if (!ll) return true;
    if (ll.sort_order !== dl.sort_order) return true;
    for (const f of ['component_part_number', 'part_description', 'quantity', 'supplier', 'lead_time_days', 'product_code', 'sub_assembly_structure_id']) {
      if ((ll as any)[f] !== (dl as any)[f]) return true;
    }
  }
  const liveTagSet = new Set(liveTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t) => t.tag_id));
  const draftTagSet = new Set(draftTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t: any) => t.tag_id));
  if (liveTagSet.size !== draftTagSet.size) return true;
  for (const id of liveTagSet) if (!draftTagSet.has(id)) return true;
  return false;
}

function isPrChanged(live: any, draft: any, liveLines: any[], draftLines: any[]): boolean {
  if (live.current_price_revision_number === 0) return true;
  if (Number(live.target_assembly_margin_pct) !== Number(draft.target_assembly_margin_pct)) return true;
  const liveById = new Map(liveLines.map((l) => [l.id, l]));
  for (const dl of draftLines) {
    const ll = liveById.get(dl.id);
    if (!ll) return true;
    for (const f of ['chosen_price_point_id', 'price_override', 'is_commissioned', 'commission_cap_pct']) {
      const a = (ll as any)[f]; const b = (dl as any)[f];
      if ((a ?? null) !== (b ?? null)) return true;
    }
  }
  if (liveLines.length !== draftLines.length) return true;
  return false;
}

function buildCrChangeSet(live: any, draft: any, liveLines: any[], draftLines: any[], liveTags: any[], draftTags: any[]): unknown {
  const liveById  = new Map(liveLines.map((l) => [l.id, l]));
  const draftById = new Map(draftLines.map((l) => [l.id, l]));

  const summarize = (l: any) => ({
    sort_order: l.sort_order,
    component: l.component_part_number,
    description: l.part_description,
    quantity: l.quantity,
    supplier: l.supplier,
    product_code: l.product_code,
  });
  const lineAdded   = draftLines.filter((dl) => !liveById.has(dl.id)).map(summarize);
  const lineRemoved = liveLines.filter((ll) => !draftById.has(ll.id)).map(summarize);

  const LINE_FIELDS = ['component_part_number', 'part_description', 'quantity', 'supplier', 'lead_time_days', 'product_code', 'sub_assembly_structure_id'];
  const lineModified: Array<{ sort_order: number; component: string; fields: Array<{ field: string; old: unknown; new: unknown }> }> = [];
  for (const dl of draftLines) {
    const ll = liveById.get(dl.id);
    if (!ll) continue;
    const fields: Array<{ field: string; old: unknown; new: unknown }> = [];
    for (const f of LINE_FIELDS) {
      if ((ll as any)[f] !== (dl as any)[f]) {
        fields.push({ field: f, old: (ll as any)[f], new: (dl as any)[f] });
      }
    }
    if (fields.length > 0) lineModified.push({ sort_order: dl.sort_order, component: dl.component_part_number, fields });
  }

  // Structure-level field diffs
  const structureFields: Array<{ field: string; old: unknown; new: unknown }> = [];
  const SF_NUMERIC = ['build_hours'];
  const SF_TEXT = ['part_number', 'description', 'spec_revision_id', 'build_instr_1', 'build_instr_2', 'build_instr_3', 'build_instr_4', 'build_instr_5', 'work_instr_1', 'work_instr_2', 'work_instr_3', 'work_instr_4', 'work_instr_5'];
  for (const f of SF_TEXT) {
    if ((live as any)[f] !== (draft as any)[f]) {
      structureFields.push({ field: f, old: (live as any)[f], new: (draft as any)[f] });
    }
  }
  for (const f of SF_NUMERIC) {
    if (Number((live as any)[f] ?? 0) !== Number((draft as any)[f] ?? 0)) {
      structureFields.push({ field: f, old: (live as any)[f], new: (draft as any)[f] });
    }
  }

  // Tag diffs (with names)
  const liveTagMap  = new Map(liveTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t) => [t.tag_id, { name: t.name, kind: t.kind }]));
  const draftTagMap = new Map(draftTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t: any) => [t.tag_id, { name: t.name, kind: t.kind }]));
  const tagsAdded:   Array<{ name: string; kind: string }> = [];
  const tagsRemoved: Array<{ name: string; kind: string }> = [];
  for (const [id, t] of draftTagMap) if (!liveTagMap.has(id))  tagsAdded.push(t);
  for (const [id, t] of liveTagMap)  if (!draftTagMap.has(id)) tagsRemoved.push(t);

  return {
    line_items: {
      added: lineAdded,
      removed: lineRemoved,
      modified: lineModified,
    },
    structure_fields: structureFields,
    tags: { added: tagsAdded, removed: tagsRemoved },
  };
}

function buildPrChangeSet(live: any, draft: any, liveLines: any[], draftLines: any[]): unknown {
  const repriced = draftLines.filter((dl) => {
    const ll = liveLines.find((l) => l.id === dl.id);
    if (!ll) return true; // new line = priced
    return (ll.chosen_price_point_id ?? null) !== (dl.chosen_price_point_id ?? null)
        || (ll.price_override ?? null)        !== (dl.price_override ?? null)
        || !!ll.is_commissioned !== !!dl.is_commissioned
        || (ll.commission_cap_pct ?? null)    !== (dl.commission_cap_pct ?? null);
  }).length;
  return {
    line_items: { priced: repriced },
    structure_fields: {
      target_assembly_margin_pct_changed: Number(live.target_assembly_margin_pct) !== Number(draft.target_assembly_margin_pct),
    },
  };
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

function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

function uuid(): string {
  return crypto.randomUUID();
}

function isoNow(): string {
  return new Date().toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
