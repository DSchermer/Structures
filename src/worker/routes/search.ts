// GET /api/search — the catalog list behind the search page.

import { Env } from '../env';
import { TagRow } from '../rows';
import { group, json, msg } from '../util';

export interface SearchRow {
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

export async function handleSearch(env: Env, url: URL): Promise<Response> {
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
