import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Fingerprint } from 'lucide-react'

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const enc = (s: string) => new TextEncoder().encode(s)
const PK = 'yd-pk'
const SKIP = 'yd-pk-skip'

type Reply = { ok: boolean; status: number; error?: string; [k: string]: unknown }
export async function post(action: string, body: Record<string, unknown> = {}): Promise<Reply> {
  const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, ...j }
}

export async function touchIdSupported() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}
export const hasLocalPasskey = () => { try { return !!localStorage.getItem(PK) } catch { return false } }
const skipped = () => { try { return !!localStorage.getItem(SKIP) } catch { return false } }

/** Registers this device's Touch ID (or Windows Hello / Face ID). Needs an unlocked session. */
export async function enableTouchId() {
  const o = await post('reg-options')
  if (!o.ok) throw new Error(o.error || 'Unlock with the password first.')
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: enc(o.challenge as string), rp: { name: 'YourDOST reader stats', id: o.rpId as string },
      user: { id: enc('owner'), name: 'owner', displayName: 'Owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, attestation: 'none',
    },
  }) as PublicKeyCredential | null
  if (!cred) throw new Error('Cancelled')
  const r = cred.response as AuthenticatorAttestationResponse
  const pk = r.getPublicKey?.()
  if (!pk) throw new Error('This browser cannot register Touch ID.')
  const v = await post('reg-verify', { id: cred.id, clientDataJSON: b64u(r.clientDataJSON), publicKey: b64u(pk) })
  if (!v.ok) throw new Error(v.error || 'Could not register Touch ID.')
  localStorage.setItem(PK, cred.id); localStorage.removeItem(SKIP)
}

export async function unlockWithTouchId() {
  const o = await post('auth-options')
  const all = (o.ids as string[]) || []
  if (!all.length) throw new Error('Touch ID is not set up yet. Unlock with the password first.')
  const stored = localStorage.getItem(PK)
  const ids = stored && all.includes(stored) ? [stored] : all
  const a = await navigator.credentials.get({
    publicKey: { challenge: enc(o.challenge as string), rpId: o.rpId as string, allowCredentials: ids.map((id) => ({ type: 'public-key' as const, id: fromB64u(id) })), userVerification: 'required', timeout: 60000 },
  }) as PublicKeyCredential | null
  if (!a) throw new Error('Cancelled')
  const r = a.response as AuthenticatorAssertionResponse
  const v = await post('auth-verify', { id: a.id, authenticatorData: b64u(r.authenticatorData), clientDataJSON: b64u(r.clientDataJSON), signature: b64u(r.signature) })
  if (!v.ok) throw new Error(v.error || 'Touch ID did not match.')
}

type Mode = 'idle' | 'touch' | 'checking' | 'success'

