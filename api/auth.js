import crypto from 'node:crypto';
import { put, list } from '@vercel/blob';
import { isAuthed, makeSession, sessionCookie, makeChallenge, checkChallenge, passwordOk, sha256, clientHash } from './_auth.js';

// Login for the private /track dashboard.
//  - password: checked here on the server (STATS_PASSWORD env var), never in the page.
//  - Touch ID / passkey: after a password login a device can register a platform passkey; the server verifies
//    the WebAuthn signature against the stored public key. Either path sets a short-lived HttpOnly session cookie (12h max, and the dashboard locks itself on every page load).
//  - failed attempts are counted per (keyed-hash of) visitor and locked after 8 in 10 minutes.
const WINDOW = 10 * 60 * 1000, MAX_FAILS = 8;

async function tooMany(h) {
  const r = await list({ prefix: `fails/${h}~`, limit: 100 });
  const recent = r.blobs.filter((b) => Date.now() - parseInt(b.pathname.split('~')[1], 36) < WINDOW);
  return recent.length >= MAX_FAILS;
}
const fail = (h) => put(`fails/${h}~${Date.now().toString(36)}~${Math.random().toString(36).slice(2, 6)}.json`, '{}', { access: 'private', contentType: 'application/json', addRandomSuffix: false }).catch(() => {});
async function creds() {
  const r = await list({ prefix: 'auth/', limit: 100 });
  return r.blobs.map((b) => { const [id, spki] = b.pathname.slice(5).replace(/\.json$/, '').split('~'); return { id, spki }; });
}
const ok = (res, extra = {}) => { res.setHeader('Set-Cookie', sessionCookie(makeSession(0.5), null)); return res.status(200).json({ ok: true, ...extra }); };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const host = String(req.headers.host || '');
  const rpId = host.split(':')[0];
  const origin = `https://${host}`;
  let b = {};
  try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  const action = req.method === 'GET' ? 'status' : b.action;
  const h = clientHash(req);

  if (action === 'status') return res.status(200).json({ authed: isAuthed(req), passkeys: (await creds().catch(() => [])).length });
  if (req.method !== 'POST') return res.status(405).end();

  if (action === 'logout') { res.setHeader('Set-Cookie', sessionCookie('', 0)); return res.status(200).json({ ok: true }); }

  if (action === 'login') {
    if (await tooMany(h).catch(() => false)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    if (passwordOk(b.password)) return ok(res);
    await fail(h); await new Promise((r) => setTimeout(r, 700));
    return res.status(401).json({ error: 'That is not it.' });
  }

  // ---- Touch ID / passkeys ----
  if (action === 'auth-options') {
    const list_ = await creds().catch(() => []);
    return res.status(200).json({ challenge: makeChallenge(), rpId, ids: list_.map((c) => c.id) });
  }
  if (action === 'auth-verify') {
    try {
      if (await tooMany(h)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      const authData = Buffer.from(b.authenticatorData, 'base64url'), cdj = Buffer.from(b.clientDataJSON, 'base64url'), sig = Buffer.from(b.signature, 'base64url');
      const cd = JSON.parse(cdj.toString());
      const cred = (await creds()).find((c) => c.id === b.id);
      const good = cred && cd.type === 'webauthn.get' && cd.origin === origin
        && checkChallenge(Buffer.from(cd.challenge, 'base64url').toString())
        && authData.subarray(0, 32).equals(sha256(rpId)) && (authData[32] & 1) && (authData[32] & 4);
      if (good) {
        const key = crypto.createPublicKey({ key: Buffer.from(cred.spki, 'base64url'), format: 'der', type: 'spki' });
        const data = Buffer.concat([authData, sha256(cdj)]);
        const valid = key.asymmetricKeyType === 'ec' ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig) : crypto.verify('sha256', data, key, sig);
        if (valid) return ok(res);
      }
    } catch { /* fall through */ }
    await fail(h); await new Promise((r) => setTimeout(r, 700));
    return res.status(401).json({ error: 'Touch ID did not match.' });
  }

  // registering a passkey needs an already-unlocked session
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unlock with the password first.' });
  if (action === 'reg-options') return res.status(200).json({ challenge: makeChallenge(), rpId });
  if (action === 'reg-verify') {
    try {
      const cd = JSON.parse(Buffer.from(b.clientDataJSON, 'base64url').toString());
      if (cd.type !== 'webauthn.create' || cd.origin !== origin || !checkChallenge(Buffer.from(cd.challenge, 'base64url').toString())) throw new Error('bad');
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(b.id) || !/^[A-Za-z0-9_-]{60,700}$/.test(b.publicKey)) throw new Error('bad');
      crypto.createPublicKey({ key: Buffer.from(b.publicKey, 'base64url'), format: 'der', type: 'spki' });
      if ((await creds()).length >= 5) return res.status(400).json({ error: 'Passkey limit reached.' });
      await put(`auth/${b.id}~${b.publicKey}.json`, '{}', { access: 'private', contentType: 'application/json', addRandomSuffix: false });
      return res.status(200).json({ ok: true });
    } catch { return res.status(400).json({ error: 'Could not register Touch ID.' }); }
  }
  return res.status(400).json({ error: 'Unknown action' });
}
