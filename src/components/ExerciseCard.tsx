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
      <div className="row between">
        <h2>{exercise.exerciseName}</h2>
        <span className={`badge${sets.length > 0 && done === sets.length ? ' good' : ''}`}>{done}/{sets.length}</span>
      </div>
      {exercise.target && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="target">
            <span className="eyebrow" style={{ marginRight: 8 }}>Target</span> {exercise.target.sets} × {exercise.target.reps}
            {exercise.target.load ? ` · ${exercise.target.load}` : ''}
            {exercise.target.restSec ? ` · rest ${exercise.target.restSec}s` : ''}
          </span>
          {exercise.target.progression?.reason && (
            <p className={`progression ${exercise.target.progression.kind}`}>
              <span aria-hidden="true">{exercise.target.progression.kind === 'up' ? '↑' : exercise.target.progression.kind === 'deload' ? '↓' : exercise.target.progression.kind === 'first' ? '•' : '→'}</span>
              {exercise.target.progression.reason}
            </p>
          )}
          {exercise.target.notes && <p className="note">{exercise.target.notes}</p>}
          {exercise.target.videoUrl && /^https:\/\//.test(exercise.target.videoUrl) && (
            <a href={exercise.target.videoUrl} target="_blank" rel="noopener noreferrer" className="small">Watch demo</a>
          )}
        </div>
      )}
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
