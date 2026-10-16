import { put } from '@vercel/blob';

// Anonymous analytics for the case study. No IP address is stored.
// Two kinds of records, encoded into the blob file name so the dashboard can list without opening files:
//  - visit: one per browser session. Vercel's IP-derived country/region/city, device, OS, browser,
//    referrer host, UTM tags, viewport size, whether the visitor has been here before, anonymous ids.
//  - read: cumulative reading state, sent when the tab is hidden/closed and every ~45s while active.
//    depth %, engaged seconds, furthest section, seconds per section, seconds per block, clicked links.
const clean = (s) => String(s || '').replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 40) || '-';
const dec = (v) => { try { return decodeURIComponent(v || ''); } catch { return v || ''; } };
const idOk = (s) => (/^[a-z0-9]{4,16}$/.test(String(s || '')) ? s : '-');
const int = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const list36 = (v, max) => (/^[a-z0-9.]{1,}$/.test(String(v || '')) && String(v).length <= max ? String(v) : '0');
const rand = () => Math.random().toString(36).slice(2, 10);

function browserOf(ua) {
  if (/FBAN|FBAV|Instagram/i.test(ua)) return 'Instagram in-app';
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn in-app';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp in-app';
  if (/GSA\//.test(ua)) return 'Google app';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox';
  if (/CriOS/.test(ua)) return 'Chrome';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const h = req.headers;
  const ua = String(h['user-agent'] || '');
  if (/bot|crawl|spider|preview|headless|lighthouse|monitor/i.test(ua)) return res.status(204).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}

  try {
    if (body.type === 'read') {
      const sid = idOk(body.sid);
      if (sid === '-') return res.status(204).end();
      const name = [sid, int(body.depth, 100), int(body.secs, 14400), int(body.sec, 9),
        list36(body.d, 80), list36(body.b, 400), list36(body.c, 200), rand()].join('~');
      await put(`reads/${name}.json`, '{}', { access: 'private', contentType: 'application/json', addRandomSuffix: false });
      return res.status(204).end();
    }

    const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Mac OS/i.test(ua) ? 'macOS'
      : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Other';
    let ref = '-';
    try { if (body.ref) ref = new URL(body.ref).hostname; } catch {}
    const utm = body.utm || {};
    const vw = int(body.vw, 10000);
    const t = new Date().toISOString();
    const f = [
      t.replace(/[:.]/g, '-'),
      clean(h['x-vercel-ip-country']), clean(h['x-vercel-ip-country-region']), clean(dec(h['x-vercel-ip-city'])),
      device, os, clean(ref),
      clean(utm.source), clean(utm.medium), clean(utm.campaign), clean(utm.content),
      clean(browserOf(ua)), idOk(body.vid), idOk(body.sid),
      body.ret ? 'r' : 'n', vw < 640 ? 'S' : vw < 1100 ? 'M' : 'L', rand(),
    ];
    await put(`visits/${f.map(encodeURIComponent).join('~')}.json`, JSON.stringify({ t, ua }), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false,
    });
  } catch { /* analytics must never break the page */ }
  res.status(204).end();
}