export function Lock({ onUnlocked }: { onUnlocked: () => void }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [shake, setShake] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  const [hint, setHint] = useState(false)
  const [canTid, setCanTid] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const input = useRef<HTMLInputElement>(null)
  const busy = mode === 'touch' || mode === 'checking' || mode === 'success'

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])
  useEffect(() => {
    let live = true
    ;(async () => {
      const ok = !!window.PublicKeyCredential && await touchIdSupported()
      if (!live) return
      setCanTid(ok)
      if (ok && hasLocalPasskey()) tryTouch(true)   // a registered Mac asks for Touch ID straight away
      else input.current?.focus()
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function unlocked() { setMode('success'); setTimeout(onUnlocked, 650) }
  function wrong(text: string) { setMsg(text); setPw(''); setShake(true); setTimeout(() => setShake(false), 520); setMode('idle'); setTimeout(() => input.current?.focus(), 30) }

  async function tryTouch(auto = false) {
    setMode('touch'); setMsg('')
    try { await unlockWithTouchId(); unlocked(); return } catch (e) {
      setMode('idle')
      const m = (e as Error).message
      if (!auto && m !== 'Cancelled') setMsg(m)
      input.current?.focus()
    }
  }
  async function touchButton() {
    if (busy) return
    const st = await fetch('/api/auth').then((r) => r.json()).catch(() => ({ passkeys: 0 }))
    if (hasLocalPasskey() || st.passkeys > 0) return tryTouch()
    if (!pw.trim()) { setMsg('Enter your password once to set up Touch ID on this Mac.'); input.current?.focus(); return }
    submit()
  }
  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!pw.trim() || busy) return
    setMode('checking'); setMsg('')
    const r = await post('login', { password: pw })
    if (!r.ok) return wrong(r.error === 'That is not it.' ? 'Incorrect password' : (r.error || 'Incorrect password'))
    // first unlock on a Touch ID Mac: register it in the same moment (silently skipped if declined)
    if (canTid && !hasLocalPasskey() && !skipped()) {
      try { await enableTouchId() } catch (er) { if ((er as Error).message === 'Cancelled') { try { localStorage.setItem(SKIP, '1') } catch { /* ignore */ } } }
    }
    unlocked()
  }

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: false })
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  const label = mode === 'touch' ? 'Touch the sensor…' : mode === 'checking' ? 'Checking…' : mode === 'success' ? 'Unlocked' : canTid ? 'Touch ID or Enter Password' : 'Enter Password'

  return <div className={`yd-lock fixed inset-0 overflow-hidden text-white ${mode === 'success' ? 'yd-out' : ''}`} style={{ backgroundColor: '#1b1b1d', backgroundImage: "url('/assets/lock-bg.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
    <div className="yd-veil absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,0) 35%, rgba(20,6,0,.42) 100%)' }} />
    <div className="relative z-10 flex h-full flex-col items-center px-6">
      <div className="mt-[9vh] text-center drop-shadow-[0_2px_24px_rgba(0,0,0,.45)]">
        <div className="text-lg font-medium text-white/85">{date}</div>
        <div className="text-[84px] font-semibold leading-none tracking-tight sm:text-[104px]">{time}</div>
      </div>

      <div className="mt-auto mb-[12vh] flex w-full max-w-[290px] flex-col items-center">
        <div className={`yd-avatar relative ${mode === 'touch' ? 'yd-scan' : ''}`}>
          <img src="/assets/avatar-hq.gif" alt="" className="size-24 rounded-full object-cover shadow-[0_10px_30px_rgba(11,42,85,.35)] ring-2 ring-white/70" />
          {mode === 'success' && <span className="yd-pop absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-white"><Check className="size-4" strokeWidth={3} aria-hidden="true" /></span>}
        </div>
        <div className="mt-3 text-xl font-semibold drop-shadow-[0_1px_8px_rgba(11,42,85,.4)]">Chaitanya Sai</div>

        <form onSubmit={submit} className={`mt-4 w-full ${shake ? 'yd-shake' : ''}`}>
          <div className="relative">
            <input ref={input} type="password" value={pw} onChange={(e) => { setPw(e.target.value); if (msg) setMsg('') }} disabled={busy}
              placeholder="Enter Password" autoComplete="current-password" aria-label="Password"
              className="h-11 w-full rounded-full border border-white/40 bg-white/25 pl-5 pr-12 text-[15px] text-white placeholder-white/75 outline-none backdrop-blur-md transition focus:bg-white/35 focus:ring-2 focus:ring-white/60 disabled:opacity-70" />
            <button type="submit" disabled={busy || !pw.trim()} aria-label="Unlock"
              className={`absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-white/40 text-white transition ${pw.trim() ? 'opacity-100 active:scale-90' : 'pointer-events-none opacity-0'}`}>
              <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        </form>

        <div role="status" aria-live="polite" className="mt-3 min-h-10 text-center text-[13px] font-medium text-white/90 drop-shadow-[0_1px_6px_rgba(11,42,85,.45)]">
          {msg || label}
        </div>

        <div className="mt-1 flex items-center gap-5">
          {canTid && <button type="button" onClick={touchButton} disabled={busy} aria-label="Unlock with Touch ID"
            className={`grid size-11 place-items-center rounded-full border border-white/40 bg-white/20 backdrop-blur-md transition hover:bg-white/30 active:scale-90 disabled:opacity-60 ${mode === 'touch' ? 'yd-ring' : ''}`}>
            <Fingerprint className="size-6" aria-hidden="true" />
          </button>}
          <button type="button" onClick={() => setHint((h) => !h)} className="text-[13px] font-medium text-white/85 underline-offset-4 hover:underline">{hint ? 'Hide hint' : 'Password hint'}</button>
        </div>
        {hint && <p className="yd-pop mt-3 rounded-2xl border border-white/30 bg-white/20 px-4 py-3 text-center text-sm backdrop-blur-md">Your most favourite persona, and what you’d love to call her.</p>}
      </div>
    </div>
  </div>
}
