import { list } from '@vercel/blob';

// Data endpoint for the private dashboard (/stats). Requires ?key=STATS_KEY.
// Opening it without ?format=json redirects to the dashboard page.
const REGIONS = {
  IN: { KA: 'Karnataka', MH: 'Maharashtra', TG: 'Telangana', TN: 'Tamil Nadu', DL: 'Delhi', AP: 'Andhra Pradesh', KL: 'Kerala', HR: 'Haryana', UP: 'Uttar Pradesh', GJ: 'Gujarat', WB: 'West Bengal', RJ: 'Rajasthan', PB: 'Punjab', OR: 'Odisha' },
  AE: { DU: 'Dubai', AZ: 'Abu Dhabi', SH: 'Sharjah', AJ: 'Ajman', RK: 'Ras Al Khaimah', FU: 'Fujairah', UQ: 'Umm Al Quwain' },
  US: { CA: 'California', NY: 'New York', TX: 'Texas', WA: 'Washington' },
};

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor && out.length < 20000);
  return out;
}
const parts = (b, prefix) => b.pathname.slice(prefix.length).replace(/\.json$/, '').split('~').map((x) => {
  try { return decodeURIComponent(x); } catch { return x; }
});
const nums = (s) => (s === '0' ? [] : s.split('.').map((x) => parseInt(x, 36) || 0));

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const key = url.searchParams.get('key');
  if (!process.env.STATS_KEY || key !== process.env.STATS_KEY) return res.status(404).send('Not found');
  if (url.searchParams.get('format') !== 'json') {
    res.setHeader('Location', `/stats/?key=${encodeURIComponent(key)}`);
    return res.status(302).end();
  }

  const [visitBlobs, readBlobs] = await Promise.all([listAll('visits/'), listAll('reads/')]);

  // Reads are cumulative snapshots. Keep the fullest one per session, and union every link clicked.
  const reads = {};
  for (const b of readBlobs) {
    const [sid, depth, secs, sec, d, bl, c] = parts(b, 'reads/');
    const r = reads[sid] || (reads[sid] = { depth: 0, secs: -1, sec: 0, d: [], b: [], c: new Set() });
    r.depth = Math.max(r.depth, +depth || 0);
    r.sec = Math.max(r.sec, +sec || 0);
    if ((+secs || 0) > r.secs) { r.secs = +secs || 0; r.d = nums(d || '0'); r.b = nums(bl || '0'); }
    if (c && c !== '0') c.split('.').forEach((x) => r.c.add(x));
  }

  const visits = visitBlobs.map((b) => {
    const p = parts(b, 'visits/');
    const [, country, region, city, device, os, ref, src, med, camp, cont, browser, vid, sid, ret, vw] = p;
    const r = sid !== '-' ? reads[sid] : null;
    const cap = (s) => (s && s !== '-' ? s[0].toUpperCase() + s.slice(1) : s);
    return {
      at: new Date(b.uploadedAt).getTime(), country, region, regionName: REGIONS[country]?.[region] || region, city,
      device: cap(device), os, browser, ref, src, med, camp, cont, vid, sid, returning: ret === 'r', vw,
      tracked: !!r, depth: r ? r.depth : null, secs: r ? Math.max(0, r.secs) : null, sec: r ? r.sec : null,
      d: r ? r.d : [], b: r ? r.b : [], c: r ? [...r.c] : [],
    };
  }).sort((a, b) => b.at - a.at);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ now: Date.now(), visits });
}
