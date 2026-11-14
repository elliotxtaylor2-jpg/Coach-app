import { db } from './db'
import type { ProgressionSettings, WorkoutSet } from './types'

/**
 * Rule-based progressive overload.
 *
 * After each session the plan compares what the coach asked for (a rep range) with what the member did,
 * set by set, and suggests the next session's weight and reps:
 *   1. Every set reached the top of the range, without an all-out effort → add weight, back to the bottom of the range.
 *   2. Inside the range → same weight, one more rep.
 *   3. A set fell short of the range → same weight, aim for the bottom of the range.
 *   4. Fell short two sessions running → drop about 10% and build back up.
 * Coaches switch it off or change the weight jump per programme.
 */

export const DEFAULT_PROGRESSION: ProgressionSettings = { enabled: true, incrementKg: 2.5 }
export const INCREMENT_CHOICES = [1, 2.5, 5] as const

export type SuggestionKind = 'first' | 'up' | 'add-rep' | 'hold' | 'hold-maxed' | 'deload'

export interface Suggestion {
  kind: SuggestionKind
  weightKg: number | null
  reps: number
  reason: string
}

export interface RepRange {
  lo: number
  hi: number
}

/** "8-10", "8–10", "8 to 10" → {8, 10}; "5" → {5, 5}; timed or open-ended ("45s", "AMRAP") → null. */
export function parseRepRange(reps: string): RepRange | null {
  const text = reps.trim()
  if (!text || /s$|sec|min|amrap|max/i.test(text)) return null
  const m = text.match(/^(\d+)\s*(?:-|–|—|to)\s*(\d+)$/i)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    return a > 0 && b > 0 ? { lo: Math.min(a, b), hi: Math.max(a, b) } : null
  }
  const single = text.match(/^(\d+)$/)
  if (single && Number(single[1]) > 0) return { lo: Number(single[1]), hi: Number(single[1]) }
  return null
}

const fmt = (kg: number) => (Number.isInteger(kg) ? `${kg}` : kg.toFixed(1).replace(/\.0$/, ''))

/** Round down to the nearest jump the gym can load, never below one jump. */
function roundDown(kg: number, step: number): number {
  return Math.max(step, Math.floor(kg / step + 1e-9) * step)
}

/**
 * Decide the next session. `sessions` holds the member's completed sets for this exercise,
 * one array per earlier session, most recent first.
 */
export function suggestNext(sessions: WorkoutSet[][], range: RepRange, settings: ProgressionSettings = DEFAULT_PROGRESSION): Suggestion {
  const step = settings.incrementKg > 0 ? settings.incrementKg : DEFAULT_PROGRESSION.incrementKg
  const working = (sets: WorkoutSet[]) => {
    const loaded = sets.filter((s) => s.weightKg != null && s.reps != null)
    if (loaded.length === 0) return null
    const top = Math.max(...loaded.map((s) => s.weightKg as number))
    return { weight: top, sets: loaded.filter((s) => s.weightKg === top) }
  }

  const last = sessions[0] ? working(sessions[0]) : null
  if (!last) {
    return {
      kind: 'first',
      weightKg: null,
      reps: range.lo,
      reason: `First time: pick a weight you could lift for ${range.hi} reps with good form.`,
    }
  }

  const reps = last.sets.map((s) => s.reps as number)
  const shortOf = reps.some((r) => r < range.lo)
  const allTop = reps.every((r) => r >= range.hi)
  const rated = last.sets.filter((s) => s.rpe != null)
  const allOut = rated.length > 0 && rated.every((s) => (s.rpe as number) >= 10)

  if (shortOf) {
    const prev = sessions[1] ? working(sessions[1]) : null
    const shortTwice = prev != null && prev.weight >= last.weight && prev.sets.some((s) => (s.reps as number) < range.lo)
    if (shortTwice) {
      const lighter = roundDown(last.weight * 0.9, step)
      return {
        kind: 'deload',
        weightKg: lighter,
        reps: range.lo,
        reason: `${fmt(lighter)} kg: missed ${range.lo} reps two sessions running, so build back up from a little lighter.`,
      }
    }
    return {
      kind: 'hold',
      weightKg: last.weight,
      reps: range.lo,
      reason: `Same weight: aim for at least ${range.lo} reps on every set.`,
    }
  }

  if (allTop && !settings.enabled) {
    return { kind: 'hold', weightKg: last.weight, reps: range.hi, reason: '' }
  }

  if (allTop && allOut) {
    return {
      kind: 'hold-maxed',
      weightKg: last.weight,
      reps: range.hi,
      reason: `Same weight: you hit ${range.hi} reps but nothing was left. Own it before adding weight.`,
    }
  }

  if (allTop) {
    const heavier = Math.round((last.weight + step) * 100) / 100
    return {
      kind: 'up',
      weightKg: heavier,
      reps: range.lo,
      reason: `+${fmt(step)} kg: you hit ${range.hi} reps on every set last time.`,
    }
  }

  const aim = Math.min(range.hi, Math.min(...reps) + 1)
  return {
    kind: 'add-rep',
    weightKg: last.weight,
    reps: aim,
    reason: `Same weight, one more rep: aim for ${aim} reps on every set.`,
  }
}

/** The member's completed sets for an exercise, one array per earlier session, most recent first. */
export async function recentSessions(userId: string, exerciseName: string, excludeWorkoutId?: string, limit = 2): Promise<WorkoutSet[][]> {
  const exercises = await db.workoutExercises
    .where('exerciseName')
    .equals(exerciseName)
    .filter((e) => e.userId === userId && !e.deleted && e.workoutId !== excludeWorkoutId)
    .toArray()
  if (exercises.length === 0) return []
  const workouts = new Map((await db.workouts.bulkGet(exercises.map((e) => e.workoutId))).filter((w) => w && !w.deleted).map((w) => [w!.id, w!]))
  const ordered = exercises
    .filter((e) => workouts.has(e.workoutId))
    .sort((a, b) => (workouts.get(a.workoutId)!.startedAt < workouts.get(b.workoutId)!.startedAt ? 1 : -1))
  const out: WorkoutSet[][] = []
  for (const ex of ordered) {
    const sets = await db.sets
      .where('workoutExerciseId')
      .equals(ex.id)
      .filter((s) => s.done && !s.deleted)
      .sortBy('position')
    if (sets.length > 0) out.push(sets)
    if (out.length >= limit) break
  }
  return out
}
