// /api/drafts/:id — read, save, and discard a draft.

import { toE4 } from '../../lib/money';
import { D1PreparedStatement, Env } from '../env';
import { isoNow, json, msg, uuid } from '../util';

export async function handleGetDraft(env: Env, structureId: string): Promise<Response> {
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

export interface DraftPatch {
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

export async function handlePatchDraft(env: Env, structureId: string, request: Request): Promise<Response> {
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

export async function handleDiscard(env: Env, structureId: string, request: Request): Promise<Response> {
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
