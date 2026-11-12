import { useEffect, useState } from 'react'
import { parseNumber } from '../lib/format'
import { removeSet, updateSet } from '../lib/repo'
import type { WorkoutSet } from '../lib/types'
import { TickIcon, TrashIcon } from './Icons'

interface Props {
  set: WorkoutSet
  index: number
  exerciseName: string
  onCompleted?: () => void
  readOnly?: boolean
}

/** One set: weight, reps, done. Edits save on blur; ticking done saves immediately. */
export function SetRow({ set, index, exerciseName, onCompleted, readOnly }: Props) {
  const [kg, setKg] = useState(set.weightKg?.toString() ?? '')
  const [reps, setReps] = useState(set.reps?.toString() ?? '')

  // Keep inputs in step when the saved value changes elsewhere (sync from another device).
  // Remounting instead would steal focus mid-entry.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => setKg(set.weightKg?.toString() ?? ''), [set.weightKg])
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => setReps(set.reps?.toString() ?? ''), [set.reps])

  const label = `${exerciseName} set ${index + 1}`

  async function commit() {
    const weightKg = parseNumber(kg)
    const repCount = parseNumber(reps)
    if (weightKg !== set.weightKg || repCount !== set.reps) {
      await updateSet(set.id, { weightKg, reps: repCount === null ? null : Math.round(repCount) })
    }
  }

  async function toggleDone() {
    const weightKg = parseNumber(kg)
    const repCount = parseNumber(reps)
    const done = !set.done
    await updateSet(set.id, { weightKg, reps: repCount === null ? null : Math.round(repCount), done })
    if (done) onCompleted?.()
  }

  return (
    <div className={`set-grid set-row ${set.done ? 'done' : ''}`}>
      <span className="set-num">{index + 1}</span>
      <input
        className="input"
        inputMode="decimal"
        aria-label={`${label} weight in kg`}
        value={kg}
        placeholder="kg"
        readOnly={readOnly}
        onChange={(e) => setKg(e.target.value)}
        onBlur={() => void commit()}
      />
      <input
        className="input"
        inputMode="numeric"
        aria-label={`${label} reps`}
        value={reps}
        placeholder="reps"
        readOnly={readOnly}
        onChange={(e) => setReps(e.target.value)}
        onBlur={() => void commit()}
      />
      <button
        type="button"
        className="tick"
        aria-pressed={set.done}
        aria-label={set.done ? `${label} done, tap to undo` : `Mark ${label} done`}
        disabled={readOnly}
        onClick={() => void toggleDone()}
      >
        <TickIcon color={set.done ? '#fff' : '#a3a7b0'} />
      </button>
      {readOnly ? (
        <span />
      ) : (
        <button type="button" className="icon-btn" aria-label={`Remove ${label}`} onClick={() => void removeSet(set.id)}>
          <TrashIcon />
        </button>
      )}
    </div>
  )
}
