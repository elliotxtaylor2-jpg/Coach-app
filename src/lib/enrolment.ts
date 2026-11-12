import { latestVersion, repsToNumber } from './coach'
import { db } from './db'
import { lastCompletedSet, newId, now, save } from './repo'
import { programmeAccess, type Access } from './billing'
import type { CoachProfile, Enrolment, PlannedDay, Profile, ProgrammeVersion, Subscription, Workout, WorkoutExercise, WorkoutSet } from './types'

/** Join one of a coach's published programmes. Free in M2; M3 puts payment in front of this. */
export async function joinCoach(member: Profile, coach: CoachProfile, programmeId: string): Promise<Enrolment> {
  if (member.role !== 'member') throw new Error('Only member accounts can join a coach.')
  if (!(coach.offers ?? []).some((o) => o.programmeId === programmeId)) throw new Error('That programme isn’t available.')
  const existing = await activeEnrolment(member.id)
  if (existing?.coachId === coach.id && existing.programmeId === programmeId) return existing
  const t = now()
  if (existing) await save('enrolments', { ...existing, status: 'cancelled', updatedAt: t })
  return save('enrolments', {
    id: newId(),
    userId: member.id,
    coachId: coach.id,
    programmeId,
    memberName: member.displayName,
    status: 'active',
    startedAt: t,
    billing: 'beta',
    updatedAt: t,
    deleted: false,
  } satisfies Enrolment)
}

export async function activeEnrolment(memberId: string): Promise<Enrolment | undefined> {
  const rows = await db.enrolments.where('userId').equals(memberId).filter((e) => e.status === 'active' && !e.deleted).toArray()
  return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]
}

export async function leaveCoach(enrolmentId: string): Promise<void> {
  const e = await db.enrolments.get(enrolmentId)
  if (e) await save('enrolments', { ...e, status: 'cancelled', updatedAt: now() })
}

export interface NextSession {
  enrolment: Enrolment
  version: ProgrammeVersion
  weekIndex: number
  dayIndex: number
  day: PlannedDay
  sessionNumber: number
  totalSessions: number
  completedThisWeek: number
}

/**
 * The next session to do: count finished programme workouts and step through weeks × days
 * of the latest published version. Returns null when the programme is complete or not yet synced.
 */
export async function nextSession(memberId: string): Promise<NextSession | null | 'complete'> {
  const enrolment = await activeEnrolment(memberId)
  if (!enrolment) return null
  const version = await latestVersion(enrolment.programmeId)
  if (!version) return null
  const done = await db.workouts
    .where('enrolmentId')
    .equals(enrolment.id)
    .filter((w) => !!w.finishedAt && !w.deleted && w.weekIndex != null)
    .toArray()
  const daysPerWeek = version.content.weeks[0]?.days.length ?? 0
  const totalSessions = version.content.weeks.length * daysPerWeek
  const sessionNumber = done.length
  if (daysPerWeek === 0 || sessionNumber >= totalSessions) return 'complete'
  const weekIndex = Math.floor(sessionNumber / daysPerWeek)
  const dayIndex = sessionNumber % daysPerWeek
  return {
    enrolment,
    version,
    weekIndex,
    dayIndex,
    day: version.content.weeks[weekIndex].days[dayIndex],
    sessionNumber: sessionNumber + 1,
    totalSessions,
    completedThisWeek: done.filter((w) => w.weekIndex === weekIndex).length,
  }
}

/**
 * Start a programme session: copy the coach's prescription into the workout (so later edits never
 * rewrite history) and pre-fill each set from the target reps and the member's last weight.
 */
export async function startProgrammeSession(memberId: string, session: NextSession): Promise<Workout> {
  const t = now()
  const workout = await save('workouts', {
    id: newId(),
    userId: memberId,
    name: session.day.name || `Week ${session.weekIndex + 1}, Day ${session.dayIndex + 1}`,
    startedAt: t,
    finishedAt: null,
    enrolmentId: session.enrolment.id,
    programmeVersionId: session.version.id,
    weekIndex: session.weekIndex,
    dayIndex: session.dayIndex,
    updatedAt: t,
    deleted: false,
  } satisfies Workout)

  for (const [position, planned] of session.day.exercises.entries()) {
    const { id: _id, name, ...target } = planned
    const exercise = await save('workoutExercises', {
      id: newId(),
      userId: memberId,
      workoutId: workout.id,
      exerciseName: name,
      position,
      target,
      updatedAt: t,
      deleted: false,
    } satisfies WorkoutExercise)
    const last = await lastCompletedSet(memberId, name)
    const targetReps = repsToNumber(planned.reps)
    for (let i = 0; i < planned.sets; i++) {
      await save('sets', {
        id: newId(),
        userId: memberId,
        workoutId: workout.id,
        workoutExerciseId: exercise.id,
        position: i,
        weightKg: last?.weightKg ?? null,
        reps: targetReps ?? last?.reps ?? null,
        done: false,
        updatedAt: t,
        deleted: false,
      } satisfies WorkoutSet)
    }
  }
  return workout
}

// ---------- Coach's view of members ----------

export interface MemberSummary {
  enrolment: Enrolment
  lastWorkoutAt: string | null
  sessionsDone: number
}

export async function coachMembers(coachId: string): Promise<MemberSummary[]> {
  const enrolments = await db.enrolments.where('coachId').equals(coachId).filter((e) => !e.deleted).toArray()
  const out: MemberSummary[] = []
  for (const enrolment of enrolments) {
    const workouts = await db.workouts.where('userId').equals(enrolment.userId).filter((w) => !!w.finishedAt && !w.deleted).toArray()
    const last = workouts.map((w) => w.finishedAt as string).sort().at(-1) ?? null
    out.push({ enrolment, lastWorkoutAt: last, sessionsDone: workouts.filter((w) => w.enrolmentId === enrolment.id).length })
  }
  return out.sort((a, b) => (a.enrolment.status === b.enrolment.status ? (b.lastWorkoutAt ?? '').localeCompare(a.lastWorkoutAt ?? '') : a.enrolment.status === 'active' ? -1 : 1))
}

// ---------- Member's billing state ----------

export interface MemberStatus {
  enrolment: Enrolment
  coach: CoachProfile | undefined
  subscription: Subscription | undefined
  access: Access
}

/** Everything the member's home needs to decide what to show: can they train, and what to tell them. */
export async function memberStatus(memberId: string, now = new Date().toISOString()): Promise<MemberStatus | null> {
  const enrolment = await activeEnrolment(memberId)
  if (!enrolment) return null
  const coach = await db.coachProfiles.get(enrolment.coachId)
  const subscription = (await db.subscriptions.where('enrolmentId').equals(enrolment.id).toArray()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
  const access = programmeAccess({
    billing: enrolment.billing ?? 'beta',
    betaEndsAt: coach?.betaEndsAt ?? null,
    subscription: subscription ? { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd } : null,
    now,
  })
  return { enrolment, coach, subscription, access }
}
