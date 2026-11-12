import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useProfile } from '../app/AuthContext'
import type { SyncStatus } from '../app/useSync'
import { ChevronIcon } from '../components/Icons'
import { SyncBadge } from '../components/SyncBadge'
import { getActiveWorkout, startWorkout, workoutHistory } from '../lib/repo'
import { formatDate } from '../lib/format'

export function Home({ sync }: { sync: { status: SyncStatus; pending: number } }) {
  const profile = useProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const active = useLiveQuery(() => getActiveWorkout(profile.id), [profile.id])
  const recent = useLiveQuery(() => workoutHistory(profile.id), [profile.id]) ?? []
  const thisWeek = recent.filter((w) => Date.now() - Date.parse(w.startedAt) < 7 * 864e5).length

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
          <button type="button" className="btn ghost small" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>

      <div className="stack">
        <span className="eyebrow">Today</span>
        <h1>{active ? 'Workout in progress' : 'Ready to train?'}</h1>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">This week</span>
          <span className="muted small">{thisWeek} {thisWeek === 1 ? 'session' : 'sessions'}</span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Your coach's programme will appear here once they publish it.</p>
      </div>

      {active ? (
        <Link className="btn block" to={`/workout/${active.id}`}>Resume workout</Link>
      ) : (
        <button type="button" className="btn block" onClick={() => void onStart()}>Start a workout</button>
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
