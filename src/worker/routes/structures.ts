// /api/structures — read a structure, create one (new part or variant),
// and take a check-out.

import { D1PreparedStatement, Env } from '../env';
import { loadStructureDetail, overlaySnapshot } from '../structure-detail';
import { isoNow, json, msg, uuid } from '../util';

export async function handleStructure(env: Env, id: string, atCrId: string | null): Promise<Response> {
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

export interface CreateStructureBody {
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

export async function handleCreateStructure(env: Env, request: Request): Promise<Response> {
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

export async function handleCheckout(env: Env, structureId: string, request: Request): Promise<Response> {
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
