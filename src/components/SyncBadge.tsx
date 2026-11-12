import type { SyncStatus } from '../app/useSync'

const LABELS: Record<SyncStatus, string> = {
  'local-only': 'Saved on this device',
  synced: 'Synced',
  pending: 'Waiting to sync',
  syncing: 'Syncing…',
  offline: 'Offline · saved on device',
}

export function SyncBadge({ status, pending }: { status: SyncStatus; pending: number }) {
  const tone = status === 'synced' ? 'good' : status === 'offline' ? 'warn' : ''
  const extra = pending > 0 && status !== 'local-only' ? ` (${pending})` : ''
  return (
    <span className={`badge ${tone}`} role="status">
      {LABELS[status]}
      {extra}
    </span>
  )
}
