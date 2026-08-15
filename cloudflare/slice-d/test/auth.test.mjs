import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authConstants,
  createSessionCookie,
  signSession,
  verifyGoogleCredential,
  verifySession,
} from '../src/auth.mjs';

const env = {
  GOOGLE_CLIENT_ID: 'client.example.apps.googleusercontent.com',
  APPROVED_GOOGLE_EMAILS: 'approved@example.com,second@example.com',
  SESSION_SIGNING_KEY: 'slice-d-test-signing-key-that-is-longer-than-thirty-two-bytes',
};

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function googleFixture(overrides = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const now = 1786723200;
  const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
  const claims = {
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    exp: now + 3600,
    iat: now,
    sub: 'google-subject-1',
    email: 'approved@example.com',
    email_verified: true,
    ...overrides,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { credential: `${unsigned}.${Buffer.from(signature).toString('base64url')}`, jwks: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }], now };
}

test('Google credential verifies signature plus issuer, audience, expiry, subject and approved email', async () => {
  const fixture = await googleFixture();
  const identity = await verifyGoogleCredential(fixture.credential, env, { jwks: fixture.jwks, nowSeconds: fixture.now });
  assert.deepEqual(identity, { sub: 'google-subject-1', email: 'approved@example.com' });
});

test('unauthorized Google account is rejected after cryptographic verification', async () => {
  const fixture = await googleFixture({ email: 'intruder@example.com' });
  await assert.rejects(
    verifyGoogleCredential(fixture.credential, env, { jwks: fixture.jwks, nowSeconds: fixture.now }),
    /not authorized/i
  );
});

test('wrong audience, expiry and tampered signature are rejected', async () => {
  const wrongAudience = await googleFixture({ aud: 'wrong-client' });
  await assert.rejects(verifyGoogleCredential(wrongAudience.credential, env, { jwks: wrongAudience.jwks, nowSeconds: wrongAudience.now }), /audience/i);
  const expired = await googleFixture({ exp: 1786720000 });
  await assert.rejects(verifyGoogleCredential(expired.credential, env, { jwks: expired.jwks, nowSeconds: expired.now }), /expired/i);
  const valid = await googleFixture();
  const tampered = `${valid.credential.slice(0, -2)}aa`;
  await assert.rejects(verifyGoogleCredential(tampered, env, { jwks: valid.jwks, nowSeconds: valid.now }), /signature/i);
});

test('signed session is HttpOnly/Secure/SameSite and expires server-side', async () => {
  const token = await signSession({ sub: 'subject', email: 'approved@example.com' }, env, { nowSeconds: 1000, jti: 'fixed-jti' });
  assert.deepEqual(await verifySession(token, env, { nowSeconds: 1001 }), { sub: 'subject', email: 'approved@example.com', expiresAt: 1000 + authConstants.SESSION_TTL_SECONDS });
  assert.equal(await verifySession(`${token.slice(0, -1)}x`, env, { nowSeconds: 1001 }), null);
  assert.equal(await verifySession(token, env, { nowSeconds: 1000 + authConstants.SESSION_TTL_SECONDS }), null);
  assert.match(createSessionCookie(token), /HttpOnly; Secure; SameSite=Strict/);
});
