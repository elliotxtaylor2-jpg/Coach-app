import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useProfile } from '../app/AuthContext'
import type { SyncStatus } from '../app/useSync'
import { ChevronIcon, PlusIcon } from '../components/Icons'
import { ShareLink } from '../components/ShareLink'
import { SyncBadge } from '../components/SyncBadge'
import { createProgramme, ensureCoachProfile, getCoachProfile, listProgrammes } from '../lib/coach'
import { coachMembers } from '../lib/enrolment'
import { formatDate } from '../lib/format'

export function CoachHome({ sync }: { sync: { status: SyncStatus; pending: number } }) {
  const profile = useProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const coach = useLiveQuery(() => getCoachProfile(profile.id), [profile.id])
  const programmes = useLiveQuery(() => listProgrammes(profile.id), [profile.id]) ?? []
  const members = useLiveQuery(() => coachMembers(profile.id), [profile.id]) ?? []
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void ensureCoachProfile(profile)
  }, [profile])

  const active = members.filter((m) => m.enrolment.status === 'active')
  const setupSteps = [
    { label: 'Add a bio and price', done: !!coach?.bio, to: '/coach/profile' },
    { label: 'Publish a programme', done: programmes.some((p) => p.latestVersion > 0), to: programmes[0] ? `/coach/programmes/${programmes[0].id}` : null },
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
        <span className="muted small">Coach dashboard</span>
        <div className="row">
          <SyncBadge status={sync.status} pending={sync.pending} />
          <button type="button" className="btn ghost small" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
      <h1>Hi, {profile.displayName.split(' ')[0]}</h1>

      <div className="card dark stack">
        <span className="muted small">Active members</span>
        <span className="display" style={{ fontSize: 40, fontWeight: 700 }}>{active.length}</span>
        <span className="muted small">{coach ? `£${coach.priceGbp.toFixed(2)}/month · free while in beta` : ''}</span>
      </div>

      {!setupDone && (
        <section className="card stack" aria-label="Get set up">
          <span className="label">Get set up</span>
          {setupSteps.map((s) => (
            <div key={s.label} className="row">
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, flex: '0 0 auto', background: s.done ? 'var(--good)' : 'transparent', border: `2px solid ${s.done ? 'var(--good)' : 'var(--input-line)'}` }} />
              {s.to && !s.done ? <Link to={s.to} className="grow">{s.label}</Link> : <span className="grow" style={{ color: s.done ? 'var(--muted)' : undefined }}>{s.label}</span>}
              {s.done && <span className="sr-only">done</span>}
            </div>
          ))}
        </section>
      )}

      {coach && <ShareLink slug={coach.slug} />}
      <Link to="/coach/profile" className="btn secondary">Edit your page</Link>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Programmes</h2>
      </div>
      {programmes.length > 0 && (
        <nav className="list" aria-label="Programmes">
          {programmes.map((p) => (
            <Link key={p.id} to={`/coach/programmes/${p.id}`} className="list-item">
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{p.title}</span>
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

      <h2>Members</h2>
      {members.length === 0 ? (
        <p className="muted">No members yet. Share your link to invite your first clients.</p>
      ) : (
        <nav className="list" aria-label="Members">
          {members.map((m) => (
            <Link key={m.enrolment.id} to={`/coach/members/${m.enrolment.id}`} className="list-item">
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{m.enrolment.memberName}</span>
                <span className={`small ${m.enrolment.status === 'active' ? '' : 'muted'}`} style={{ color: m.enrolment.status === 'active' ? 'var(--good)' : undefined, fontWeight: 600 }}>
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
