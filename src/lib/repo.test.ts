import { describe, expect, it } from 'vitest'
import { db } from './db'
import {
  addExercise,
  addSet,
  discardWorkout,
  finishWorkout,
  getActiveWorkout,
  lastCompletedSet,
  removeSet,
  setsForExercise,
  startWorkout,
  summarise,
  updateSet,
  workoutHistory,
} from './repo'

const USER = 'user-a'

describe('workout logging', () => {
  it('starts a workout and makes it the active one', async () => {
    const w = await startWorkout(USER)
    expect((await getActiveWorkout(USER))?.id).toBe(w.id)
  })

  it('adds an exercise with three empty sets by default', async () => {
    const w = await startWorkout(USER)
    const { sets } = await addExercise(USER, w.id, 'Back squat')
    expect(sets).toHaveLength(3)
    expect(sets.every((s) => s.weightKg === null && s.reps === null && !s.done)).toBe(true)
  })

  it('saves weight, reps and done on a set', async () => {
    const w = await startWorkout(USER)
    const { sets } = await addExercise(USER, w.id, 'Back squat')
    await updateSet(sets[0].id, { weightKg: 80, reps: 5, done: true })
    const saved = await db.sets.get(sets[0].id)
    expect(saved).toMatchObject({ weightKg: 80, reps: 5, done: true })
  })

  it('copies the previous set when adding a set', async () => {
    const w = await startWorkout(USER)
    const { exercise, sets } = await addExercise(USER, w.id, 'Bench press', 1)
    await updateSet(sets[0].id, { weightKg: 60, reps: 8 })
    const added = await addSet(exercise)
    expect(added).toMatchObject({ weightKg: 60, reps: 8, position: 1, done: false })
  })

  it('removes a set without hard-deleting it, so the deletion can sync', async () => {
    const w = await startWorkout(USER)
    const { exercise, sets } = await addExercise(USER, w.id, 'Bench press', 2)
    await removeSet(sets[0].id)
    expect(await setsForExercise(exercise.id)).toHaveLength(1)
    expect((await db.sets.get(sets[0].id))?.deleted).toBe(true)
  })

  it('lists only finished, non-discarded workouts in history, newest first', async () => {
    const a = await startWorkout(USER, 'A')
    await finishWorkout(a.id)
    await new Promise((r) => setTimeout(r, 5))
    const b = await startWorkout(USER, 'B')
    await finishWorkout(b.id)
    const c = await startWorkout(USER, 'C')
    await discardWorkout(c.id)
    await startWorkout(USER, 'Still going')
    const history = await workoutHistory(USER)
    expect(history.map((w) => w.name)).toEqual(['B', 'A'])
  })

  it('never shows another user’s workouts', async () => {
    const mine = await startWorkout(USER)
    await finishWorkout(mine.id)
    const theirs = await startWorkout('user-b')
    await finishWorkout(theirs.id)
    expect((await workoutHistory(USER)).map((w) => w.id)).toEqual([mine.id])
  })

  it('summarises exercises, completed sets and volume', async () => {
    const w = await startWorkout(USER)
    const { sets } = await addExercise(USER, w.id, 'Back squat', 2)
    await updateSet(sets[0].id, { weightKg: 100, reps: 5, done: true })
    await updateSet(sets[1].id, { weightKg: 100, reps: 5, done: false })
    expect(await summarise(w.id)).toEqual({ exercises: 1, setsDone: 1, volumeKg: 500 })
  })
})

// T13 (adapted for M1, before coach programmes exist): today's session pre-fills targets from last time.
describe('T13: pre-filled targets', () => {
  it('pre-fills a new exercise with the last completed weight and reps', async () => {
    const first = await startWorkout(USER)
    const { sets } = await addExercise(USER, first.id, 'Back squat', 1)
    await updateSet(sets[0].id, { weightKg: 77.5, reps: 5, done: true })
    await finishWorkout(first.id)

    const second = await startWorkout(USER)
    const { sets: next } = await addExercise(USER, second.id, 'Back squat')
    expect(next.every((s) => s.weightKg === 77.5 && s.reps === 5)).toBe(true)
  })

  it('ignores sets that were never marked done', async () => {
    const w = await startWorkout(USER)
    const { sets } = await addExercise(USER, w.id, 'Deadlift', 1)
    await updateSet(sets[0].id, { weightKg: 140, reps: 3, done: false })
    expect(await lastCompletedSet(USER, 'Deadlift')).toBeUndefined()
  })
})
