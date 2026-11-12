import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useProfile } from '../app/AuthContext'
import type { SyncStatus } from '../app/useSync'
import { TickIcon, ChevronIcon, PlusIcon } from '../components/Icons'
import { ShareLink } from '../components/ShareLink'
import { SyncBadge } from '../components/SyncBadge'
import { createProgramme, ensureCoachProfile, getCoachProfile, listProgrammes } from '../lib/coach'
import { coachMembers } from '../lib/enrolment'
import { db } from '../lib/db'
import { payments } from '../lib/payments'
import { formatDate } from '../lib/format'

export function CoachHome({ sync }: { sync: { status: SyncStatus; pending: number } }) {
  const profile = useProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const coach = useLiveQuery(() => getCoachProfile(profile.id), [profile.id])
  const programmes = useLiveQuery(() => listProgrammes(profile.id), [profile.id]) ?? []
  const members = useLiveQuery(() => coachMembers(profile.id), [profile.id]) ?? []
  const [creating, setCreating] = useState(false)
  const payout = useLiveQuery(async () => (await db.payoutAccounts.get(profile.id)) ?? null, [profile.id])
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const [payoutBusy, setPayoutBusy] = useState(false)

  async function onSetUpPayouts() {
    setPayoutBusy(true)
    setPayoutError(null)
    try {
      await payments.setUpPayouts(profile)
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'Could not start payout set-up.')
    } finally {
      setPayoutBusy(false)
    }
  }

  useEffect(() => {
    void ensureCoachProfile(profile)
  }, [profile])

  const active = members.filter((m) => m.enrolment.status === 'active')
  const setupSteps = [
    { label: 'Add a bio and price', done: !!coach?.bio, to: '/coach/profile' },
    { label: 'Publish a programme', done: programmes.some((p) => p.latestVersion > 0), to: programmes[0] ? `/coach/programmes/${programmes[0].id}` : null },
    { label: 'Set up payouts', done: !!payout?.chargesEnabled, to: null },
    { label: 'Get your first member', done: active.length > 0, to: null },
  ]
  const setupDone = setupSteps.every((s) => s.done)

  async function onNewProgramme() {
    setCreating(true)
    const p = await createProgramme(profile.id, 'New programme')
    navigate(`/coach/programmes/${p.id}`)
  }

  return (
    <main className="shell">
      <div className="topbar">
        <span className="wordmark">Sett</span>
        <div className="row">
          <SyncBadge status={sync.status} pending={sync.pending} />
          <button type="button" className="btn ghost small" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Coach studio</span>
        <h1>Hello, <em>{profile.displayName.split(' ')[0]}</em>.</h1>
      </div>

      <div className="card dark stack" style={{ gap: 6, padding: 24 }}>
        <span className="muted small">Active members</span>
        <span className="hero-number">{active.length}</span>
        <span className="muted small">{coach ? `£${coach.priceGbp.toFixed(2)}/month${coach.takesPayments ? '' : ' · free while in beta'}` : ''}</span>
      </div>

      <section className="card stack" aria-label="Payments">
        <h3>Payments</h3>
        {payout?.chargesEnabled ? (
          <>
            <span className="muted small">Members pay you through Stripe. We take 10%, never more than £30 a month.</span>
            <Link to="/coach/earnings" className="btn secondary">See earnings</Link>
          </>
        ) : (
          <>
            <span className="muted small">
              {payout ? 'Finish your Stripe set-up to start taking payments.' : 'Connect your bank through Stripe to start taking payments. About 5 minutes.'}
              {payments.mode === 'demo' ? ' Demo mode: this completes instantly.' : ''}
            </span>
            {payoutError && <p className="error small">{payoutError}</p>}
            <button type="button" className="btn" onClick={() => void onSetUpPayouts()} disabled={payoutBusy}>
              {payout ? 'Finish payout set-up' : 'Set up payouts with Stripe'}
            </button>
          </>
        )}
      </section>

      {!setupDone && (
        <section className="card stack" aria-label="Get set up">
          <h3>Get set up</h3>
          {setupSteps.map((s) => (
            <div key={s.label} className="row">
              <span aria-hidden="true" className={`check${s.done ? ' on' : ''}`}>{s.done && <TickIcon color="#fff" />}</span>
              {s.to && !s.done ? <Link to={s.to} className="grow">{s.label}</Link> : <span className={`grow${s.done ? ' done-text' : ''}`}>{s.label}</span>}
              {s.done && <span className="sr-only">done</span>}
            </div>
          ))}
        </section>
      )}

      {coach && <ShareLink slug={coach.slug} />}
      <Link to="/coach/profile" className="btn secondary">Edit your page</Link>

      <div className="section-head"><h2>Programmes</h2></div>
      {programmes.length > 0 && (
        <nav className="list" aria-label="Programmes">
          {programmes.map((p) => (
            <Link key={p.id} to={`/coach/programmes/${p.id}`} className="list-item">
              <span className="grow">
                <span className="title">{p.title}</span>
                <span className="muted small">
                  {p.draft.weeks.length} {p.draft.weeks.length === 1 ? 'week' : 'weeks'} · {p.draft.weeks[0]?.days.length ?? 0} a week · {p.latestVersion ? `v${p.latestVersion}` : 'draft'}
                  {coach?.featuredProgrammeId === p.id ? ' · featured' : ''}
                </span>
              </span>
              <ChevronIcon />
            </Link>
          ))}
        </nav>
      )}
      <button type="button" className="btn dashed" onClick={() => void onNewProgramme()} disabled={creating}>
        <PlusIcon /> New programme
      </button>

      <div className="section-head"><h2>Members</h2>{members.length > 0 && <span className="muted small">{active.length} active</span>}</div>
      {members.length === 0 ? (
        <p className="muted">No members yet. Share your link to invite your first clients.</p>
      ) : (
        <nav className="list" aria-label="Members">
          {members.map((m) => (
            <Link key={m.enrolment.id} to={`/coach/members/${m.enrolment.id}`} className="list-item">
              <span className="grow">
                <span className="title">{m.enrolment.memberName}</span>
                <span className={`badge ${m.enrolment.status === 'active' ? 'good' : ''}`} style={{ marginTop: 4 }}>
                  {m.enrolment.status === 'active' ? 'Active' : 'Cancelled'}
                </span>
              </span>
              <span className="muted small">{m.lastWorkoutAt ? formatDate(m.lastWorkoutAt) : 'No workouts yet'}</span>
              <ChevronIcon />
            </Link>
          ))}
        </nav>
      )}
    </main>
  )
}
