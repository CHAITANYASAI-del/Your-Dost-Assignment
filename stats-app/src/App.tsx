import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import jsVectorMap from 'jsvectormap'
import { RefreshCw } from 'lucide-react'
import { FunnelChart } from '@/components/charts/funnel-chart'
import { StatusBar, StatusBarLegend, StatusBarPlot, StatusBarTooltip, type StatusBarDatum } from '@/components/charts/status-bar'
import { Treemap, TreemapLegend, TreemapPlot, TreemapTooltip } from '@/components/charts/treemap'
import { Table, type TableColumn } from '@/components/motion/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/motion/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/motion/tabs'
import { NumberTicker } from '@/components/motion/number-ticker'
import { AnimatedBadge } from '@/components/motion/animated-badge'

type Visit = {
  at: number; country: string; region: string; regionName: string; city: string
  device: string; os: string; browser: string; ref: string
  src: string; med: string; camp: string; cont: string
  vid: string; sid: string; returning: boolean; vw: string
  tracked: boolean; depth: number | null; secs: number | null; sec: number | null
  d: number[]; b: number[]; c: string[]; t: Record<string, number>
}
type Manifest = {
  sections: { id: string; label: string }[]
  blocks: { id: string; section: string; kind: string; label: string }[]
  events: { code: string; label: string }[]
}

const COUNTRY: Record<string, string> = { IN: 'India', AE: 'United Arab Emirates', SA: 'Saudi Arabia', PK: 'Pakistan', US: 'United States', GB: 'United Kingdom', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', BH: 'Bahrain', SG: 'Singapore', DE: 'Germany', EG: 'Egypt', JO: 'Jordan', CA: 'Canada', AU: 'Australia', NL: 'Netherlands', FR: 'France', IE: 'Ireland' }
const SOCIAL_COLOR: Record<string, string> = { LinkedIn: '#0A66C2', WhatsApp: '#1DA851', Instagram: '#D62976', Facebook: '#1877F2', X: '#171717', Gmail: '#EA4335', Google: '#4285F4', Slack: '#E01E5A', Telegram: '#229ED9', Outlook: '#0078D4', 'Direct / unknown': '#A3A3A3' }
const IST = 19800000
const FUNNEL = ['#0B3D91', '#0F52BA', '#1665D8', '#1677F2', '#4D9AF5', '#82BAF8', '#B5D6FB']
const CONTACT = ['email', 'portfolio', 'linkedin', 'github']
const PROTO = ['ctaproto', 'openp1', 'openp2', 'usep1', 'usep2']

const flag = (cc: string) => /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : '🏳️'
const ist = (ms: number, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o })
const fmtSecs = (s: number | null) => s == null ? '–' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
const SCOPE: Record<string, string> = { pg: 'Page', p1: 'Accounts Today prototype', p2: 'your Journey prototype' }
const tapName = (k: string) => { const t = k.slice(k.indexOf('_') + 1).replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : k }
const pct = (a: number, b: number) => b ? Math.round(a / b * 100) : 0

