import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RemoteAdapter } from './sync'
import type { SyncedRow, TableName } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null in demo mode (no keys configured): the app then runs fully on-device. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

const REMOTE_TABLE: Record<TableName, string> = {
  workouts: 'workouts',
  workoutExercises: 'workout_exercises',
  sets: 'sets',
}

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function mapKeys(row: Record<string, unknown>, fn: (k: string) => string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [fn(k), v]))
}

export function supabaseAdapter(client: SupabaseClient): RemoteAdapter {
  return {
    async upsert(table, rows) {
      if (rows.length === 0) return
      const payload = rows.map((r) => mapKeys(r as unknown as Record<string, unknown>, toSnake))
      const { error } = await client.from(REMOTE_TABLE[table]).upsert(payload, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    },
    async pullSince(table, sinceIso) {
      const { data, error } = await client.from(REMOTE_TABLE[table]).select('*').gt('updated_at', sinceIso)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => mapKeys(r as Record<string, unknown>, toCamel) as unknown as SyncedRow)
    },
  }
}
