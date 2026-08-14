const MAX_REQUEST_BYTES = 64 * 1024;

function jsonResponse(value, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(value), { status, headers });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGIN || '').trim();
  if (!allowed) return { ok: false, origin: '', error: 'ALLOWED_ORIGIN is not configured.' };
  if (!origin) return { ok: false, origin: '', error: 'Origin header is required.' };
  if (origin !== allowed) return { ok: false, origin, error: 'Origin is not allowed.' };
  return { ok: true, origin };
}

async function readBoundedRequestBody(request, maxBytes) {
  if (!request.body) return { ok: true, body: new Uint8Array(0) };

  let reader;
  try {
    reader = request.body.getReader({ mode: 'byob' });
  } catch (error) {
    return { ok: false, error: 'Request body stream is not byte-readable.' };
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const remaining = maxBytes + 1 - total;
      if (remaining <= 0) {
        await reader.cancel('Request body is too large.');
        return { ok: false };
      }

      const view = new Uint8Array(Math.min(16 * 1024, remaining));
      const { value, done } = await reader.read(view);
      if (value && value.byteLength) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel('Request body is too large.');
          return { ok: false };
        }
        chunks.push(new Uint8Array(value));
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

async function handleProxy(request, env) {
  const originCheck = getAllowedOrigin(request, env);
  if (!originCheck.ok) {
    return jsonResponse({ ok: false, error: originCheck.error }, 403);
  }

  const cors = corsHeaders(originCheck.origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405, cors);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ ok: false, error: 'Request body is too large.' }, 413, cors);
  }

  const upstreamUrl = String(env.UPSTREAM_URL || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(upstreamUrl)) {
    return jsonResponse({ ok: false, error: 'UPSTREAM_URL is not configured correctly.' }, 500, cors);
  }

  const bodyResult = await readBoundedRequestBody(request, MAX_REQUEST_BYTES);
  if (!bodyResult.ok) {
    return jsonResponse({ ok: false, error: 'Request body is too large.' }, 413, cors);
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: bodyResult.body,
      redirect: 'follow',
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'apps_script_proxy_failure', message: String(error && error.message || error) }));
    return jsonResponse({ ok: false, error: 'Backend transport failed.' }, 502, cors);
  }

  const headers = new Headers(upstream.headers);
  headers.set('access-control-allow-origin', originCheck.origin);
  headers.set('access-control-allow-methods', 'POST,OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  headers.set('cache-control', 'no-store');
  headers.set('vary', 'Origin');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=UTF-8');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'family-cash-flow-staging-bridge' });
    }

    if (url.pathname === '/api/apps-script') {
      return handleProxy(request, env);
    }

    return jsonResponse({ ok: false, error: 'Not found.' }, 404);
  },
};
