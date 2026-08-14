const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_COOKIE = 'fcf_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CLOCK_SKEW_SECONDS = 300;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonSegment(value, label) {
  try {
    return JSON.parse(decoder.decode(base64UrlDecode(value)));
  } catch (error) {
    throw new Error(`Invalid ${label}.`);
  }
}

function approvedEmails(env) {
  return new Set(String(env.APPROVED_GOOGLE_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean));
}

function assertGoogleClaims(claims, env, nowSeconds) {
  const issuer = String(claims?.iss || '');
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new Error('Google identity issuer is invalid.');
  }

  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const audiences = Array.isArray(claims?.aud) ? claims.aud.map(String) : [String(claims?.aud || '')];
  if (!clientId || !audiences.includes(clientId)) throw new Error('Google identity audience is invalid.');
  if (audiences.length > 1 && String(claims?.azp || '') !== clientId) throw new Error('Google identity authorized party is invalid.');

  const expires = Number(claims?.exp);
  const issued = Number(claims?.iat);
  if (!Number.isFinite(expires) || expires <= nowSeconds - CLOCK_SKEW_SECONDS) throw new Error('Google identity has expired.');
  if (!Number.isFinite(issued) || issued > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error('Google identity issue time is invalid.');

  const subject = String(claims?.sub || '').trim();
  const email = String(claims?.email || '').trim().toLowerCase();
  if (!subject) throw new Error('Google identity subject is missing.');
  if (!email || claims?.email_verified !== true) throw new Error('Google email is not verified.');
  if (!approvedEmails(env).has(email)) throw new Error('This Google account is not authorized for Family Cash Flow.');

  return { sub: subject, email };
}

async function loadGoogleJwks(fetchImpl = fetch, cache = globalThis.caches?.default) {
  const request = new Request(GOOGLE_JWKS_URL, { headers: { accept: 'application/json' } });
  let response = cache ? await cache.match(request) : null;
  if (!response) {
    response = await fetchImpl(request);
    if (!response.ok) throw new Error('Google signing keys are unavailable.');
    if (cache) await cache.put(request, response.clone());
  }
  const jwks = await response.json();
  if (!Array.isArray(jwks?.keys)) throw new Error('Google signing keys are invalid.');
  return jwks.keys;
}

export async function verifyGoogleCredential(credential, env, options = {}) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('Google identity credential is invalid.');
  const header = decodeJsonSegment(parts[0], 'Google identity header');
  const claims = decodeJsonSegment(parts[1], 'Google identity claims');
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Google identity signature algorithm is invalid.');

  const keys = options.jwks || await loadGoogleJwks(options.fetchImpl, options.cache);
  const jwk = keys.find(candidate =>
    candidate?.kid === header.kid &&
    candidate?.kty === 'RSA' &&
    (!candidate.alg || candidate.alg === 'RS256') &&
    (!candidate.use || candidate.use === 'sig')
  );
  if (!jwk) throw new Error('Google signing key was not found.');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error('Google identity signature is invalid.');
  return assertGoogleClaims(claims, env, options.nowSeconds ?? Math.floor(Date.now() / 1000));
}

async function sessionKey(env) {
  const secret = String(env.SESSION_SIGNING_KEY || '');
  if (encoder.encode(secret).byteLength < 32) throw new Error('SESSION_SIGNING_KEY must contain at least 32 bytes.');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(identity, env, options = {}) {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: String(identity.sub || ''),
    email: String(identity.email || '').toLowerCase(),
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
    jti: options.jti || crypto.randomUUID(),
  };
  if (!payload.sub || !approvedEmails(env).has(payload.email)) throw new Error('Cannot create a session for an unauthorized identity.');
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(body)));
  return `${body}.${base64UrlEncode(signature)}`;
}

export async function verifySession(token, env, options = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await sessionKey(env),
      base64UrlDecode(parts[1]),
      encoder.encode(parts[0])
    );
    if (!valid) return null;
    const payload = decodeJsonSegment(parts[0], 'session');
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (payload?.v !== 1 || !payload.sub || !Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= nowSeconds) return null;
    const email = String(payload.email || '').toLowerCase();
    if (!approvedEmails(env).has(email)) return null;
    return { sub: String(payload.sub), email, expiresAt: Number(payload.exp) };
  } catch (error) {
    return null;
  }
}

export function readSessionCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) return part.slice(separator + 1).trim();
  }
  return '';
}

export function createSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function authenticateRequest(request, env, options = {}) {
  return verifySession(readSessionCookie(request), env, options);
}

export const authConstants = Object.freeze({ SESSION_COOKIE, SESSION_TTL_SECONDS, GOOGLE_JWKS_URL });
