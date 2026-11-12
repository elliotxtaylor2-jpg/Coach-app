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

/** Reps left in the tank → RPE: 4+ left is RPE 6, none left is RPE 10. */
export const EFFORT_CHOICES = [
  { rpe: 6, label: '4+' },
  { rpe: 7, label: '3' },
  { rpe: 8, label: '2' },
  { rpe: 9, label: '1' },
  { rpe: 10, label: '0' },
] as const

export function effortLabel(rpe: number): string {
  const left = 10 - rpe
  return left >= 4 ? '4+ reps left' : left === 0 ? 'Nothing left' : `${left} ${left === 1 ? 'rep' : 'reps'} left`
}

/** One set: weight, reps, done, and an optional effort rating once done. Edits save on blur; taps save immediately. */
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

  async function rate(rpe: number) {
    await updateSet(set.id, { rpe: set.rpe === rpe ? null : rpe })
  }

  return (
    <div className={`set-wrap ${set.done ? 'done' : ''}`}>
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
    {set.done && !readOnly && (
      <div className="effort" role="group" aria-label={`${label}: reps left in the tank`}>
        <span className="effort-label">Reps left?</span>
        {EFFORT_CHOICES.map((c) => (
          <button
            key={c.rpe}
            type="button"
            className="effort-chip"
            aria-pressed={set.rpe === c.rpe}
            aria-label={`${label}: ${effortLabel(c.rpe)}`}
            onClick={() => void rate(c.rpe)}
          >
            {c.label}
          </button>
        ))}
      </div>
    )}
    {set.done && readOnly && set.rpe != null && (
      <div className="effort">
        <span className="badge">{effortLabel(set.rpe)} · RPE {set.rpe}</span>
      </div>
    )}
    </div>
  )
}
