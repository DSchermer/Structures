// POST /api/drafts/:id/checkin — the §5.7 validation cascade and commit.
//
// Every gate runs before any write. The commit itself is one D1 batch, so a
// failure anywhere leaves the database exactly as it was.

import { type LineForBacksolve, backsolve, findCapBreaches } from '../../lib/backsolve';
import { fromE4, roundToCentE4, toE4 } from '../../lib/money';
import { D1PreparedStatement, Env } from '../env';
import { buildCrChangeSet, buildPrChangeSet, isCrChanged, isPrChanged } from '../revisions';
import { isoNow, json, msg, uuid } from '../util';

export interface CheckinBody {
  current_user_id: string;
  cr_notes?: string | null;
  pr_notes?: string | null;
  sell_tag_names?: string[];          // e.g. ['sell-2026']  (auto-prepended)
  assigned_to_user_id?: string | null; // OM recipient (CR only)
  assignment_note?: string | null;
}

export async function handleCheckin(env: Env, structureId: string, request: Request): Promise<Response> {
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

export async function detectSubAssemblyCycle(env: Env, structureId: string, draftLines: any[]): Promise<string | null> {
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