function social(v: Visit) {
  const h = (v.ref || '-').toLowerCase()
  if (h.includes('linkedin') || h === 'lnkd.in' || v.browser === 'LinkedIn in-app') return 'LinkedIn'
  if (h.includes('whatsapp') || h === 'wa.me' || v.browser === 'WhatsApp in-app') return 'WhatsApp'
  if (h.includes('instagram') || v.browser === 'Instagram in-app') return 'Instagram'
  if (h.includes('facebook') || h === 'fb.com') return 'Facebook'
  if (h === 't.co' || h.includes('twitter') || h === 'x.com') return 'X'
  if (h.includes('mail.google')) return 'Gmail'
  if (h.includes('google.')) return 'Google'
  if (h.includes('slack')) return 'Slack'
  if (h === 't.me' || h.includes('telegram')) return 'Telegram'
  if (h.includes('outlook') || h.includes('live.com') || h.includes('office.com')) return 'Outlook'
  return 'Direct / unknown'
}
function tally<T>(list: T[], fn: (v: T) => string | null) {
  const m = new Map<string, number>()
  for (const v of list) { const k = fn(v); if (k != null) m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const avg = (a: number[]) => a.length ? sum(a) / a.length : 0

/* ---------- layout pieces ---------- */
function Panel({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ${className}`}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {right && <div className="text-xs text-muted-foreground">{right}</div>}
    </div>
    {children}
  </section>
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}
function BarList({ pairs, icon, hl, limit = 8, unit, empty = 'No visits in this period' }: { pairs: [string, number][]; icon?: (k: string) => ReactNode; hl?: (k: string) => boolean; limit?: number; unit?: (n: number) => string; empty?: string }) {
  if (!pairs.length) return <Empty>{empty}</Empty>
  const max = Math.max(...pairs.map((p) => p[1]), 1)
  return <ul className="space-y-3.5">{pairs.slice(0, limit).map(([k, n]) => {
    const on = hl?.(k)
    return <li key={k}>
      <div className={`flex items-center justify-between gap-3 text-sm ${on ? 'font-semibold text-brand' : ''}`}>
        <span className="flex min-w-0 items-center gap-2">{icon?.(k)}<span className="truncate">{k}</span></span>
        <span className="tabular-nums">{unit ? unit(n) : n}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-[width] duration-500 ${on ? 'bg-brand' : 'bg-foreground/80'}`} style={{ width: `${Math.max(3, n / max * 100)}%` }} />
      </div>
    </li>
  })}</ul>
}
function Stat({ label, value, suffix, change, context, highlight }: { label: string; value: number; suffix?: string; change?: number | null; context: string; highlight?: boolean }) {
  return <div className={`rounded-xl border p-4 ${highlight ? 'border-brand/30 bg-brand-soft/40' : 'bg-background'}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {change != null && <AnimatedBadge size="sm" status={change > 0 ? 'success' : change < 0 ? 'danger' : 'neutral'} showIcon={false}>{change > 0 ? '+' : ''}{change}%</AnimatedBadge>}
    </div>
    <NumberTicker value={value} suffix={suffix} className={`mt-2 block text-3xl font-semibold tracking-tight ${highlight ? 'text-brand' : ''}`} />
    <p className="mt-1 truncate text-xs text-muted-foreground">{context}</p>
  </div>
}
function Heat({ value, max }: { value: number; max: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(value ? 4 : 0, value / Math.max(max, 1) * 100)}%` }} /></div>
}

