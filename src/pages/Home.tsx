import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, useProfile } from '../app/AuthContext'
import type { SyncStatus } from '../app/useSync'
import { ChevronIcon } from '../components/Icons'
import { NextSessionCard } from '../components/NextSessionCard'
import { SyncBadge } from '../components/SyncBadge'
import { AccessBanner } from '../components/AccessBanner'
import { memberStatus } from '../lib/enrolment'
import { getActiveWorkout, startWorkout, workoutHistory } from '../lib/repo'
import { formatDate } from '../lib/format'

export function Home({ sync }: { sync: { status: SyncStatus; pending: number } }) {
  const profile = useProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const active = useLiveQuery(() => getActiveWorkout(profile.id), [profile.id])
  const recent = useLiveQuery(() => workoutHistory(profile.id), [profile.id]) ?? []
  const status = useLiveQuery(() => memberStatus(profile.id), [profile.id])
  const enrolment = status === undefined ? undefined : (status?.enrolment ?? null)
  const [params] = useSearchParams()
  const justPaid = params.get('paid') === '1' && !status?.subscription

  async function onStart() {
    const w = await startWorkout(profile.id)
    navigate(`/workout/${w.id}`)
  }

  return (
    <main className="shell">
      <div className="topbar">
        <span className="muted small">Hi, {profile.displayName.split(' ')[0]}</span>
        <div className="row">
          <SyncBadge status={sync.status} pending={sync.pending} />
          {status?.subscription && <Link to="/account" className="small">Account</Link>}
          <button type="button" className="btn ghost small" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>

      <div className="stack">
        <span className="eyebrow">Today</span>
        <h1>{active ? 'Workout in progress' : 'Ready to train?'}</h1>
      </div>

      {active ? (
        <Link className="btn block" to={`/workout/${active.id}`}>Resume workout</Link>
      ) : null}

      {justPaid && <p className="note" role="status">Payment received. Setting up your programme… this takes a few seconds.</p>}
      {status && <AccessBanner status={status} />}

      {enrolment && status?.access.ok ? (
        <NextSessionCard memberId={profile.id} disabled={!!active} />
      ) : enrolment === null ? (
        <p className="note">Following a coach? Open the link they sent you to join their programme.</p>
      ) : null}

      {!active && (
        <button type="button" className={`btn block ${enrolment ? 'secondary' : ''}`} onClick={() => void onStart()}>
          {enrolment ? 'Log a free workout' : 'Start a workout'}
        </button>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Recent</h2>
        {recent.length > 0 && <Link to="/history" className="small">All history</Link>}
      </div>
      {recent.length === 0 ? (
        <p className="muted">No workouts yet. Your finished sessions will show up here.</p>
      ) : (
        <nav className="list" aria-label="Recent workouts">
          {recent.slice(0, 3).map((w) => (
            <Link key={w.id} to={`/history/${w.id}`} className="list-item">
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{w.name}</span>
                <span className="muted small">{formatDate(w.startedAt)}</span>
              </span>
              <ChevronIcon />
            </Link>
          ))}
        </nav>
      )}
    </main>
  )
}
