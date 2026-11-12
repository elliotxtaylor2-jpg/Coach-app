import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { ExerciseCard } from '../components/ExerciseCard'
import { ChevronIcon } from '../components/Icons'
import { db } from '../lib/db'
import { formatDate, formatDuration, formatKg } from '../lib/format'
import { exercisesForWorkout, summarise, workoutHistory } from '../lib/repo'

export function History() {
  const profile = useProfile()
  const workouts = useLiveQuery(() => workoutHistory(profile.id), [profile.id])

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/" className="small">← Home</Link>
      </div>
      <h1>History</h1>
      {workouts === undefined ? (
        <p className="muted">Loading…</p>
      ) : workouts.length === 0 ? (
        <p className="muted">No finished workouts yet.</p>
      ) : (
        <nav className="list" aria-label="Workout history">
          {workouts.map((w) => (
            <Link key={w.id} to={`/history/${w.id}`} className="list-item">
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{w.name}</span>
                <span className="muted small">{formatDate(w.startedAt)} · {formatDuration(w.startedAt, w.finishedAt)}</span>
              </span>
              <ChevronIcon />
            </Link>
          ))}
        </nav>
      )}
    </main>
  )
}

export function WorkoutDetail() {
  const { id = '' } = useParams()
  const profile = useProfile()
  const workout = useLiveQuery(async () => (await db.workouts.get(id)) ?? null, [id])
  const exercises = useLiveQuery(() => exercisesForWorkout(id), [id]) ?? []
  const summary = useLiveQuery(() => summarise(id), [id])

  if (workout === undefined) return <p className="center muted">Loading…</p>
  if (!workout || workout.userId !== profile.id || workout.deleted) {
    return (
      <main className="shell">
        <h1>Workout not found</h1>
        <Link to="/history">Back to history</Link>
      </main>
    )
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/history" className="small">← History</Link>
        <span className="muted small">{formatDate(workout.startedAt)}</span>
      </div>
      <h1>{workout.name}</h1>
      {summary && (
        <div className="card stat-grid">
          <div className="stack" style={{ gap: 2 }}><span className="big-number">{summary.exercises}</span><span className="muted small">{summary.exercises === 1 ? 'exercise' : 'exercises'}</span></div>
          <div className="stack" style={{ gap: 2 }}><span className="big-number">{summary.setsDone}</span><span className="muted small">{summary.setsDone === 1 ? 'set done' : 'sets done'}</span></div>
          <div className="stack" style={{ gap: 2 }}><span className="big-number">{formatKg(summary.volumeKg)}</span><span className="muted small">volume</span></div>
        </div>
      )}
      {exercises.map((ex) => (
        <ExerciseCard key={ex.id} exercise={ex} readOnly />
      ))}
      <Link to="/" className="btn block">Done</Link>
    </main>
  )
}
