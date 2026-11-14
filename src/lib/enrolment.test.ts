import { describe, expect, it } from 'vitest'
import { createProgramme, emptyExercise, ensureCoachProfile, findCoachBySlug, publishProgramme, saveDraft } from './coach'
import { db } from './db'
import { activeEnrolment, coachMembers, joinCoach, nextSession, startProgrammeSession, type NextSession } from './enrolment'
import { addExercise, exercisesForWorkout, finishWorkout, setsForExercise, startWorkout, updateSet } from './repo'
import type { Profile } from './types'

const coach: Profile = { id: 'coach-1', email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach' }
const member: Profile = { id: 'member-1', email: 'aisha@example.com', displayName: 'Aisha Khan', role: 'member' }

async function publishedProgramme(weeks = 2, days = 2) {
  await ensureCoachProfile(coach)
  const p = await createProgramme(coach.id, 'Strength Block', weeks, days)
  const draft = structuredClone(p.draft)
  draft.weeks.forEach((w, wi) =>
    w.days.forEach((d, di) => {
      d.name = `W${wi + 1} D${di + 1}`
      d.exercises = [
        { ...emptyExercise('Back squat'), sets: 4, reps: '5', load: 'RPE 7', notes: 'Brace hard' },
        { ...emptyExercise('Plank'), sets: 3, reps: '45s' },
      ]
    }),
  )
  await saveDraft(p.id, { draft })
  await publishProgramme(p.id)
  return { programme: p, page: (await findCoachBySlug('sam-rivera'))! }
}

async function doSession(session: NextSession) {
  const w = await startProgrammeSession(member.id, session)
  for (const ex of await exercisesForWorkout(w.id)) {
    for (const s of await setsForExercise(ex.id)) await updateSet(s.id, { weightKg: 80, done: true })
  }
  await finishWorkout(w.id)
  return w
}

describe('joining a coach (free until M3, Q1)', () => {
  it('lets a member join a chosen programme', async () => {
    const { programme, page } = await publishedProgramme()
    const e = await joinCoach(member, page, programme.id)
    expect(e).toMatchObject({ userId: member.id, coachId: coach.id, programmeId: programme.id, memberName: 'Aisha Khan', status: 'active' })
    expect((await activeEnrolment(member.id))?.id).toBe(e.id)
  })

  it('refuses coaches joining and unknown programmes', async () => {
    const { page } = await publishedProgramme()
    await expect(joinCoach(coach, page, page.offers[0].programmeId)).rejects.toThrow(/member accounts/)
    await expect(joinCoach(member, page, 'nope')).rejects.toThrow(/isn’t available/)
  })

  it('switching programme cancels the old enrolment', async () => {
    const { programme, page } = await publishedProgramme()
    const other = await createProgramme(coach.id, 'Second', 1, 1)
    const d = structuredClone(other.draft)
    d.weeks[0].days[0].exercises = [emptyExercise('Row')]
    await saveDraft(other.id, { draft: d })
    await publishProgramme(other.id)
    const first = await joinCoach(member, page, programme.id)
    await joinCoach(member, (await findCoachBySlug('sam-rivera'))!, other.id)
    expect((await db.enrolments.get(first.id))?.status).toBe('cancelled')
    expect((await activeEnrolment(member.id))?.programmeId).toBe(other.id)
  })
})

// T13: today's session comes from the programme, with targets pre-filled.
describe('T13: today’s session from the programme', () => {
  it('shows week 1, session 1 first, then steps through the programme', async () => {
    const { programme, page } = await publishedProgramme(2, 2)
    await joinCoach(member, page, programme.id)
    const first = await nextSession(member.id)
    expect(first).toMatchObject({ weekIndex: 0, dayIndex: 0, sessionNumber: 1, totalSessions: 4 })
    await doSession(first as NextSession)
    expect(await nextSession(member.id)).toMatchObject({ weekIndex: 0, dayIndex: 1, completedThisWeek: 1 })
    await doSession((await nextSession(member.id)) as NextSession)
    expect(await nextSession(member.id)).toMatchObject({ weekIndex: 1, dayIndex: 0, completedThisWeek: 0 })
  })

  it('pre-fills sets from target reps and the member’s last weight, and copies the coach’s notes', async () => {
    const { programme, page } = await publishedProgramme()
    const w0 = await startWorkout(member.id)
    const { sets } = await addExercise(member.id, w0.id, 'Back squat', 1)
    await updateSet(sets[0].id, { weightKg: 77.5, reps: 6, done: true })
    await finishWorkout(w0.id)

    await joinCoach(member, page, programme.id)
    const w = await startProgrammeSession(member.id, (await nextSession(member.id)) as NextSession)
    const [squat, plank] = await exercisesForWorkout(w.id)
    expect(squat.target).toMatchObject({ sets: 4, reps: '5', load: 'RPE 7', notes: 'Brace hard' })
    const squatSets = await setsForExercise(squat.id)
    expect(squatSets).toHaveLength(4)
    // Last time 77.5 kg × 6 beat the target of 5, so progressive overload adds the default 2.5 kg.
    expect(squatSets.every((s) => s.weightKg === 80 && s.reps === 5)).toBe(true)
    expect(squat.target?.progression).toMatchObject({ kind: 'up' })
    expect((await setsForExercise(plank.id)).every((s) => s.reps === null)).toBe(true) // timed set: no rep count
  })

  it('reports the programme complete after the last session', async () => {
    const { programme, page } = await publishedProgramme(1, 1)
    await joinCoach(member, page, programme.id)
    await doSession((await nextSession(member.id)) as NextSession)
    expect(await nextSession(member.id)).toBe('complete')
  })
})

// T07: coach edits a live programme; the member's logged history stays the same, future sessions use the new version.
describe('T07: editing a live programme', () => {
  it('keeps logged sessions unchanged and uses the new version from the next session', async () => {
    const { programme, page } = await publishedProgramme(1, 2)
    await joinCoach(member, page, programme.id)
    const done = await doSession((await nextSession(member.id)) as NextSession)

    const p = (await db.programmes.get(programme.id))!
    const draft = structuredClone(p.draft)
    draft.weeks[0].days[0].exercises = [{ ...emptyExercise('Front squat'), sets: 5, reps: '3' }]
    draft.weeks[0].days[1].exercises = [{ ...emptyExercise('Deadlift'), sets: 3, reps: '5' }]
    await saveDraft(p.id, { draft })
    await publishProgramme(p.id)

    const logged = await exercisesForWorkout(done.id)
    expect(logged.map((e) => e.exerciseName)).toEqual(['Back squat', 'Plank'])
    expect(logged[0].target).toMatchObject({ sets: 4, reps: '5' })

    const next = (await nextSession(member.id)) as NextSession
    expect(next.version.version).toBe(2)
    expect(next.day.exercises.map((e) => e.name)).toEqual(['Deadlift'])
  })
})

describe('coach dashboard members', () => {
  it('lists members with status and last workout date', async () => {
    const { programme, page } = await publishedProgramme()
    await joinCoach(member, page, programme.id)
    expect((await coachMembers(coach.id))[0]).toMatchObject({ lastWorkoutAt: null, sessionsDone: 0 })
    const w = await doSession((await nextSession(member.id)) as NextSession)
    const [row] = await coachMembers(coach.id)
    expect(row.enrolment.memberName).toBe('Aisha Khan')
    expect(row.sessionsDone).toBe(1)
    expect(row.lastWorkoutAt).toBe((await db.workouts.get(w.id))?.finishedAt)
  })
})
