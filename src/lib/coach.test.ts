import { describe, expect, it } from 'vitest'
import {
  copyWeekToAll,
  createProgramme,
  emptyExercise,
  ensureCoachProfile,
  featureProgramme,
  findCoachBySlug,
  latestVersion,
  orderedOffers,
  publishProgramme,
  repsToNumber,
  resizeContent,
  saveDraft,
  slugify,
  updateCoachProfile,
  validateContent,
} from './coach'
import { db } from './db'
import type { Profile, ProgrammeContent } from './types'

const coach: Profile = { id: 'coach-1', email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach' }

/** Fill every session with n valid exercises. */
function filled(content: ProgrammeContent, n: number): ProgrammeContent {
  return {
    weeks: content.weeks.map((w) => ({
      days: w.days.map((d) => ({ ...d, exercises: Array.from({ length: n }, (_, i) => ({ ...emptyExercise(`Exercise ${i + 1}`), sets: 4, reps: '5' })) })),
    })),
  }
}

describe('coach profile and share link', () => {
  it('creates a profile with a link based on the coach’s name', async () => {
    const p = await ensureCoachProfile(coach)
    expect(p.slug).toBe('sam-rivera')
    expect(await findCoachBySlug('sam-rivera')).toMatchObject({ displayName: 'Sam Rivera', priceGbp: 29.99 })
  })

  it('gives a second coach with the same name a different link', async () => {
    await ensureCoachProfile(coach)
    const other = await ensureCoachProfile({ ...coach, id: 'coach-2' })
    expect(other.slug).toBe('sam-rivera-2')
  })

  it('saves bio and price, and refuses a taken or malformed link', async () => {
    await ensureCoachProfile(coach)
    await ensureCoachProfile({ ...coach, id: 'coach-2', displayName: 'Jo Bloggs' })
    const updated = await updateCoachProfile(coach.id, { bio: 'Strength for busy people', priceGbp: 35 })
    expect(updated).toMatchObject({ bio: 'Strength for busy people', priceGbp: 35 })
    await expect(updateCoachProfile(coach.id, { slug: 'jo-bloggs' })).rejects.toThrow(/taken/)
    await expect(updateCoachProfile(coach.id, { slug: 'Bad Link!' })).rejects.toThrow(/lowercase/)
    await expect(updateCoachProfile(coach.id, { priceGbp: 0 })).rejects.toThrow(/£1/)
  })

  it('makes clean links from awkward names', () => {
    expect(slugify('  Zoë  O’Brien-Smith ')).toBe('zoe-o-brien-smith')
    expect(slugify('!!!')).toBe('coach')
  })
})

// T05: build 4 weeks × 3 days × 5 exercises and publish; all 60 entries saved in order.
describe('T05: build and publish a programme', () => {
  it('publishes all 60 exercise entries in order', async () => {
    await ensureCoachProfile(coach)
    const p = await createProgramme(coach.id, 'Strength Block', 4, 3)
    await saveDraft(p.id, { draft: filled(p.draft, 5) })
    const v = await publishProgramme(p.id)
    expect(v.version).toBe(1)
    const entries = v.content.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises))
    expect(entries).toHaveLength(60)
    expect(v.content.weeks[2].days[1].exercises.map((e) => e.name)).toEqual(['Exercise 1', 'Exercise 2', 'Exercise 3', 'Exercise 4', 'Exercise 5'])
  })

  it('lists a published programme on the coach’s page without exposing its sessions', async () => {
    await ensureCoachProfile(coach)
    const p = await createProgramme(coach.id, 'Strength Block', 8, 3)
    await saveDraft(p.id, { description: 'Barbell basics', draft: filled(p.draft, 2) })
    await publishProgramme(p.id)
    const page = await findCoachBySlug('sam-rivera')
    expect(page?.offers).toEqual([{ programmeId: p.id, title: 'Strength Block', description: 'Barbell basics', weeks: 8, daysPerWeek: 3 }])
    expect(JSON.stringify(page)).not.toContain('Exercise 1')
  })

  it('lists several programmes, with the coach’s pick first', async () => {
    await ensureCoachProfile(coach)
    const a = await createProgramme(coach.id, 'Strength', 2, 2)
    const b = await createProgramme(coach.id, 'Hypertrophy', 2, 2)
    await saveDraft(a.id, { draft: filled(a.draft, 1) })
    await saveDraft(b.id, { draft: filled(b.draft, 1) })
    await publishProgramme(a.id)
    await publishProgramme(b.id)
    let page = (await findCoachBySlug('sam-rivera'))!
    expect(orderedOffers(page).map((o) => o.title)).toEqual(['Strength', 'Hypertrophy'])
    await featureProgramme(coach.id, b.id)
    page = (await findCoachBySlug('sam-rivera'))!
    expect(orderedOffers(page).map((o) => o.title)).toEqual(['Hypertrophy', 'Strength'])
  })
})

