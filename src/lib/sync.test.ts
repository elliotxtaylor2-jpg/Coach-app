import { describe, expect, it } from 'vitest'
import { db } from './db'
import { addExercise, startWorkout, updateSet } from './repo'
import { pendingChanges, syncNow, type RemoteAdapter } from './sync'
import type { SyncedRow, TableName } from './types'

/** An in-memory server that can be switched offline. */
function fakeRemote() {
  const store: Record<TableName, Map<string, SyncedRow>> = {
    coachProfiles: new Map(),
    programmes: new Map(),
    programmeVersions: new Map(),
    enrolments: new Map(),
    workouts: new Map(),
    workoutExercises: new Map(),
    sets: new Map(),
    payoutAccounts: new Map(),
    subscriptions: new Map(),
    payments: new Map(),
  }
  const received: { table: TableName; id: string }[] = []
  let online = true
  const remote: RemoteAdapter = {
    async upsert(table, rows) {
      if (!online) throw new Error('Network request failed')
      for (const r of rows) {
        received.push({ table, id: r.id })
        store[table].set(r.id, structuredClone(r))
      }
    },
    async pullSince(table, since) {
      if (!online) throw new Error('Network request failed')
      return [...store[table].values()].filter((r) => r.updatedAt > since)
    },
  }
  return { remote, store, received, setOnline: (v: boolean) => (online = v) }
}

const USER = 'user-a'

// T14: offline logging. Airplane mode, log 3 sets, reconnect → saved locally, synced once, no duplicates.
describe('T14: offline logging', () => {
  it('keeps sets locally while offline and syncs each once on reconnect', async () => {
    const server = fakeRemote()
    server.setOnline(false)

    const w = await startWorkout(USER)
    const { sets } = await addExercise(USER, w.id, 'Back squat', 3)
    for (const s of sets) await updateSet(s.id, { weightKg: 80, reps: 5, done: true })

    const offline = await syncNow(server.remote)
    expect(offline.error).toMatch(/network/i)
    expect(await db.sets.count()).toBe(3)
    expect(await pendingChanges()).toBe(5) // 1 workout + 1 exercise + 3 sets, one entry per row

    server.setOnline(true)
    const online = await syncNow(server.remote)
    expect(online.error).toBeUndefined()
    expect(online.pending).toBe(0)
    expect(server.store.sets.size).toBe(3)
    const setPushes = server.received.filter((r) => r.table === 'sets')
    expect(setPushes).toHaveLength(3)
    expect(new Set(setPushes.map((r) => r.id)).size).toBe(3)
    expect([...server.store.sets.values()].every((s) => (s as unknown as { done: boolean }).done)).toBe(true)
  })

  it('does not resend anything on a second sync', async () => {
    const server = fakeRemote()
    const w = await startWorkout(USER)
    await addExercise(USER, w.id, 'Bench press', 2)
    await syncNow(server.remote)
    const before = server.received.length
    await syncNow(server.remote)
    expect(server.received.length).toBe(before)
  })

  it('keeps a change made during a push queued for the next sync', async () => {
    const server = fakeRemote()
    const w = await startWorkout(USER)
    const { sets } = await addExercise(USER, w.id, 'Bench press', 1)
    const original = server.remote.upsert
    server.remote.upsert = async (table, rows) => {
      await original(table, rows)
      if (table === 'sets') await updateSet(sets[0].id, { reps: 9 }) // user edits mid-push
    }
    await syncNow(server.remote)
    expect(await pendingChanges()).toBe(1)
    server.remote.upsert = original
    await syncNow(server.remote)
    expect((server.store.sets.get(sets[0].id) as unknown as { reps: number }).reps).toBe(9)
  })

  it('pulls newer rows from the server but never overwrites unsynced local edits', async () => {
    const server = fakeRemote()
    const w = await startWorkout(USER)
    await syncNow(server.remote)

    // Another device renamed the workout later.
    server.store.workouts.set(w.id, { ...w, name: 'From phone', updatedAt: new Date(Date.now() + 1000).toISOString() } as SyncedRow)
    await db.meta.put({ key: 'lastPulledAt', value: new Date(0).toISOString() })
    await syncNow(server.remote)
    expect((await db.workouts.get(w.id))?.name).toBe('From phone')
  })
})
