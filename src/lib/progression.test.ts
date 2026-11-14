import { describe, expect, it } from 'vitest'
import { createProgramme, emptyExercise, ensureCoachProfile, findCoachBySlug, publishProgramme, saveDraft } from './coach'
import { joinCoach, nextSession, startProgrammeSession, type NextSession } from './enrolment'
import { parseRepRange, suggestNext } from './progression'
import { exercisesForWorkout, finishWorkout, setsForExercise, updateSet } from './repo'
import type { Profile, WorkoutSet } from './types'

// T30: rule-based progressive overload from the last sessions and effort ratings.

let n = 0
const set = (weightKg: number, reps: number, rpe: number | null = null): WorkoutSet => ({
  id: `s${n++}`, userId: 'm', workoutId: 'w', workoutExerciseId: 'e', position: n, weightKg, reps, done: true, rpe, updatedAt: '', deleted: false,
})
const range = { lo: 8, hi: 10 }

describe('parseRepRange', () => {
  it('reads ranges, single counts and rejects timed or open sets', () => {
    expect(parseRepRange('8-10')).toEqual({ lo: 8, hi: 10 })
    expect(parseRepRange('8–10')).toEqual({ lo: 8, hi: 10 })
    expect(parseRepRange('8 to 10')).toEqual({ lo: 8, hi: 10 })
    expect(parseRepRange('5')).toEqual({ lo: 5, hi: 5 })
    expect(parseRepRange('45s')).toBeNull()
    expect(parseRepRange('AMRAP')).toBeNull()
    expect(parseRepRange('')).toBeNull()
  })
})

describe('suggestNext', () => {
  it('first time: no weight, aim for the bottom of the range', () => {
    expect(suggestNext([], range)).toMatchObject({ kind: 'first', weightKg: null, reps: 8 })
  })

  it('every set at the top of the range → add weight and drop to the bottom', () => {
    expect(suggestNext([[set(60, 10), set(60, 10), set(60, 11)]], range)).toMatchObject({ kind: 'up', weightKg: 62.5, reps: 8 })
  })

  it('uses the coach’s weight jump', () => {
    expect(suggestNext([[set(100, 5), set(100, 5)]], { lo: 5, hi: 5 }, { enabled: true, incrementKg: 5 })).toMatchObject({ kind: 'up', weightKg: 105 })
  })

  it('top of the range but every rated set was all-out → hold', () => {
    expect(suggestNext([[set(60, 10, 10), set(60, 10, 10)]], range)).toMatchObject({ kind: 'hold-maxed', weightKg: 60, reps: 10 })
  })

  it('inside the range → same weight, one more rep than the weakest set', () => {
    expect(suggestNext([[set(60, 9), set(60, 8), set(60, 8)]], range)).toMatchObject({ kind: 'add-rep', weightKg: 60, reps: 9 })
  })

  it('short of the range once → hold and aim for the bottom', () => {
    expect(suggestNext([[set(60, 8), set(60, 6)]], range)).toMatchObject({ kind: 'hold', weightKg: 60, reps: 8 })
  })

  it('short two sessions running → about 10% lighter, rounded to the jump', () => {
    const s = suggestNext([[set(60, 6)], [set(60, 7)]], range)
    expect(s).toMatchObject({ kind: 'deload', weightKg: 52.5, reps: 8 })
  })

  it('judges the top working weight, ignoring warm-ups', () => {
    expect(suggestNext([[set(40, 10), set(60, 10), set(60, 10)]], range)).toMatchObject({ kind: 'up', weightKg: 62.5 })
  })
})

describe('progression inside a programme session', () => {
  const coach: Profile = { id: 'coach-p', email: 'c@example.com', displayName: 'Cara Lift', role: 'coach' }
  const member: Profile = { id: 'member-p', email: 'm@example.com', displayName: 'Mo Rep', role: 'member' }

  async function setup(progression?: { enabled: boolean; incrementKg: number }) {
    await ensureCoachProfile(coach)
    const p = await createProgramme(coach.id, 'Hypertrophy', 1, 2)
    const draft = structuredClone(p.draft)
    draft.weeks[0].days.forEach((d) => { d.exercises = [{ ...emptyExercise('Bench press'), sets: 2, reps: '8-10' }] })
    if (progression) draft.progression = progression
    await saveDraft(p.id, { draft })
    await publishProgramme(p.id)
    await joinCoach(member, (await findCoachBySlug('cara-lift'))!, p.id)
  }

  async function logSession(weightKg: number, reps: number) {
    const w = await startProgrammeSession(member.id, (await nextSession(member.id)) as NextSession)
    const [ex] = await exercisesForWorkout(w.id)
    for (const s of await setsForExercise(ex.id)) await updateSet(s.id, { weightKg, reps, done: true })
    await finishWorkout(w.id)
  }

  it('pre-fills the next session’s weight and explains why', async () => {
    await setup()
    await logSession(50, 10)
    const w = await startProgrammeSession(member.id, (await nextSession(member.id)) as NextSession)
    const [ex] = await exercisesForWorkout(w.id)
    expect(ex.target?.progression).toMatchObject({ kind: 'up', reason: expect.stringContaining('+2.5 kg') })
    expect((await setsForExercise(ex.id)).every((s) => s.weightKg === 52.5 && s.reps === 8)).toBe(true)
  })

  it('does nothing extra when the coach switches it off', async () => {
    await setup({ enabled: false, incrementKg: 2.5 })
    await logSession(50, 10)
    const w = await startProgrammeSession(member.id, (await nextSession(member.id)) as NextSession)
    const [ex] = await exercisesForWorkout(w.id)
    expect(ex.target?.progression ?? null).toBeNull()
    expect((await setsForExercise(ex.id)).every((s) => s.weightKg === 50)).toBe(true)
  })
})
