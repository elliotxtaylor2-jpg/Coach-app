import { useLiveQuery } from 'dexie-react-hooks'
import { addSet, setsForExercise } from '../lib/repo'
import type { WorkoutExercise } from '../lib/types'
import { PlusIcon } from './Icons'
import { SetRow } from './SetRow'

export function ExerciseCard({
  exercise,
  onSetCompleted,
  readOnly,
}: {
  exercise: WorkoutExercise
  onSetCompleted?: () => void
  readOnly?: boolean
}) {
  const sets = useLiveQuery(() => setsForExercise(exercise.id), [exercise.id]) ?? []
  const done = sets.filter((s) => s.done).length

  return (
    <section className="card stack" aria-label={exercise.exerciseName}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 18 }}>{exercise.exerciseName}</h2>
        <span className="muted small">{done}/{sets.length} done</span>
      </div>
      <div className="set-grid set-head" aria-hidden="true">
        <span className="center">Set</span><span>kg</span><span>Reps</span><span className="center">Done</span><span />
      </div>
      {sets.map((s, i) => (
        <SetRow key={s.id} set={s} index={i} exerciseName={exercise.exerciseName} onCompleted={onSetCompleted} readOnly={readOnly} />
      ))}
      {!readOnly && (
        <button type="button" className="btn ghost" onClick={() => void addSet(exercise)}>
          <PlusIcon /> Add set
        </button>
      )}
    </section>
  )
}
