import { db } from './db'
import { newId, now, save } from './repo'
import type { CoachProfile, PlannedDay, PlannedExercise, Profile, Programme, ProgrammeContent, ProgrammeOffer, ProgrammeVersion } from './types'

// ---------- Coach profile ----------

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'coach'
  )
}

export async function getCoachProfile(userId: string): Promise<CoachProfile | undefined> {
  const p = await db.coachProfiles.get(userId)
  return p && !p.deleted ? p : undefined
}

/** Creates the coach's profile on first visit, with a free slug based on their name. */
export async function ensureCoachProfile(profile: Profile): Promise<CoachProfile> {
  const existing = await getCoachProfile(profile.id)
  if (existing) return existing
  const base = slugify(profile.displayName)
  let slug = base
  for (let i = 2; await db.coachProfiles.where('slug').equals(slug).count(); i++) slug = `${base}-${i}`
  return save('coachProfiles', {
    id: profile.id,
    userId: profile.id,
    slug,
    displayName: profile.displayName,
    bio: '',
    specialism: '',
    priceGbp: 29.99,
    featuredProgrammeId: null,
    offers: [],
    updatedAt: now(),
    deleted: false,
  } satisfies CoachProfile)
}

export type ProfilePatch = Partial<Pick<CoachProfile, 'displayName' | 'bio' | 'specialism' | 'priceGbp' | 'slug'>>

export function validateProfile(p: ProfilePatch): Partial<Record<keyof ProfilePatch, string>> {
  const errors: Partial<Record<keyof ProfilePatch, string>> = {}
  if (p.displayName !== undefined && !p.displayName.trim()) errors.displayName = 'Enter the name members will see.'
  if (p.slug !== undefined && !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(p.slug))
    errors.slug = 'Use 3–40 lowercase letters, numbers or dashes.'
  if (p.priceGbp !== undefined && (!Number.isFinite(p.priceGbp) || p.priceGbp < 1 || p.priceGbp > 500))
    errors.priceGbp = 'Set a monthly price between £1 and £500.'
  if (p.bio !== undefined && p.bio.length > 500) errors.bio = 'Keep your bio under 500 characters.'
  return errors
}

export async function updateCoachProfile(userId: string, patch: ProfilePatch): Promise<CoachProfile> {
  const errors = validateProfile(patch)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  if (patch.slug) {
    const taken = await db.coachProfiles.where('slug').equals(patch.slug).filter((c) => c.id !== userId && !c.deleted).count()
    if (taken) throw new Error('That link is taken. Try another.')
  }
  const current = await db.coachProfiles.get(userId)
  if (!current) throw new Error('Profile not found')
  return save('coachProfiles', { ...current, ...patch, updatedAt: now() })
}

export async function findCoachBySlug(slug: string): Promise<CoachProfile | undefined> {
  const p = await db.coachProfiles.where('slug').equals(slug).first()
  return p && !p.deleted ? p : undefined
}

// ---------- Programme content helpers ----------

export function emptyExercise(name = ''): PlannedExercise {
  return { id: newId(), name, sets: 3, reps: '8', load: '', restSec: 90, notes: '', videoUrl: '' }
}

function emptyDay(i: number): PlannedDay {
  return { id: newId(), name: `Day ${i + 1}`, exercises: [] }
}

/** Grow or shrink a programme to weeks × days, keeping what's already written. */
export function resizeContent(content: ProgrammeContent, weeks: number, daysPerWeek: number): ProgrammeContent {
  const w = Math.max(1, Math.min(52, Math.round(weeks)))
  const d = Math.max(1, Math.min(7, Math.round(daysPerWeek)))
  return {
    weeks: Array.from({ length: w }, (_, wi) => ({
      days: Array.from({ length: d }, (_, di) => content.weeks[wi]?.days[di] ?? emptyDay(di)),
    })),
  }
}

/** Copy one week's sessions over every other week, with fresh ids. */
export function copyWeekToAll(content: ProgrammeContent, from: number): ProgrammeContent {
  const source = content.weeks[from]
  if (!source) return content
  return {
    weeks: content.weeks.map((week, wi) =>
      wi === from
        ? week
        : {
            days: source.days.map((day) => ({
              ...day,
              id: newId(),
              exercises: day.exercises.map((ex) => ({ ...ex, id: newId() })),
            })),
          },
    ),
  }
}

export const weeksOf = (c: ProgrammeContent) => c.weeks.length
export const daysPerWeekOf = (c: ProgrammeContent) => c.weeks[0]?.days.length ?? 0

/** Numeric reps from text like "8-10" (takes the low end) or "5"; timed sets ("45s") give null. */
export function repsToNumber(reps: string): number | null {
  if (/s$|sec|min/i.test(reps.trim())) return null
  const m = reps.match(/\d+/)
  return m ? Number(m[0]) : null
}

export interface ContentProblem {
  week: number
  day: number
  exerciseId?: string
  message: string
}

