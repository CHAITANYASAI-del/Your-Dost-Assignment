import crypto from 'node:crypto';

// Shared helpers for the stats lock. The signing secret is STATS_KEY (a Vercel env var, never in the repo).
const secret = () => process.env.STATS_KEY || '';
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
export const sign = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const makeSession = (days = 7) => { const exp = Date.now() + days * 864e5; return `${exp}.${sign('s' + exp)}`; };
export const sessionCookie = (val, maxAge) => `yd_stats=${val}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export function isAuthed(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)yd_stats=([^;]+)/);
  if (!m || !secret()) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  return eq(sig, sign('s' + exp));
}

// Stateless WebAuthn challenges: random + timestamp + signature, valid for 2 minutes.
export function makeChallenge() {
  const body = `${crypto.randomBytes(16).toString('base64url')}.${Date.now().toString(36)}`;
  return `${body}.${sign('c' + body)}`;
}
export function checkChallenge(ch) {
  const p = String(ch).split('.');
  if (p.length !== 3) return false;
  const body = `${p[0]}.${p[1]}`;
  if (!eq(sign('c' + body), p[2])) return false;
  const age = Date.now() - parseInt(p[1], 36);
  return age >= 0 && age < 120000;
}

export const passwordOk = (given) => {
  const want = String(process.env.STATS_PASSWORD || '').trim().toLowerCase();
  if (!want) return false;
  const a = sha256(String(given || '').trim().toLowerCase()), b = sha256(want);
  return crypto.timingSafeEqual(a, b);
};

export const clientHash = (req) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return crypto.createHmac('sha256', secret()).update('ip' + ip).digest('hex').slice(0, 16);
};
