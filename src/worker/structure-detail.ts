// The structure read model.
//
// loadStructureDetail assembles everything a structure page needs in one
// place; overlaySnapshot replays a CONSTRUCTION_REVISION snapshot over it so a
// caller can render the structure as it stood at a given revision.

import { Env } from './env';
import { TagRow } from './rows';
import { group, parseJson } from './util';

export function overlaySnapshot(data: any, crId: string, revisionNumber: number, snapshot: any, takenAt: string): any {
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

export async function loadStructureDetail(env: Env, id: string): Promise<any | null> {
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
