import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../app/AuthContext'
import { TickIcon } from '../components/Icons'
import { findCoachBySlug, orderedOffers } from '../lib/coach'
import { db } from '../lib/db'
import { annualSavingPence, formatGbp, planPricePence, type Plan } from '../lib/billing'
import { joinCoach } from '../lib/enrolment'
import { payments } from '../lib/payments'
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
  const [plan, setPlan] = useState<Plan>('monthly')

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
  const firstName = coach.displayName.split(' ')[0]
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
      if (coach.takesPayments) {
        await payments.checkout(profile, coach, selected, plan)
        if (payments.mode === 'demo') navigate('/', { replace: true })
      } else {
        await joinCoach(profile, coach, selected)
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell offer">
      <section className="offer-hero">
        <div className="row between">
          <span className="eyebrow">Coaching programme</span>
          {isOwner && <span className="badge dark">Preview · what members see</span>}
        </div>
        <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
          <div className="monogram" aria-hidden="true">{initials}</div>
          <div className="stack" style={{ gap: 6 }}>
            <h1>{coach.displayName}</h1>
            {coach.specialism && <span className="specialism">{coach.specialism}</span>}
          </div>
        </div>
        {coach.bio && <p className="bio">{coach.bio}</p>}
      </section>

      <section className="offer-body">
        {offers.length === 0 ? (
          <p className="note">{firstName} hasn't published a programme yet. Check back soon.</p>
        ) : (
          <div className="stack" role="radiogroup" aria-label="Choose a programme">
            <span className="eyebrow">{offers.length === 1 ? 'The programme' : 'Choose your programme'}</span>
            {offers.map((o) => {
              const on = o.programmeId === selected
              return (
                <button
                  key={o.programmeId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="option"
                  onClick={() => setPicked(o.programmeId)}
                >
                  <span className="row between">
                    <span className="option-title">{o.title}</span>
                    {o.programmeId === coach.featuredProgrammeId && offers.length > 1 && <span className="badge">Coach’s pick</span>}
                  </span>
                  {o.description && <span className="muted">{o.description}</span>}
                  <span className="small muted">{o.weeks} {o.weeks === 1 ? 'week' : 'weeks'} · {o.daysPerWeek} {o.daysPerWeek === 1 ? 'session' : 'sessions'} a week</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">What you get</span>
          <div className="benefits">
            {['Every session planned, set by set', 'Log weights and reps in seconds', `${firstName} sees your progress and adjusts`].map((t) => (
              <div key={t}><TickIcon color="var(--accent)" /> {t}</div>
            ))}
          </div>
        </div>
      </section>

      <div className="spacer" />
      <section className="offer-cta">
        {coach.takesPayments ? (
          <>
            <div className="segmented tall" role="radiogroup" aria-label="Plan">
              <button type="button" role="radio" aria-checked={plan === 'monthly'} className="choice" aria-pressed={plan === 'monthly'} onClick={() => setPlan('monthly')}>
                <span className="title">Monthly</span>
                <span className="small muted">{formatGbp(planPricePence(coach.priceGbp, 'monthly'))} / month</span>
              </button>
              <button type="button" role="radio" aria-checked={plan === 'annual'} className="choice" aria-pressed={plan === 'annual'} onClick={() => setPlan('annual')}>
                <span className="title">Annual · 2 months free</span>
                <span className="small muted">{formatGbp(planPricePence(coach.priceGbp, 'annual'))} / year</span>
              </button>
            </div>
            <span className="muted small">
              {coach.trialDays > 0 ? `${coach.trialDays}-day free trial, then ` : ''}
              {plan === 'annual'
                ? `${formatGbp(planPricePence(coach.priceGbp, 'annual'))} a year (save ${formatGbp(annualSavingPence(coach.priceGbp))}).`
                : `${formatGbp(planPricePence(coach.priceGbp, 'monthly'))} a month.`}{' '}
              Cancel anytime.
            </span>
          </>
        ) : (
          <div className="row between">
            <span className="price">£{coach.priceGbp.toFixed(2)}<span className="per"> / month</span></span>
            <span className="badge good">Free while in beta</span>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {isOwner ? (
          <Link to="/coach/profile" className="btn block">Edit your page</Link>
        ) : profile?.role === 'coach' ? (
          <p className="muted small center">You're signed in as a coach. Members join from their own account.</p>
        ) : (
          <button type="button" className="btn block" onClick={() => void onJoin()} disabled={busy || !selected}>
            {busy
              ? 'Please wait…'
              : coach.takesPayments
                ? coach.trialDays > 0
                  ? `Start ${coach.trialDays}-day free trial`
                  : `Subscribe to ${firstName}`
                : `Join ${firstName}`}
          </button>
        )}
        {coach.takesPayments && !isOwner && <span className="muted small center">Payments are handled securely by Stripe.{payments.mode === 'demo' ? ' Demo mode: no real card is charged.' : ''}</span>}
      </section>
    </main>
  )
}
