// /api/inbox and /api/assignments — the Order Management handoff.

import { Env } from '../env';
import { loadStructureDetail, overlaySnapshot } from '../structure-detail';
import { isoNow, json, msg, parseJson } from '../util';

export async function handleInbox(env: Env, url: URL): Promise<Response> {
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

export async function handleAssignment(env: Env, id: string): Promise<Response> {
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

export async function handleAcknowledge(env: Env, id: string, request: Request): Promise<Response> {
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