/** Everything that blocks publishing. Empty array = ready. */
export function validateContent(c: ProgrammeContent): ContentProblem[] {
  const problems: ContentProblem[] = []
  c.weeks.forEach((week, wi) =>
    week.days.forEach((day, di) => {
      if (day.exercises.length === 0) problems.push({ week: wi, day: di, message: `Week ${wi + 1}, ${day.name || `Day ${di + 1}`} has no exercises.` })
      day.exercises.forEach((ex) => {
        const where = `Week ${wi + 1}, ${day.name || `Day ${di + 1}`}`
        if (!ex.name.trim()) problems.push({ week: wi, day: di, exerciseId: ex.id, message: `${where}: an exercise has no name.` })
        if (!Number.isInteger(ex.sets) || ex.sets < 1 || ex.sets > 20)
          problems.push({ week: wi, day: di, exerciseId: ex.id, message: `${where}: ${ex.name || 'exercise'} needs 1–20 sets.` })
        if (!/^\s*\d+(\s*[-–]\s*\d+)?\s*(s|sec|secs|min|reps?)?\s*$/i.test(ex.reps))
          problems.push({ week: wi, day: di, exerciseId: ex.id, message: `${where}: ${ex.name || 'exercise'} needs reps like 5, 8-10 or 45s.` })
        if (ex.videoUrl && !/^https:\/\//.test(ex.videoUrl))
          problems.push({ week: wi, day: di, exerciseId: ex.id, message: `${where}: ${ex.name || 'exercise'} video link must start with https://` })
      })
    }),
  )
  return problems
}

// ---------- Programmes ----------

export async function createProgramme(coachId: string, title: string, weeks = 4, daysPerWeek = 3): Promise<Programme> {
  return save('programmes', {
    id: newId(),
    userId: coachId,
    title: title.trim() || 'New programme',
    description: '',
    draft: resizeContent({ weeks: [] }, weeks, daysPerWeek),
    latestVersion: 0,
    updatedAt: now(),
    deleted: false,
  } satisfies Programme)
}

export async function listProgrammes(coachId: string): Promise<Programme[]> {
  const rows = await db.programmes.where('userId').equals(coachId).filter((p) => !p.deleted).toArray()
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function saveDraft(programmeId: string, patch: Partial<Pick<Programme, 'title' | 'description' | 'draft'>>): Promise<Programme> {
  return db.transaction('rw', db.programmes, db.outbox, async () => {
    const current = await db.programmes.get(programmeId)
    if (!current) throw new Error('Programme not found')
    return save('programmes', { ...current, ...patch, updatedAt: now() })
  })
}

export async function latestVersion(programmeId: string): Promise<ProgrammeVersion | undefined> {
  const versions = await db.programmeVersions.where('programmeId').equals(programmeId).filter((v) => !v.deleted).toArray()
  return versions.sort((a, b) => b.version - a.version)[0]
}

/** True when the draft differs from what members currently see. */
export async function hasUnpublishedChanges(p: Programme): Promise<boolean> {
  const v = await latestVersion(p.id)
  if (!v) return true
  return v.title !== p.title || JSON.stringify(v.content) !== JSON.stringify(p.draft)
}

/**
 * Publish the draft as a new immutable version. Members pick it up for sessions they haven't done yet;
 * workouts already logged keep their own copy of what was prescribed.
 */
export async function publishProgramme(programmeId: string, opts: { feature?: boolean } = {}): Promise<ProgrammeVersion> {
  const programme = await db.programmes.get(programmeId)
  if (!programme) throw new Error('Programme not found')
  const problems = validateContent(programme.draft)
  if (problems.length) throw new Error(problems[0].message)
  const version = programme.latestVersion + 1
  const t = now()
  const published = await save('programmeVersions', {
    id: newId(),
    userId: programme.userId,
    programmeId,
    version,
    title: programme.title,
    content: structuredClone(programme.draft),
    publishedAt: t,
    updatedAt: t,
    deleted: false,
  } satisfies ProgrammeVersion)
  await save('programmes', { ...programme, latestVersion: version, updatedAt: t })

  // List (or refresh) this programme on the coach's public page.
  const coach = await db.coachProfiles.get(programme.userId)
  if (coach) {
    const offer: ProgrammeOffer = {
      programmeId,
      title: programme.title,
      description: programme.description,
      weeks: weeksOf(programme.draft),
      daysPerWeek: daysPerWeekOf(programme.draft),
    }
    const offers = [...(coach.offers ?? []).filter((o) => o.programmeId !== programmeId), offer]
    await save('coachProfiles', {
      ...coach,
      offers,
      featuredProgrammeId: opts.feature || !coach.featuredProgrammeId ? programmeId : coach.featuredProgrammeId,
      updatedAt: t,
    })
  }
  return published
}

/** Programmes on a coach's page, featured first. */
export function orderedOffers(coach: CoachProfile): ProgrammeOffer[] {
  const offers = coach.offers ?? []
  return [...offers].sort((a, b) => Number(b.programmeId === coach.featuredProgrammeId) - Number(a.programmeId === coach.featuredProgrammeId))
}

/** Show this programme first on the coach's page. */
export async function featureProgramme(coachId: string, programmeId: string): Promise<void> {
  const coach = await db.coachProfiles.get(coachId)
  if (!coach || !(coach.offers ?? []).some((o) => o.programmeId === programmeId)) throw new Error('Publish the programme before featuring it.')
  await save('coachProfiles', { ...coach, featuredProgrammeId: programmeId, updatedAt: now() })
}
