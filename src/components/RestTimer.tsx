import { useEffect, useState } from 'react'
import { formatClock } from '../lib/format'

/** Counts down from `until`; hides itself when finished or dismissed. */
export function RestTimer({ until, onDismiss }: { until: number | null; onDismiss: () => void }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!until) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [until])

  if (!until) return null
  const left = (until - now) / 1000
  return (
    <div className="card dark rest-timer" role="timer" aria-live="off">
      <span className="row" style={{ gap: 14 }}>
        <span className="eyebrow" style={{ color: 'var(--on-dark-muted)' }}>{left > 0 ? 'Rest' : 'Go'}</span>
        <span className="clock">{formatClock(left)}</span>
      </span>
      <button type="button" className="btn" onClick={onDismiss}>{left > 0 ? 'Skip' : 'Done'}</button>
    </div>
  )
}
