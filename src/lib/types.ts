export type Role = 'coach' | 'member'

export interface Profile {
  id: string
  email: string
  displayName: string
  role: Role
}

/** Fields every synced row carries. */
export interface SyncedRow {
  id: string
  userId: string
  /** ISO timestamp of the last local change; last write wins on sync. */
  updatedAt: string
  /** Soft delete so deletions sync like any other change. */
  deleted: boolean
}

/** What a coach prescribes for one exercise in a session. */
export interface PlannedExercise {
  id: string
  name: string
  sets: number
  /** Text so coaches can write ranges and holds: "5", "8-10", "45s". */
  reps: string
  /** Free text: "RPE 7", "70%", "bodyweight". */
  load: string
  restSec: number | null
  notes: string
  videoUrl: string
}

export interface PlannedDay {
  id: string
  name: string
  exercises: PlannedExercise[]
}

export interface ProgrammeContent {
  weeks: { days: PlannedDay[] }[]
}

export interface CoachProfile extends SyncedRow {
  /** Used in the share link: /c/<slug>. */
  slug: string
  displayName: string
  bio: string
  specialism: string
  priceGbp: number
  /** Shown first on the share page. */
  featuredProgrammeId: string | null
  /** Public summaries of every published programme, so the share page never exposes programme content. */
  offers: ProgrammeOffer[]
}

export interface ProgrammeOffer {
  programmeId: string
  title: string
  description: string
  weeks: number
  daysPerWeek: number
}

/** A coach's programme. Its draft is private to the coach; members only ever see published versions. */
export interface Programme extends SyncedRow {
  title: string
  description: string
  draft: ProgrammeContent
  latestVersion: number
}

/** An immutable published snapshot. Members follow the latest one; logged history keeps pointing at the one it used. */
export interface ProgrammeVersion extends SyncedRow {
  programmeId: string
  version: number
  title: string
  content: ProgrammeContent
  publishedAt: string
}

/** A member following a coach's programme. userId is the member. */
export interface Enrolment extends SyncedRow {
  coachId: string
  programmeId: string
  memberName: string
  status: 'active' | 'cancelled'
  startedAt: string
}

export interface Workout extends SyncedRow {
  name: string
  startedAt: string
  finishedAt: string | null
  enrolmentId?: string | null
  programmeVersionId?: string | null
  weekIndex?: number | null
  dayIndex?: number | null
}

export interface WorkoutExercise extends SyncedRow {
  workoutId: string
  exerciseName: string
  position: number
  /** The coach's prescription, copied in when the session starts so later edits never change history. */
  target?: Omit<PlannedExercise, 'id' | 'name'> | null
}

export interface WorkoutSet extends SyncedRow {
  workoutExerciseId: string
  workoutId: string
  position: number
  weightKg: number | null
  reps: number | null
  done: boolean
}

export type TableName =
  | 'coachProfiles'
  | 'programmes'
  | 'programmeVersions'
  | 'enrolments'
  | 'workouts'
  | 'workoutExercises'
  | 'sets'

export interface OutboxEntry {
  /** One pending change per row: `${table}:${rowId}`. */
  key: string
  table: TableName
  rowId: string
  queuedAt: string
  attempts: number
}
