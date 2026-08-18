// /api/price-points — the price library.

import { fromE4, toE4 } from '../../lib/money';
import { D1PreparedStatement, Env } from '../env';
import { TagRow } from '../rows';
import { group, isoNow, json, msg, uuid } from '../util';

export async function handlePricePoints(env: Env, url: URL): Promise<Response> {
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

export interface CreateComponentCostBody {
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

export async function handleCreateComponentCostPp(env: Env, request: Request): Promise<Response> {
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

export async function handleTogglePpSuperseded(env: Env, ppId: string, request: Request): Promise<Response> {
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
