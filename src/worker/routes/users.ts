// GET /api/users

import { Env } from '../env';
import { json, msg } from '../util';

export async function handleUsers(env: Env): Promise<Response> {
  try {
    const q = await env.DB.prepare(`
      SELECT id, username, display_name, initials, role, is_admin
      FROM USER
      WHERE username <> '__system__' AND is_active = 1
      ORDER BY role DESC, display_name
    `).all<{ id: string; username: string; display_name: string; initials: string; role: string; is_admin: number }>();
    return json({ users: q.results ?? [] });
  } catch (err) {
    return json({ error: msg(err) }, 500);
  }
}
