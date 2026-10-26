// Worker on tivadigi.com.au/branding*: serves Brand Studio behind the Tiva HQ login.
// A request is let through only if its cookies give a signed-in session on Tiva HQ
// (HQ answers 2xx for "/" when signed in and redirects to /login when not).
// Static files come from ../public; POST /branding/api/generate is the Claude proxy.

import { onRequestPost } from '../../functions/api/generate.js';

const BASE = '/branding';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === BASE) return Response.redirect(url.origin + BASE + '/' + url.search, 301);
    if (!url.pathname.startsWith(BASE + '/')) return new Response('Not found', { status: 404 });
    const path = url.pathname.slice(BASE.length);

    if (!(await hqSignedIn(request, env))) {
      if (path.startsWith('/api/')) return json(401, 'session_expired', 'Sign in to Tiva HQ');
      const hq = env.HQ_ORIGIN || 'https://tivadigi.com.au';
      return Response.redirect(`${hq}/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }

    if (path === '/api/generate') {
      if (request.method !== 'POST') return json(405, 'method_not_allowed', 'Use POST');
      return onRequestPost({ request, env });
    }
    if (path.startsWith('/api/')) return json(404, 'not_found', 'Not found');

    const res = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-store');
    return out;
  },
};

async function hqSignedIn(request, env) {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  const check = env.HQ_SESSION_CHECK || (env.HQ_ORIGIN || 'https://tivadigi.com.au') + '/';
  try {
    const r = await fetch(check, { headers: { cookie, 'user-agent': 'brand-studio-gate' }, redirect: 'manual' });
    if (r.body) r.body.cancel();
    return r.status >= 200 && r.status < 300;
  } catch (e) {
    console.log('HQ session check failed', String(e));
    return false;
  }
}

function json(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
