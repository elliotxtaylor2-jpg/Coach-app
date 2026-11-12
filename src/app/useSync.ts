import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseAdapter } from '../lib/supabase'
import { pendingChanges, syncNow, type RemoteAdapter } from '../lib/sync'

export type SyncStatus = 'local-only' | 'synced' | 'pending' | 'syncing' | 'offline'

const defaultRemote: RemoteAdapter | null = supabase ? supabaseAdapter(supabase) : null

/** Syncs on load, when the device comes back online, and every 30 seconds. */
export function useSync(remote: RemoteAdapter | null = defaultRemote, enabled = true) {
  const [status, setStatus] = useState<SyncStatus>(remote ? 'pending' : 'local-only')
  const [pending, setPending] = useState(0)

  const run = useCallback(async () => {
    const count = await pendingChanges()
    setPending(count)
    if (!remote || !enabled) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('offline')
      return
    }
    setStatus('syncing')
    const result = await syncNow(remote)
    setPending(result.pending)
    setStatus(result.error ? 'offline' : result.pending > 0 ? 'pending' : 'synced')
  }, [remote, enabled])

  useEffect(() => {
    void run()
    const onOnline = () => void run()
    window.addEventListener('online', onOnline)
    const timer = window.setInterval(() => void run(), 30_000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [run])

  return { status, pending, syncNow: run }
}
