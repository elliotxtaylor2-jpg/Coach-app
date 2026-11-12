import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { ExerciseCard } from '../components/ExerciseCard'
import { ExercisePicker } from '../components/ExercisePicker'
import { PlusIcon } from '../components/Icons'
import { RestTimer } from '../components/RestTimer'
import { db } from '../lib/db'
import { formatDuration } from '../lib/format'
import { addExercise, discardWorkout, exercisesForWorkout, finishWorkout } from '../lib/repo'

const REST_SECONDS = 90

export function WorkoutPage() {
  const { id = '' } = useParams()
  const profile = useProfile()
  const navigate = useNavigate()
  // null = not found; undefined = still loading.
  const workout = useLiveQuery(async () => (await db.workouts.get(id)) ?? null, [id])
  const exercises = useLiveQuery(() => exercisesForWorkout(id), [id]) ?? []
  const [picking, setPicking] = useState(false)
  const [restUntil, setRestUntil] = useState<number | null>(null)

  if (workout === undefined) return <p className="center muted">Loading…</p>
  if (!workout || workout.userId !== profile.id || workout.deleted) {
    return (
      <main className="shell">
        <h1>Workout not found</h1>
        <Link to="/">Back home</Link>
      </main>
    )
  }
  if (workout.finishedAt) return <Navigate to={`/history/${workout.id}`} replace />

  async function onPick(name: string) {
    setPicking(false)
    await addExercise(profile.id, id, name)
  }

  async function onFinish() {
    await finishWorkout(id)
    navigate(`/history/${id}`, { replace: true })
  }

  async function onDiscard() {
    if (!window.confirm('Discard this workout? Logged sets will be removed.')) return
    await discardWorkout(id)
    navigate('/', { replace: true })
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/" className="small">← Home</Link>
        <span className="muted small">{formatDuration(workout.startedAt, null)}</span>
      </div>
      <h1>{workout.name}</h1>

      {exercises.length === 0 && <p className="muted">Add your first exercise to start logging.</p>}
      {exercises.map((ex) => (
        <ExerciseCard key={ex.id} exercise={ex} onSetCompleted={() => setRestUntil(Date.now() + REST_SECONDS * 1000)} />
      ))}

      <button type="button" className="btn dashed" onClick={() => setPicking(true)}>
        <PlusIcon /> Add exercise
      </button>

      <div className="spacer" />
      <RestTimer until={restUntil} onDismiss={() => setRestUntil(null)} />
      <button type="button" className="btn block" onClick={() => void onFinish()} disabled={exercises.length === 0}>
        Finish workout
      </button>
      <button type="button" className="btn ghost" onClick={() => void onDiscard()}>Discard workout</button>

      <ExercisePicker open={picking} onPick={(n) => void onPick(n)} onClose={() => setPicking(false)} />
    </main>
  )
}
