import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { homeFor } from '../app/RequireRole'
import type { Role } from '../lib/types'

export function SignIn() {
  const { profile, mode, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'create' | 'sign-in'>('create')
  const [role, setRole] = useState<Role>('member')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (profile) return <Navigate to={homeFor(profile.role)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (tab === 'create') await signUp({ email, password, displayName, role })
      else await signIn({ email, password })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <div className="stack" style={{ marginTop: 32 }}>
        <span className="display" style={{ fontWeight: 700, fontSize: 18 }}>[APP NAME]</span>
        <h1>{tab === 'create' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted" style={{ margin: 0 }}>Coaches publish programmes. Members follow them and log every set.</p>
      </div>

      <div className="segmented" role="group" aria-label="Account">
        <button type="button" className="choice" aria-pressed={tab === 'create'} onClick={() => setTab('create')}>New account</button>
        <button type="button" className="choice" aria-pressed={tab === 'sign-in'} onClick={() => setTab('sign-in')}>Sign in</button>
      </div>

      <form className="stack" onSubmit={onSubmit} noValidate>
        {tab === 'create' && (
          <>
            <div className="stack">
              <span className="label" id="role-label">I'm a…</span>
              <div className="segmented" role="group" aria-labelledby="role-label">
                <button type="button" className="choice" aria-pressed={role === 'member'} onClick={() => setRole('member')}>Member</button>
                <button type="button" className="choice" aria-pressed={role === 'coach'} onClick={() => setRole('coach')}>Coach</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" className="input" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete={tab === 'create' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn block" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : tab === 'create' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {mode === 'demo' && (
        <p className="note small">Demo mode: accounts and workouts are saved on this device only. Add Supabase keys to sync across devices.</p>
      )}
    </main>
  )
}
