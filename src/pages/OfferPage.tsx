import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { TickIcon } from '../components/Icons'
import { findCoachBySlug, orderedOffers } from '../lib/coach'
import { db } from '../lib/db'
import { joinCoach } from '../lib/enrolment'
import { supabase, supabaseAdapter } from '../lib/supabase'
import type { CoachProfile } from '../lib/types'

/** Public coach page behind the share link. Works signed out. */
export function OfferPage() {
  const { slug = '' } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const local = useLiveQuery(async () => (await findCoachBySlug(slug)) ?? null, [slug])
  const [remote, setRemote] = useState<CoachProfile | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  // Not on this device yet (a visitor from Instagram): look it up on the server.
  useEffect(() => {
    if (local !== null || !supabase) return
    let alive = true
    supabaseAdapter(supabase)
      .getCoachBySlug?.(slug)
      .then((row) => alive && setRemote((row as CoachProfile | null) ?? null))
      .catch(() => alive && setRemote(null))
    return () => {
      alive = false
    }
  }, [local, slug])

  const coach = local ?? remote ?? null
  const loading = local === undefined || (local === null && supabase && remote === undefined)

  if (loading) return <p className="center muted">Loading…</p>
  if (!coach) {
    return (
      <main className="shell">
        <h1>Coach not found</h1>
        <p className="muted">Check the link with your coach.</p>
      </main>
    )
  }

  const offers = orderedOffers(coach)
  const selected = picked ?? offers[0]?.programmeId ?? null
  const isOwner = profile?.id === coach.id
  const initials = coach.displayName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

  async function onJoin() {
    if (!coach || !selected) return
    if (!profile) {
      navigate('/sign-in', { state: { from: `/c/${coach.slug}`, role: 'member' } })
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (!(await db.coachProfiles.get(coach.id))) await db.coachProfiles.put(coach)
      await joinCoach(profile, coach, selected)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell" style={{ padding: 0, gap: 0 }}>
      <section className="stack" style={{ background: 'var(--ink)', color: 'var(--bg)', padding: '40px 20px 28px', gap: 16 }}>
        {isOwner && <span className="badge" style={{ alignSelf: 'flex-start' }}>Preview: this is what members see</span>}
        <div className="row" style={{ gap: 14 }}>
          <div aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 700, fontSize: 22 }}>{initials}</div>
          <div className="stack" style={{ gap: 2 }}>
            <h1 style={{ fontSize: 24 }}>{coach.displayName}</h1>
            {coach.specialism && <span style={{ color: '#c9cbd1', fontSize: 14 }}>{coach.specialism}</span>}
          </div>
        </div>
        {coach.bio && <p style={{ margin: 0, color: '#e2e3e7', lineHeight: 1.5 }}>{coach.bio}</p>}
      </section>

      <section className="stack" style={{ padding: 20, gap: 16 }}>
        {offers.length === 0 ? (
          <p className="note">{coach.displayName.split(' ')[0]} hasn't published a programme yet.</p>
        ) : (
          <div className="stack" role="radiogroup" aria-label="Choose a programme">
            <span className="eyebrow">{offers.length === 1 ? 'Programme' : 'Choose a programme'}</span>
            {offers.map((o) => {
              const on = o.programmeId === selected
              return (
                <button
                  key={o.programmeId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="card stack"
                  style={{ textAlign: 'left', cursor: 'pointer', border: `2px solid ${on ? 'var(--accent)' : 'var(--line)'}` }}
                  onClick={() => setPicked(o.programmeId)}
                >
                  <span className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 700, fontSize: 20 }}>{o.title}</span>
                    {o.programmeId === coach.featuredProgrammeId && offers.length > 1 && <span className="badge">Coach’s pick</span>}
                  </span>
                  {o.description && <span className="muted small">{o.description}</span>}
                  <span className="muted small">{o.weeks} {o.weeks === 1 ? 'week' : 'weeks'} · {o.daysPerWeek} {o.daysPerWeek === 1 ? 'session' : 'sessions'} a week</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="stack">
          {['Every session planned, set by set', 'Log weights and reps in seconds', `${coach.displayName.split(' ')[0]} sees your progress and adjusts`].map((t) => (
            <div key={t} className="row"><TickIcon color="var(--good)" /> {t}</div>
          ))}
        </div>
      </section>

      <div className="spacer" />
      <section className="stack" style={{ padding: '16px 20px 28px', background: 'var(--card)', borderTop: '1px solid var(--line)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="display" style={{ fontSize: 26, fontWeight: 700 }}>£{coach.priceGbp.toFixed(2)}<span className="muted" style={{ fontSize: 15, fontWeight: 500, fontFamily: 'Inter, sans-serif' }}> / month</span></span>
          <span className="muted small">Free while in beta</span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {isOwner ? (
          <Link to="/coach/profile" className="btn block">Edit your page</Link>
        ) : profile?.role === 'coach' ? (
          <p className="muted small center">You're signed in as a coach. Members join from their own account.</p>
        ) : (
          <button type="button" className="btn block" onClick={() => void onJoin()} disabled={busy || !selected}>
            {busy ? 'Joining…' : `Join ${coach.displayName.split(' ')[0]}`}
          </button>
        )}
      </section>
    </main>
  )
}
