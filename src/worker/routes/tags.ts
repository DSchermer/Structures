// GET /api/tag-ids

import { Env } from '../env';
import { json, msg } from '../util';

export async function handleTagIds(env: Env): Promise<Response> {
  try {
    const q = await env.DB.prepare(`
      SELECT id, name, kind FROM TAG
      WHERE kind IN ('spec', 'general', 'variant', 'sell', 'cost')
      ORDER BY kind, name
    `).all<{ id: string; name: string; kind: string }>();
    return json({ tags: q.results ?? [] });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}
