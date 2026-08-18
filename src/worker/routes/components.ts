// GET /api/components — the COMPONENT catalog.

import { Env } from '../env';
import { json, msg } from '../util';

export async function handleComponents(env: Env, url: URL): Promise<Response> {
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
