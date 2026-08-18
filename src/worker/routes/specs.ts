// /api/specs — spec list, and the New Spec creation flow.

import { Env } from '../env';
import { isoNow, json, msg, uuid } from '../util';

export async function handleSpecs(env: Env): Promise<Response> {
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

export interface CreateSpecBody {
  spec_number: string;
  customer_revision: string;
  part_number: string;
  description?: string | null;
  current_user_id: string;
}

// POST /api/specs — the New Spec creation flow (§5.4). The only path that
// introduces a SPEC row. Atomic: SPEC + initial SPEC_REVISION + placeholder
// STRUCTURE (CR 0 / PR 0) + DRAFT_STRUCTURE + CHECKOUT_LOCK, or nothing.

export async function handleCreateSpec(env: Env, request: Request): Promise<Response> {
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
