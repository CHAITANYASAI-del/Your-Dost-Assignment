import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Fingerprint, Lightbulb, Lock as LockIcon } from 'lucide-react'

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const enc = (s: string) => new TextEncoder().encode(s)
const PK = 'yd-pk'

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
  localStorage.setItem(PK, cred.id)
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

export function Lock({ onUnlocked }: { onUnlocked: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(false)
  const [tid, setTid] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    // Always offer Touch ID where the browser has WebAuthn; if it is not set up yet the button explains how.
    setTid(!!window.PublicKeyCredential)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!pw.trim() || busy) return
    setBusy(true); setErr('')
    const r = await post('login', { password: pw })
    setBusy(false)
    if (r.ok) onUnlocked(); else { setErr(r.error || 'That is not it.'); setPw(''); input.current?.focus() }
  }
  async function touch() {
    setBusy(true); setErr('')
    try {
      const s = await fetch('/api/auth').then((r) => r.json()).catch(() => ({ passkeys: 0 }))
      if (!hasLocalPasskey() && !s.passkeys) throw new Error('Touch ID is not set up yet. Unlock with the password once, then tap “Enable Touch ID”.')
      await unlockWithTouchId(); onUnlocked()
    } catch (e) { setErr((e as Error).message === 'Cancelled' ? '' : (e as Error).message || 'Touch ID did not work.') }
    setBusy(false)
  }

  return <div className="grid min-h-screen place-items-center px-4">
    <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border bg-card p-7 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.25)]">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><LockIcon className="size-5" aria-hidden="true" /></div>
      <h1 className="mt-4 text-center text-xl font-semibold tracking-tight">Reader stats</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">Private. Enter the password to continue.</p>

      <input ref={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" aria-label="Password"
        className={`mt-6 h-12 w-full rounded-xl border bg-background px-4 text-base outline-none transition focus:ring-2 focus:ring-brand/40 ${err ? 'border-red-400' : ''}`} />
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}

      <button type="submit" disabled={busy || !pw.trim()} className="mt-3 h-12 w-full rounded-xl bg-brand text-sm font-semibold text-white transition active:scale-[.98] disabled:opacity-40">{busy ? 'Checking…' : 'Unlock'}</button>

      {tid && <button type="button" onClick={touch} disabled={busy} className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-background text-sm font-semibold transition hover:bg-muted active:scale-[.98] disabled:opacity-40">
        <Fingerprint className="size-5" aria-hidden="true" />Unlock with Touch ID
      </button>}

      <button type="button" onClick={() => setHint((h) => !h)} className="mx-auto mt-5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Lightbulb className="size-3.5" aria-hidden="true" />{hint ? 'Hide hint' : 'Need a hint?'}
      </button>
      {hint && <p className="mt-2 rounded-xl bg-muted px-3.5 py-3 text-center text-sm">Your most favourite persona, and what you’d love to call her.</p>}
    </form>
  </div>
}
