// Cloudflare Worker entry point.
//
// /api/* is dispatched here; everything else falls through to the static
// assets binding, whose single-page-application handling serves index.html for
// unknown paths so client-side routes resolve.

import { Env } from './env';
import { handleAcknowledge, handleAssignment, handleInbox } from './routes/assignments';
import { handleCheckin } from './routes/checkin';
import { handleComponents } from './routes/components';
import { handleDiscard, handleGetDraft, handlePatchDraft } from './routes/drafts';
import { handleHealth } from './routes/health';
import { handleCreateComponentCostPp, handlePricePoints, handleTogglePpSuperseded } from './routes/price-points';
import { handleSearch } from './routes/search';
import { handleCreateSpec, handleSpecs } from './routes/specs';
import { handleCheckout, handleCreateStructure, handleStructure } from './routes/structures';
import { handleTagIds } from './routes/tags';
import { handleUsers } from './routes/users';
import { json } from './util';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(url, request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(url: URL, request: Request, env: Env): Promise<Response> {
  const m = url.pathname.match.bind(url.pathname);

  if (url.pathname === '/api/health') return handleHealth(env);
  if (url.pathname === '/api/search') return handleSearch(env, url);
  if (url.pathname === '/api/tag-ids') return handleTagIds(env);
  if (url.pathname === '/api/users')  return handleUsers(env);
  if (url.pathname === '/api/components')  return handleComponents(env, url);
  if (url.pathname === '/api/price-points') {
    if (request.method === 'POST') return handleCreateComponentCostPp(env, request);
    return handlePricePoints(env, url);
  }

  let pm: RegExpMatchArray | null;
  if ((pm = m(/^\/api\/price-points\/([0-9a-fA-F-]+)\/toggle-superseded$/)) && request.method === 'POST') {
    return handleTogglePpSuperseded(env, pm[1], request);
  }

  if (url.pathname === '/api/specs') {
    if (request.method === 'POST') return handleCreateSpec(env, request);
    return handleSpecs(env);
  }
  if (url.pathname === '/api/structures' && request.method === 'POST') {
    return handleCreateStructure(env, request);
  }
  if (url.pathname === '/api/inbox') return handleInbox(env, url);

  let am: RegExpMatchArray | null;
  if ((am = m(/^\/api\/assignments\/([0-9a-fA-F-]+)$/)))                           return handleAssignment(env, am[1]);
  if ((am = m(/^\/api\/assignments\/([0-9a-fA-F-]+)\/acknowledge$/)) && request.method === 'POST') {
    return handleAcknowledge(env, am[1], request);
  }

  let mm: RegExpMatchArray | null;
  if ((mm = m(/^\/api\/structures\/([0-9a-fA-F-]+)$/)))                       return handleStructure(env, mm[1], url.searchParams.get('at_cr'));
  if ((mm = m(/^\/api\/structures\/([0-9a-fA-F-]+)\/checkout$/)) && request.method === 'POST') {
    return handleCheckout(env, mm[1], request);
  }
  if ((mm = m(/^\/api\/drafts\/([0-9a-fA-F-]+)$/))) {
    if (request.method === 'GET')   return handleGetDraft(env, mm[1]);
    if (request.method === 'PATCH') return handlePatchDraft(env, mm[1], request);
  }
  if ((mm = m(/^\/api\/drafts\/([0-9a-fA-F-]+)\/checkin$/)) && request.method === 'POST') {
    return handleCheckin(env, mm[1], request);
  }
  if ((mm = m(/^\/api\/drafts\/([0-9a-fA-F-]+)\/discard$/)) && request.method === 'POST') {
    return handleDiscard(env, mm[1], request);
  }

  return json({ error: 'Not found', path: url.pathname, method: request.method }, 404);
}

// =============================================================
// Read endpoints
// =============================================================
