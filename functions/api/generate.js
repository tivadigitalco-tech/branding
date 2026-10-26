// Cloudflare Pages Function: POST /api/generate
// Proxies a prompt to the Claude Messages API and streams the reply back as plain text.
// The API key lives in the ANTHROPIC_API_KEY secret and never reaches the browser.
//
// Environment (Pages project > Settings > Variables and Secrets):
//   ANTHROPIC_API_KEY  required, secret
//   CLAUDE_MODEL       optional, default claude-opus-5-5
//   MAX_TOKENS         optional, default 32000
//   ALLOWED_ORIGINS    optional, comma-separated, default https://branding.tivadigi.com.au

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_MAX_TOKENS = 32000;
const MAX_PROMPT_CHARS = 400000;

const SYSTEM = 'You are the generation engine for Brand Studio, a branding production tool. ' +
  'Follow the prompt exactly. When the prompt asks for JSON, reply with one JSON value only: ' +
  'no prose, no Markdown code fences.';

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return err(500, 'not_configured', 'ANTHROPIC_API_KEY is not set');

  const allowed = (env.ALLOWED_ORIGINS || 'https://branding.tivadigi.com.au')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const self = new URL(request.url).origin;
  if (origin && origin !== self && !allowed.includes(origin)) return err(403, 'forbidden', 'Origin not allowed');

  let body;
  try { body = await request.json(); } catch { return err(400, 'bad_request', 'Body must be JSON'); }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return err(400, 'bad_request', 'Missing prompt');
  if (prompt.length > MAX_PROMPT_CHARS) return err(413, 'too_large', 'Prompt too long');

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: Number(env.MAX_TOKENS) || DEFAULT_MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
    signal: request.signal,
  });

  if (!upstream.ok) {
    const code = upstream.status === 429 || upstream.status === 529 ? 'rate_limited'
      : upstream.status === 401 || upstream.status === 403 ? 'not_configured' : 'upstream_error';
    const detail = await upstream.text().catch(() => '');
    console.log('Claude API error', upstream.status, detail.slice(0, 500));
    return err(upstream.status === 429 ? 429 : 502, code, 'Claude API returned ' + upstream.status);
  }

  // Convert the SSE stream into a plain text stream of the reply.
  // A stop_reason of "refusal" or an in-stream error is signalled with a trailing marker line.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  (async () => {
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
            await writer.write(enc.encode(ev.delta.text));
          } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason === 'refusal') {
            await writer.write(enc.encode('\n\u0000ERR:refused'));
          } else if (ev.type === 'error') {
            const t = ev.error && ev.error.type;
            await writer.write(enc.encode('\n\u0000ERR:' + (t === 'overloaded_error' || t === 'rate_limit_error' ? 'rate_limited' : 'upstream_error')));
          }
        }
      }
    } catch (e) {
      try { await writer.write(enc.encode('\n\u0000ERR:upstream_error')); } catch {}
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(readable, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function onRequest() {
  return err(405, 'method_not_allowed', 'Use POST');
}

function err(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
