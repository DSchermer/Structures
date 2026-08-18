// GET /api/health

import { Env } from '../env';
import { json, msg } from '../util';

export async function handleHealth(env: Env): Promise<Response> {
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
