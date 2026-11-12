import { db } from './db'
import type { SyncedRow, TableName } from './types'

/** Where synced rows go. Supabase in production; a fake in tests. */
export interface RemoteAdapter {
  /** Insert or update rows by id. Must be idempotent: sending the same row twice is safe. */
  upsert(table: TableName, rows: SyncedRow[]): Promise<void>
  /** Rows changed on the server since an ISO timestamp, for this user. */
  pullSince(table: TableName, sinceIso: string): Promise<SyncedRow[]>
  /** Public coach page lookup for visitors who haven't synced that coach yet. */
  getCoachBySlug?(slug: string): Promise<SyncedRow | null>
}

export interface SyncResult {
  pushed: number
  pulled: number
  pending: number
  error?: string
}

/** Parents before children, so foreign keys on the server are satisfied. */
const TABLES: TableName[] = ['coachProfiles', 'programmes', 'programmeVersions', 'enrolments', 'workouts', 'workoutExercises', 'sets', 'payoutAccounts', 'subscriptions', 'payments']

/**
 * Push every queued local change, then pull remote changes.
 * Conflicts resolve by last write wins on updatedAt.
 * Safe to call repeatedly: offline failures leave the queue intact for next time.
 */
export async function syncNow(remote: RemoteAdapter): Promise<SyncResult> {
  let pushed = 0
  let pulled = 0
  try {
    const entries = await db.outbox.orderBy('queuedAt').toArray()
    for (const table of TABLES) {
      const forTable = entries.filter((e) => e.table === table)
      if (forTable.length === 0) continue
      const rows = (await db.table(table).bulkGet(forTable.map((e) => e.rowId))).filter(Boolean) as SyncedRow[]
      try {
        await remote.upsert(table, rows)
      } catch (err) {
        await db.transaction('rw', db.outbox, async () => {
          for (const e of forTable) await db.outbox.update(e.key, { attempts: e.attempts + 1 })
        })
        throw err
      }
      // Only clear entries that weren't changed again while we were pushing.
      await db.transaction('rw', db.outbox, async () => {
        for (const e of forTable) {
          const latest = await db.outbox.get(e.key)
          if (latest && latest.queuedAt === e.queuedAt) await db.outbox.delete(e.key)
        }
      })
      pushed += rows.length
    }

    const since = (await db.meta.get('lastPulledAt'))?.value ?? new Date(0).toISOString()
    const pullStartedAt = new Date().toISOString()
    for (const table of TABLES) {
      const remoteRows = await remote.pullSince(table, since)
      for (const row of remoteRows) {
        const local = (await db.table(table).get(row.id)) as SyncedRow | undefined
        const hasPendingLocal = !!(await db.outbox.get(`${table}:${row.id}`))
        if (!local || (!hasPendingLocal && row.updatedAt > local.updatedAt)) {
          await db.table(table).put(row)
          pulled++
        }
      }
    }
    await db.meta.put({ key: 'lastPulledAt', value: pullStartedAt })
    return { pushed, pulled, pending: await db.outbox.count() }
  } catch (err) {
    return { pushed, pulled, pending: await db.outbox.count(), error: err instanceof Error ? err.message : String(err) }
  }
}

export async function pendingChanges(): Promise<number> {
  return db.outbox.count()
}