function WorldMap({ values }: { values: Record<string, number> }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let map: { destroy: () => void } | null = null
    let cancelled = false
    ;(window as unknown as { jsVectorMap: typeof jsVectorMap }).jsVectorMap = jsVectorMap
    import('jsvectormap/dist/maps/world.js').then(() => {
      if (cancelled || !el.current) return
      el.current.innerHTML = ''
      const m = new jsVectorMap({
        selector: el.current, map: 'world', backgroundColor: 'transparent', zoomButtons: false, zoomOnScroll: false,
        regionStyle: { initial: { fill: '#E5E5E5', stroke: '#FFFFFF', strokeWidth: .5 }, hover: { fillOpacity: .8 } },
        onRegionTooltipShow(_e: unknown, tip: { text: (t?: string) => string }, code: string) {
          const n = values[code] || 0
          tip.text(`${tip.text()} · ${n} visit${n === 1 ? '' : 's'}`)
        },
      })
      const top = Math.max(1, ...Object.values(values))
      const mix = (t: number) => { const a = [191, 219, 254], b = [22, 119, 242]; return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})` }
      for (const [code, n] of Object.entries(values)) {
        const color = mix(top === 1 ? 1 : (n - 1) / (top - 1) * .7 + .3)
        const reg = (m as unknown as { regions?: Record<string, { element?: { setStyle?: (k: string, v: string) => void } }> }).regions?.[code]
        reg?.element?.setStyle?.('fill', color)
        el.current.querySelectorAll(`[data-code="${code}"]`).forEach((p) => p.setAttribute('fill', color))
      }
      map = m as unknown as { destroy: () => void }
    })
    return () => { cancelled = true; try { map?.destroy() } catch { /* already gone */ } }
  }, [values])
  return <div ref={el} className="h-64 w-full" />
}

/* ---------- page ---------- */
export default function App() {
  const key = useMemo(() => new URLSearchParams(location.search).get('key') || '', [])
  const [data, setData] = useState<{ now: number; visits: Visit[] } | null>(null)
  const [man, setMan] = useState<Manifest | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [range, setRange] = useState('30')
  const [gran, setGran] = useState('day')
  const [bsec, setBsec] = useState('all')
  const [tscope, setTscope] = useState('all')
  const [sel, setSel] = useState<string | null>(null)
  const [spin, setSpin] = useState(false)

  const load = useCallback(async () => {
    setSpin(true)
    try {
      const r = await fetch(`/api/visits?format=json&key=${encodeURIComponent(key)}`, { cache: 'no-store' })
      if (!r.ok) throw new Error('denied')
      setData(await r.json()); setState('ok')
    } catch { setState('denied') } finally { setTimeout(() => setSpin(false), 400) }
  }, [key])
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])
  useEffect(() => { fetch('/track-manifest.json', { cache: 'no-store' }).then((r) => r.json()).then(setMan).catch(() => {}) }, [])

  const view = useMemo(() => {
    if (!data || !man) return null
    const days = +range, now = data.now, span = days * 86400000, all = data.visits
    const cur = days ? all.filter((v) => v.at > now - span) : all
    const prev = days ? all.filter((v) => v.at > now - 2 * span && v.at <= now - span) : null
    const uniq = (l: Visit[]) => new Set(l.map((v) => v.vid !== '-' ? v.vid : v.sid !== '-' ? v.sid : String(v.at))).size
    const tracked = (l: Visit[]) => l.filter((v) => v.tracked)
    const delta = (a: number, b: number | null) => (b == null || b === 0) ? null : Math.round((a - b) / b * 100)
    const tr = tracked(cur)
    const S = man.sections
    const ended = tr.filter((v) => (v.sec || 0) >= S.length - 2 || (v.depth || 0) >= 95)
    const clickedAny = (v: Visit, set: string[]) => v.c.some((x) => set.includes(x))

    // Activity strip: one bar per day (or hour), shaded by how many visits it had.
    const g = days === 1 ? 'hour' : gran
    const step = g === 'hour' ? 3600000 : 86400000
    const floor = (ms: number) => Math.floor((ms + IST) / step) * step - IST
    const first = days ? now - span : (all.length ? Math.min(...all.map((v) => v.at)) : now)
    const start = Math.max(floor(first), floor(now) - (g === 'hour' ? 71 : 89) * step)
    const counts = new Map<number, number>()
    for (const v of cur) counts.set(floor(v.at), (counts.get(floor(v.at)) || 0) + 1)
    const strip: StatusBarDatum[] = []
    for (let t = start; t <= floor(now); t += step) {
      const n = counts.get(t) || 0
      strip.push({
        id: String(t),
        label: g === 'hour' ? ist(t, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ist(t, { weekday: 'short', day: 'numeric', month: 'short' }),
        status: n === 0 ? 'none' : n === 1 ? 'one' : n <= 3 ? 'few' : 'many',
        description: `${n} visit${n === 1 ? '' : 's'}`,
      })
    }

    // Per-section attention
    const sections = S.map((s, i) => {
      const reached = i === 0 ? tr.length : tr.filter((v) => (v.sec || 0) >= i).length
      const dw = tr.map((v) => v.d[i] || 0).filter((x) => x > 0)
      return { ...s, i, reached, readers: dw.length, avg: Math.round(avg(dw)), total: sum(dw) }
    })
    // Per-block ("row") attention
    const blocks = man.blocks.map((b, j) => {
      const dw = tr.map((v) => v.b[j] || 0).filter((x) => x >= 2)
      return { ...b, j, viewers: dw.length, avg: Math.round(avg(dw)), total: sum(dw) }
    })
    // Clicks
    const clicks = man.events.map((e) => ({ ...e, n: tr.filter((v) => v.c.includes(e.code)).length }))
    // Engagement quality
    const secsList = tr.map((v) => v.secs || 0)
    const buckets: [string, number][] = [
      ['Bounced · under 10s', secsList.filter((x) => x < 10).length],
      ['Skimmed · 10–60s', secsList.filter((x) => x >= 10 && x < 60).length],
      ['Read · 1–3 min', secsList.filter((x) => x >= 60 && x < 180).length],
      ['Studied · 3 min+', secsList.filter((x) => x >= 180).length],
    ]
    const milestones: [string, number][] = [25, 50, 75, 90, 100].map((m) => [`${m}% of the page`, tr.filter((v) => (v.depth || 0) >= m).length])
    const evMap: Record<string, string> = Object.fromEntries(man.events.map((e) => [e.code, e.label]))
    const tapAgg = new Map<string, { n: number; readers: number }>()
    for (const v of tr) for (const [k, n] of Object.entries(v.t || {})) { const a = tapAgg.get(k) || { n: 0, readers: 0 }; a.n += n; a.readers++; tapAgg.set(k, a) }
    const taps = [...tapAgg.entries()].map(([k, a]) => ({ id: k, scope: k.slice(0, k.indexOf('_')), where: SCOPE[k.slice(0, k.indexOf('_'))] || 'Page', label: evMap[k.slice(k.indexOf('_') + 1)] || tapName(k), ...a })).sort((a, b) => b.n - a.n)
    const hours = tally(cur, (v) => ist(v.at, { hour: 'numeric', hour12: true }).toUpperCase())

    return {
      days, cur, g, strip, tr, S, sections, blocks, clicks, buckets, milestones, hours, taps,
      m: {
        total: cur.length, totalD: delta(cur.length, prev?.length ?? null),
        uniq: uniq(cur), uniqD: delta(uniq(cur), prev ? uniq(prev) : null),
        ret: cur.filter((v) => v.returning).length,
        ended: ended.length, endedShare: tr.length ? pct(ended.length, tr.length) : null,
        avg: Math.round(avg(secsList)),
        contact: tr.filter((v) => clickedAny(v, CONTACT)).length,
        proto: tr.filter((v) => clickedAny(v, PROTO)).length,
        tapsTotal: sum(taps.map((t) => t.n)),
      },
      funnel: S.map((s, i) => ({ id: `s${i}`, label: s.label, color: FUNNEL[i % FUNNEL.length], value: i === 0 ? tr.length : tr.filter((v) => (v.sec || 0) >= i).length })),
      countries: Object.fromEntries(tally(cur, (v) => v.country === '-' ? null : v.country)),
      sources: tally(cur, social),
    }
  }, [data, man, range, gran])

  if (state === 'denied') return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Not found.</div>
  if (!view || !man) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>

  const { cur, m, days, S } = view
  const evLabel = (c: string) => man.events.find((e) => e.code === c)?.label || c
  const rows = cur.slice(0, 500).map((v, i) => ({
    id: `${v.at}-${i}`, v, at: v.at, city: v.city, state: v.regionName, country: v.country, device: `${v.device} · ${v.os}`,
    source: v.src !== '-' ? [v.src, v.cont].filter((x) => x !== '-').join(' · ') : social(v), utm: v.src !== '-',
    got: v.tracked ? (v.sec || 0) : -1, depth: v.depth, secs: v.tracked ? (v.secs ?? 0) : -1, clicks: v.c.length,
  }))
  type Row = typeof rows[number]
  const columns: TableColumn<Row>[] = [
    { key: 'at', header: 'When (IST)', sortable: true, width: '140px', cell: (r) => ist(r.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
    { key: 'city', header: 'Location', sortable: true, width: '180px', cell: (r) => <span className="truncate">{flag(r.country)} {r.city}{r.state !== '-' && r.state !== r.city ? `, ${r.state}` : ''}</span> },
    { key: 'device', header: 'Device', sortable: true, width: '140px' },
    { key: 'source', header: 'Source', sortable: true, width: '150px', cell: (r) => r.utm ? <AnimatedBadge size="sm" status="success" showIcon={false}>{r.source}</AnimatedBadge> : r.source },
    { key: 'visitor', header: 'Visitor', width: '100px', cell: (r) => r.v.returning ? <AnimatedBadge size="sm" status="success" showIcon={false}>Returning</AnimatedBadge> : <span className="text-muted-foreground">New</span> },
    { key: 'got', header: 'Got to', sortable: true, width: '170px', cell: (r) => r.got < 0 ? <span className="text-muted-foreground">–</span> : <span>{S[r.got]?.label}{r.depth != null && <span className="text-muted-foreground"> · {r.depth}%</span>}</span> },
    { key: 'clicks', header: 'Clicks', sortable: true, align: 'right', width: '80px', cell: (r) => r.clicks ? r.clicks : <span className="text-muted-foreground">–</span> },
    { key: 'secs', header: 'Active time', sortable: true, align: 'right', cell: (r) => r.secs < 0 ? <span className="text-muted-foreground">–</span> : fmtSecs(r.secs) },
  ]
  const legend = Object.entries(view.countries).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const cmp = days ? `vs previous ${days === 1 ? '24 hours' : days + ' days'}` : 'All time'

  const blockRows = view.blocks.filter((b) => bsec === 'all' || b.section === bsec).map((b) => ({ ...b, id: b.id, secLabel: S.find((s) => s.id === b.section)?.label || b.section }))
  type BRow = typeof blockRows[number]
  const bmax = Math.max(1, ...view.blocks.map((b) => b.avg))
  const bcols: TableColumn<BRow>[] = [
    { key: 'secLabel', header: 'Section', sortable: true, width: '190px' },
    { key: 'label', header: 'Block', sortable: true, width: '300px', cell: (r) => <span className="truncate"><span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{r.kind}</span>{r.label}</span> },
    { key: 'viewers', header: 'Seen by', sortable: true, align: 'right', width: '110px', cell: (r) => view.tr.length ? `${r.viewers} · ${pct(r.viewers, view.tr.length)}%` : '–' },
    { key: 'avg', header: 'Avg time', sortable: true, align: 'right', width: '100px', cell: (r) => r.viewers ? fmtSecs(r.avg) : <span className="text-muted-foreground">–</span> },
    { key: 'total', header: 'Total time', sortable: true, align: 'right', width: '110px', cell: (r) => r.total ? fmtSecs(r.total) : <span className="text-muted-foreground">–</span> },
    { key: 'heat', header: 'Attention', width: '140px', cell: (r) => <Heat value={r.avg} max={bmax} /> },
  ]

  const tapRows = view.taps.filter((t) => tscope === 'all' || t.scope === tscope)
  type TRow = typeof tapRows[number]
  const tmax = Math.max(1, ...view.taps.map((t) => t.n))
  const tcols: TableColumn<TRow>[] = [
    { key: 'where', header: 'Where', sortable: true, width: '230px' },
    { key: 'label', header: 'Tapped', sortable: true, width: '260px' },
    { key: 'n', header: 'Taps', sortable: true, align: 'right', width: '90px' },
    { key: 'readers', header: 'Readers', sortable: true, align: 'right', width: '130px', cell: (r) => `${r.readers} · ${pct(r.readers, view.tr.length)}%` },
    { key: 'heat', header: 'Share', width: '160px', cell: (r) => <Heat value={r.n} max={tmax} /> },
  ]

  const chosen = sel ? cur.find((v, i) => `${v.at}-${i}` === sel) : null
  const maxSecDwell = chosen ? Math.max(1, ...chosen.d) : 1

  return <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <a href="/" target="_blank" rel="noopener" className="text-lg font-semibold tracking-tight hover:underline">YourDOST assignment · case study</a>
        <p className="mt-1 text-sm text-muted-foreground">Who opened the case study, from where, how far they read, and what held their attention. Times in IST.</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={range} onValueChange={setRange} className="w-44">
          <SelectTrigger><SelectValue placeholder="Period" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="0">All time</SelectItem>
          </SelectContent>
        </Select>
        <button onClick={load} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-medium shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:bg-muted active:scale-[.97]">
          <RefreshCw className={`size-4 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh
        </button>
      </div>
    </header>

    <Panel title="Metrics" right={cmp}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total visits" value={m.total} change={m.totalD} context="One per browser session" />
        <Stat label="Unique readers" value={m.uniq} change={m.uniqD} context={`${m.ret} came back`} />
        <Stat label="Avg active time" value={m.avg} suffix="s" context="Tab in view and interacting" />
        <Stat label="Read to the end" value={m.ended} highlight context={m.endedShare != null ? `${m.endedShare}% of tracked readers` : 'No tracked readers yet'} />
        <Stat label="Used a prototype" value={m.proto} context={`${pct(m.proto, view.tr.length)}% of tracked readers`} />
        <Stat label="Clicked a contact link" value={m.contact} context={`${pct(m.contact, view.tr.length)}% · email, portfolio, LinkedIn, GitHub`} />
        <Stat label="Tracked readers" value={view.tr.length} context={`${pct(view.tr.length, m.total)}% of visits sent read data`} />
        <Stat label="Button & link taps" value={m.tapsTotal} context={view.tr.length ? `${(m.tapsTotal / view.tr.length).toFixed(1)} per tracked reader` : 'No tracked readers yet'} />
      </div>
    </Panel>

    <Panel title="Visits" className="mt-4" right={days === 1 ? 'Hourly' : (
      <Tabs value={gran} onValueChange={setGran} variant="segment">
        <TabsList><TabsTrigger value="day">Day</TabsTrigger><TabsTrigger value="hour">Hour</TabsTrigger></TabsList>
      </Tabs>)}>
      <StatusBar key={`${view.g}-${range}`} data={view.strip} label="Visits over time" statuses={[
        { id: 'none', label: 'No visits', color: '#E5E5E5' },
        { id: 'one', label: '1 visit', color: '#B5D6FB' },
        { id: 'few', label: '2–3 visits', color: '#4D9AF5' },
        { id: 'many', label: '4+ visits', color: '#0F52BA' },
      ]}>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{cur.length} visit{cur.length === 1 ? '' : 's'}</span>
          <span className="text-xs text-muted-foreground">{view.g === 'hour' ? 'Each bar is one hour' : 'Each bar is one day'}</span>
        </div>
        <StatusBarPlot />
        <StatusBarTooltip />
        <StatusBarLegend />
      </StatusBar>
    </Panel>

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Panel title="How far they read" right={`${view.tr.length} tracked reader${view.tr.length === 1 ? '' : 's'}`}>
        {view.tr.length
          ? <FunnelChart key={`f-${range}-${view.tr.length}`} stages={view.funnel} unit="readers" label="Readers reaching each section" />
          : <Empty>Reading data appears once someone scrolls the page.</Empty>}
      </Panel>
      <Panel title="Attention by section" right="Avg seconds, among readers who stopped there">
        {view.tr.length ? <ul className="space-y-3.5">{view.sections.map((s) => <li key={s.id}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{s.label}</span>
            <span className="tabular-nums text-muted-foreground"><b className="font-semibold text-foreground">{s.readers ? fmtSecs(s.avg) : '–'}</b> · {pct(s.reached, view.tr.length)}% reached</span>
          </div>
          <div className="mt-1.5"><Heat value={s.avg} max={Math.max(1, ...view.sections.map((x) => x.avg))} /></div>
        </li>)}</ul> : <Empty>No tracked readers yet</Empty>}
      </Panel>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Panel title="Scroll depth" right="Readers who got this far">
        <BarList pairs={view.milestones} unit={(n) => `${n} · ${pct(n, view.tr.length)}%`} empty="No tracked readers yet" />
      </Panel>
      <Panel title="Engagement quality" right="By active time">
        <BarList pairs={view.buckets} unit={(n) => `${n} · ${pct(n, view.tr.length)}%`} empty="No tracked readers yet" />
      </Panel>
      <Panel title="What they clicked" right="Readers">
        <BarList pairs={view.clicks.filter((c) => c.n > 0).sort((a, b) => b.n - a.n).map((c) => [c.label, c.n] as [string, number])} limit={10} empty="No clicks recorded yet" />
      </Panel>
    </div>

    <Panel title="Every button & link tapped" className="mt-4" right={
      <Tabs value={tscope} onValueChange={setTscope} variant="segment">
        <TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="pg">Page</TabsTrigger><TabsTrigger value="p1">Accounts prototype</TabsTrigger><TabsTrigger value="p2">Journey prototype</TabsTrigger></TabsList>
      </Tabs>}>
      <p className="mb-3 text-xs text-muted-foreground">Every tap on a button, link or tappable element, on the case study and inside both live prototypes. Taps are the total number; readers are how many different people tapped it.</p>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <Table data={tapRows} columns={tcols} getRowId={(r) => r.id} defaultSort={{ key: 'n', direction: 'desc' }} rowHeight={44} height={Math.min(480, 52 + Math.max(1, tapRows.length) * 44)} emptyState="No taps recorded yet" />
        </div>
      </div>
    </Panel>

    <Panel title="Row-by-row attention" className="mt-4" right={
      <Select value={bsec} onValueChange={setBsec} className="w-56">
        <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sections</SelectItem>
          {S.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>}>
      <p className="mb-3 text-xs text-muted-foreground">Every card, table row, list item and prototype on the page. A block counts as seen when at least half of it is on screen for 2 seconds or more.</p>
      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <Table data={blockRows} columns={bcols} getRowId={(r) => r.id} defaultSort={{ key: 'avg', direction: 'desc' }} rowHeight={44} height={Math.min(520, 52 + Math.max(1, blockRows.length) * 44)} emptyState="No blocks" />
        </div>
      </div>
    </Panel>

    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <Panel title="Top cities" right="Visits">
        <BarList pairs={tally(cur, (v) => v.city === '-' ? 'Unknown' : `${v.city}, ${v.country}`)} icon={(k) => <span>{flag(k.slice(-2))}</span>} />
      </Panel>
      <Panel title="Top countries" right="Visits">
        <WorldMap values={view.countries} />
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.length ? legend.map(([c, n]) => <span key={c}>{flag(c)} {COUNTRY[c] || c} <b className="font-semibold text-foreground">{n}</b></span>) : 'No visits in this period'}
        </div>
      </Panel>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Panel title="Traffic sources" right="Visits">
        {view.sources.length
          ? <Treemap key={`t-${range}`} data={view.sources.map(([k, n]) => ({ id: k, label: k, value: n, color: SOCIAL_COLOR[k] || '#737373' }))} label="Visits by source" formatValue={(v) => `${v} visit${v === 1 ? '' : 's'}`}>
              <TreemapPlot className="h-56" />
              <TreemapTooltip />
              <TreemapLegend showValues className="mt-3" />
            </Treemap>
          : <Empty>No visits in this period</Empty>}
      </Panel>
      <Panel title="When they read (IST)" right="Visits by hour"><BarList pairs={view.hours} limit={8} /></Panel>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Panel title="Top states" right="Visits"><BarList pairs={tally(cur, (v) => `${v.regionName === '-' ? 'Unknown' : v.regionName}, ${v.country}`)} icon={(k) => <span>{flag(k.slice(-2))}</span>} /></Panel>
      <Panel title="Referrers" right="Visits"><BarList pairs={tally(cur, (v) => v.ref === '-' ? 'Direct / unknown' : v.ref)} /></Panel>
      <Panel title="UTM sources" right="Visits"><BarList pairs={tally(cur, (v) => v.src === '-' ? 'No UTM (plain link)' : [v.src, v.cont].filter((x) => x && x !== '-').join(' · '))} /></Panel>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-4">
      <Panel title="Devices" right="Visits"><BarList pairs={tally(cur, (v) => v.device === '-' ? 'Unknown' : v.device)} /></Panel>
      <Panel title="Operating systems" right="Visits"><BarList pairs={tally(cur, (v) => v.os === '-' ? 'Unknown' : v.os)} /></Panel>
      <Panel title="Browsers" right="Visits"><BarList pairs={tally(cur.filter((v) => v.browser !== '-'), (v) => v.browser)} /></Panel>
      <Panel title="Screen size" right="Visits"><BarList pairs={tally(cur, (v) => v.vw === 'S' ? 'Phone' : v.vw === 'M' ? 'Tablet / small laptop' : v.vw === 'L' ? 'Desktop' : null)} /></Panel>
    </div>

    <Panel title="Recent visitors" className="mt-4" right={`${cur.length} visit${cur.length === 1 ? '' : 's'} · select a row for the full session`}>
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          <Table data={rows} columns={columns} getRowId={(r) => r.id} selectable onSelectionChange={(ids) => setSel(ids.length ? ids[ids.length - 1] : null)} defaultSort={{ key: 'at', direction: 'desc' }} rowHeight={48} height={Math.min(480, 52 + Math.max(1, rows.length) * 48)} emptyState="No visits in this period" />
        </div>
      </div>
    </Panel>

    {chosen && <Panel title="Session detail" className="mt-4" right={`${flag(chosen.country)} ${chosen.city} · ${ist(chosen.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} IST`}>
      {chosen.tracked ? <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time per section</h3>
          <ul className="space-y-3">{S.map((s, i) => <li key={s.id}>
            <div className="flex justify-between text-sm"><span className="truncate">{s.label}</span><span className="tabular-nums">{fmtSecs(chosen.d[i] || 0)}</span></div>
            <div className="mt-1"><Heat value={chosen.d[i] || 0} max={maxSecDwell} /></div>
          </li>)}</ul>
        </div>
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Held their attention</h3>
          <ul className="space-y-2 text-sm">{man.blocks.map((b, j) => ({ b, t: chosen.b[j] || 0 })).filter((x) => x.t >= 2).sort((a, b) => b.t - a.t).slice(0, 10).map(({ b, t }) => <li key={b.id} className="flex justify-between gap-3"><span className="truncate">{b.label}</span><span className="tabular-nums text-muted-foreground">{fmtSecs(t)}</span></li>)}
            {!chosen.b.some((x) => x >= 2) && <li className="text-muted-foreground">Nothing stayed on screen for 2s+</li>}</ul>
        </div>
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Active time</dt><dd>{fmtSecs(chosen.secs)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Scroll depth</dt><dd>{chosen.depth}%</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Furthest section</dt><dd>{S[chosen.sec || 0]?.label}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Visitor</dt><dd>{chosen.returning ? 'Returning' : 'New'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Device</dt><dd>{chosen.device} · {chosen.os} · {chosen.browser}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Came from</dt><dd>{social(chosen)}</dd></div>
          </dl>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tapped</h3>
          <ul className="mb-4 space-y-1.5 text-sm">{Object.entries(chosen.t || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span className="truncate"><span className="text-muted-foreground">{SCOPE[k.slice(0, k.indexOf('_'))] || 'Page'} · </span>{evLabel(k.slice(k.indexOf('_') + 1)) !== k.slice(k.indexOf('_') + 1) ? evLabel(k.slice(k.indexOf('_') + 1)) : tapName(k)}</span><span className="tabular-nums text-muted-foreground">×{n}</span></li>)}
            {!Object.keys(chosen.t || {}).length && <li className="text-muted-foreground">No taps</li>}</ul>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key links</h3>
          <div className="flex flex-wrap gap-1.5">{chosen.c.length ? chosen.c.map((c) => <AnimatedBadge key={c} size="sm" status="success" showIcon={false}>{evLabel(c)}</AnimatedBadge>) : <span className="text-sm text-muted-foreground">No links clicked</span>}</div>
        </div>
      </div> : <Empty>This visit did not send reading data (closed before scrolling, or tracking was blocked).</Empty>}
    </Panel>}

    <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
      Location comes from the visitor's IP: usually right for the city, off on VPNs. No IP addresses are stored, and there are no cookies. Each browser session counts once; unique readers are counted per browser.
      Active time only counts while the tab is in view and the reader is scrolling, moving or tapping. Open the case study once with <code className="rounded bg-muted px-1">?me</code> on each of your devices so your own visits are skipped.
    </p>
  </div>
}
