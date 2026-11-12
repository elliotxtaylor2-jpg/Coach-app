import Dexie, { type EntityTable } from 'dexie'
import type {
  CoachProfile,
  Enrolment,
  OutboxEntry,
  Programme,
  ProgrammeVersion,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './types'

export class AppDB extends Dexie {
  coachProfiles!: EntityTable<CoachProfile, 'id'>
  programmes!: EntityTable<Programme, 'id'>
  programmeVersions!: EntityTable<ProgrammeVersion, 'id'>
  enrolments!: EntityTable<Enrolment, 'id'>
  workouts!: EntityTable<Workout, 'id'>
  workoutExercises!: EntityTable<WorkoutExercise, 'id'>
  sets!: EntityTable<WorkoutSet, 'id'>
  outbox!: EntityTable<OutboxEntry, 'key'>
  meta!: EntityTable<{ key: string; value: string }, 'key'>

  constructor(name = 'coach-app') {
    super(name)
    this.version(1).stores({
      workouts: 'id, userId, startedAt, finishedAt',
      workoutExercises: 'id, workoutId, userId, exerciseName',
      sets: 'id, workoutExerciseId, workoutId, userId',
      outbox: 'key, queuedAt',
      meta: 'key',
    })
    // M2: coaches, programmes and enrolments. Existing M1 data is kept as is.
    this.version(2).stores({
      coachProfiles: 'id, userId, slug',
      programmes: 'id, userId',
      programmeVersions: 'id, programmeId, userId, [programmeId+version]',
      enrolments: 'id, userId, coachId, programmeId',
      workouts: 'id, userId, startedAt, finishedAt, enrolmentId',
    })
  }
}

export let db = new AppDB()

/** Tests use a fresh database per case. */
export function resetDb(name: string): AppDB {
  // The old instance is left open: late async work from a finished test can still settle harmlessly.
  db = new AppDB(name)
  return db
}
