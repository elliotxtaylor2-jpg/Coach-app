import { db } from './db'
import type { TableName, Workout, WorkoutExercise, WorkoutSet } from './types'

export const now = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

/** Every local write goes through here: save the row and queue it for sync, in one transaction. */
export async function save<T extends { id: string }>(table: TableName, row: T): Promise<T> {
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).put(row)
    const key = `${table}:${row.id}`
    const existing = await db.outbox.get(key)
    await db.outbox.put({ key, table, rowId: row.id, queuedAt: now(), attempts: existing?.attempts ?? 0 })
  })
  return row
}

export async function startWorkout(userId: string, name = 'Workout'): Promise<Workout> {
  const t = now()
  return save('workouts', {
    id: newId(),
    userId,
    name,
    startedAt: t,
    finishedAt: null,
    updatedAt: t,
    deleted: false,
  } satisfies Workout)
}

export async function getActiveWorkout(userId: string): Promise<Workout | undefined> {
  const all = await db.workouts.where('userId').equals(userId).toArray()
  return all.find((w) => !w.finishedAt && !w.deleted)
}

/**
 * The most recent completed set for an exercise, used to pre-fill targets
 * ("last time 77.5 kg × 5").
 */
export async function lastCompletedSet(userId: string, exerciseName: string): Promise<WorkoutSet | undefined> {
  const exercises = await db.workoutExercises
    .where('exerciseName')
    .equals(exerciseName)
    .filter((e) => e.userId === userId && !e.deleted)
    .toArray()
  if (exercises.length === 0) return undefined
  const ids = new Set(exercises.map((e) => e.id))
  const sets = await db.sets
    .where('userId')
    .equals(userId)
    .filter((s) => ids.has(s.workoutExerciseId) && s.done && !s.deleted)
    .toArray()
  sets.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return sets[0]
}

export async function addExercise(
  userId: string,
  workoutId: string,
  exerciseName: string,
  setCount = 3,
): Promise<{ exercise: WorkoutExercise; sets: WorkoutSet[] }> {
  const t = now()
  const position = await db.workoutExercises
    .where('workoutId')
    .equals(workoutId)
    .filter((e) => !e.deleted)
    .count()
  const last = await lastCompletedSet(userId, exerciseName)
  const exercise = await save('workoutExercises', {
    id: newId(),
    userId,
    workoutId,
    exerciseName,
    position,
    updatedAt: t,
    deleted: false,
  } satisfies WorkoutExercise)
  const sets: WorkoutSet[] = []
  for (let i = 0; i < setCount; i++) {
    sets.push(
      await save('sets', {
        id: newId(),
        userId,
        workoutId,
        workoutExerciseId: exercise.id,
        position: i,
        weightKg: last?.weightKg ?? null,
        reps: last?.reps ?? null,
        done: false,
        updatedAt: t,
        deleted: false,
      } satisfies WorkoutSet),
    )
  }
  return { exercise, sets }
}

export async function addSet(exercise: WorkoutExercise): Promise<WorkoutSet> {
  const existing = await setsForExercise(exercise.id)
  const prev = existing.at(-1)
  return save('sets', {
    id: newId(),
    userId: exercise.userId,
    workoutId: exercise.workoutId,
    workoutExerciseId: exercise.id,
    position: existing.length,
    weightKg: prev?.weightKg ?? null,
    reps: prev?.reps ?? null,
    done: false,
    rpe: null,
    updatedAt: now(),
    deleted: false,
  } satisfies WorkoutSet)
}

export async function updateSet(
  setId: string,
  patch: Partial<Pick<WorkoutSet, 'weightKg' | 'reps' | 'done' | 'rpe'>>,
): Promise<WorkoutSet> {
  // Read and write in one transaction so quick successive edits (blur, then tick) merge instead of clobbering.
  return db.transaction('rw', db.sets, db.outbox, async () => {
    const current = await db.sets.get(setId)
    if (!current) throw new Error(`Set ${setId} not found`)
    return save('sets', { ...current, ...patch, updatedAt: now() })
  })
}

export async function removeSet(setId: string): Promise<void> {
  const current = await db.sets.get(setId)
  if (!current) return
  await save('sets', { ...current, deleted: true, updatedAt: now() })
}

export async function finishWorkout(workoutId: string): Promise<Workout> {
  const current = await db.workouts.get(workoutId)
  if (!current) throw new Error(`Workout ${workoutId} not found`)
  const t = now()
  return save('workouts', { ...current, finishedAt: t, updatedAt: t })
}

export async function discardWorkout(workoutId: string): Promise<void> {
  const current = await db.workouts.get(workoutId)
  if (!current) return
  await save('workouts', { ...current, deleted: true, finishedAt: current.finishedAt ?? now(), updatedAt: now() })
}

export async function exercisesForWorkout(workoutId: string): Promise<WorkoutExercise[]> {
  const rows = await db.workoutExercises.where('workoutId').equals(workoutId).filter((e) => !e.deleted).toArray()
  return rows.sort((a, b) => a.position - b.position)
}

export async function setsForExercise(workoutExerciseId: string): Promise<WorkoutSet[]> {
  const rows = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).filter((s) => !s.deleted).toArray()
  return rows.sort((a, b) => a.position - b.position)
}

export async function workoutHistory(userId: string): Promise<Workout[]> {
  const rows = await db.workouts
    .where('userId')
    .equals(userId)
    .filter((w) => !!w.finishedAt && !w.deleted)
    .toArray()
  return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}

export interface WorkoutSummary {
  exercises: number
  setsDone: number
  volumeKg: number
}

export async function summarise(workoutId: string): Promise<WorkoutSummary> {
  const exercises = await exercisesForWorkout(workoutId)
  const sets = await db.sets.where('workoutId').equals(workoutId).filter((s) => s.done && !s.deleted).toArray()
  const volumeKg = sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0)
  return { exercises: exercises.length, setsDone: sets.length, volumeKg }
}
