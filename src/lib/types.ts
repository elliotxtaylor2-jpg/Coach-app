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

export interface Workout extends SyncedRow {
  name: string
  startedAt: string
  finishedAt: string | null
}

export interface WorkoutExercise extends SyncedRow {
  workoutId: string
  exerciseName: string
  position: number
}

export interface WorkoutSet extends SyncedRow {
  workoutExerciseId: string
  workoutId: string
  position: number
  weightKg: number | null
  reps: number | null
  done: boolean
}

export type TableName = 'workouts' | 'workoutExercises' | 'sets'

export interface OutboxEntry {
  /** One pending change per row: `${table}:${rowId}`. */
  key: string
  table: TableName
  rowId: string
  queuedAt: string
  attempts: number
}
