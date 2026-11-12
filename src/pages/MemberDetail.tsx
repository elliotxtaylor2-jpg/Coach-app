import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { ExerciseCard } from '../components/ExerciseCard'
import { db } from '../lib/db'
import { formatDate, formatDuration, formatKg } from '../lib/format'
import { exercisesForWorkout, summarise } from '../lib/repo'
import type { Workout } from '../lib/types'

/** Coach's read-only view of one member's training (full set logs, per the coach's access). */
export function MemberDetail() {
  const { id = '' } = useParams()
  const coach = useProfile()
  const enrolment = useLiveQuery(async () => (await db.enrolments.get(id)) ?? null, [id])
  const workouts = useLiveQuery(
    async () =>
      enrolment
        ? (await db.workouts.where('userId').equals(enrolment.userId).filter((w) => !!w.finishedAt && !w.deleted).toArray()).sort((a, b) =>
            a.startedAt < b.startedAt ? 1 : -1,
          )
        : [],
    [enrolment],
  )

  if (enrolment === undefined) return <p className="center muted">Loading…</p>
  if (!enrolment || enrolment.coachId !== coach.id) {
    return (
      <main className="shell">
        <h1>Member not found</h1>
        <Link to="/coach">Back to dashboard</Link>
      </main>
    )
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/coach" className="small">← Dashboard</Link>
        <span className={`badge ${enrolment.status === 'active' ? 'good' : ''}`}>{enrolment.status === 'active' ? 'Active' : 'Cancelled'}</span>
      </div>
      <h1>{enrolment.memberName}</h1>
      <span className="muted small">Joined {formatDate(enrolment.startedAt)}</span>
      {!workouts || workouts.length === 0 ? (
        <p className="muted">No finished workouts yet.</p>
      ) : (
        workouts.map((w) => <WorkoutLog key={w.id} workout={w} />)
      )}
    </main>
  )
}

function WorkoutLog({ workout }: { workout: Workout }) {
  const exercises = useLiveQuery(() => exercisesForWorkout(workout.id), [workout.id]) ?? []
  const summary = useLiveQuery(() => summarise(workout.id), [workout.id])
  return (
    <details className="card">
      <summary style={{ cursor: 'pointer' }}>
        <span className="strong">{workout.name}</span>{' '}
        <span className="muted small">
          {formatDate(workout.startedAt)} · {formatDuration(workout.startedAt, workout.finishedAt)}
          {summary ? ` · ${summary.setsDone} sets · ${formatKg(summary.volumeKg)}` : ''}
          {workout.weekIndex != null ? ` · week ${workout.weekIndex + 1}` : ''}
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {exercises.map((ex) => <ExerciseCard key={ex.id} exercise={ex} readOnly />)}
      </div>
    </details>
  )
}