// T06: an exercise with no sets or reps blocks publishing, with a message saying where.
describe('T06: validation before publishing', () => {
  it('reports empty sessions and bad exercises by week and session', () => {
    const content = resizeContent({ weeks: [] }, 1, 2)
    content.weeks[0].days[0].exercises = [{ ...emptyExercise('Back squat'), sets: 0 }, { ...emptyExercise('Plank'), reps: '' }]
    const problems = validateContent(content).map((p) => p.message)
    expect(problems).toEqual([
      'Week 1, Day 1: Back squat needs 1–20 sets.',
      'Week 1, Day 1: Plank needs reps like 5, 8-10 or 45s.',
      'Week 1, Day 2 has no exercises.',
    ])
  })

  it('refuses to publish an invalid programme and publishes nothing', async () => {
    await ensureCoachProfile(coach)
    const p = await createProgramme(coach.id, 'Empty', 1, 1)
    await expect(publishProgramme(p.id)).rejects.toThrow(/no exercises/)
    expect(await latestVersion(p.id)).toBeUndefined()
  })

  it('accepts rep ranges and timed sets (Q4)', () => {
    const content = resizeContent({ weeks: [] }, 1, 1)
    content.weeks[0].days[0].exercises = [
      { ...emptyExercise('Bench'), reps: '8-10' },
      { ...emptyExercise('Plank'), reps: '45s' },
      { ...emptyExercise('Squat'), reps: '5' },
    ]
    expect(validateContent(content)).toEqual([])
    expect([repsToNumber('8-10'), repsToNumber('45s'), repsToNumber('5')]).toEqual([8, null, 5])
  })
})

describe('programme editing tools', () => {
  it('resizes without losing sessions already written', () => {
    const c = filled(resizeContent({ weeks: [] }, 2, 2), 1)
    const grown = resizeContent(c, 3, 3)
    expect(grown.weeks).toHaveLength(3)
    expect(grown.weeks[0].days).toHaveLength(3)
    expect(grown.weeks[1].days[1].exercises[0].name).toBe('Exercise 1')
    expect(grown.weeks[2].days[0].exercises).toEqual([])
  })

  it('copies one week to every other week with fresh ids', () => {
    const c = resizeContent({ weeks: [] }, 3, 1)
    c.weeks[0].days[0].exercises = [emptyExercise('Deadlift')]
    const copied = copyWeekToAll(c, 0)
    expect(copied.weeks.map((w) => w.days[0].exercises[0].name)).toEqual(['Deadlift', 'Deadlift', 'Deadlift'])
    expect(new Set(copied.weeks.map((w) => w.days[0].exercises[0].id)).size).toBe(3)
  })

  it('keeps each published version unchanged when the draft changes', async () => {
    await ensureCoachProfile(coach)
    const p = await createProgramme(coach.id, 'Block', 1, 1)
    await saveDraft(p.id, { draft: filled(p.draft, 1) })
    const v1 = await publishProgramme(p.id)
    const edited = filled(p.draft, 2)
    await saveDraft(p.id, { draft: edited })
    const v2 = await publishProgramme(p.id)
    expect(v2.version).toBe(2)
    expect((await db.programmeVersions.get(v1.id))?.content.weeks[0].days[0].exercises).toHaveLength(1)
    expect((await latestVersion(p.id))?.id).toBe(v2.id)
  })
})
