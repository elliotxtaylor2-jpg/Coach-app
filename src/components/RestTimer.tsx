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
    <div className="card dark row" role="timer" aria-live="off" style={{ justifyContent: 'space-between', position: 'sticky', bottom: 12 }}>
      <span className="stack" style={{ gap: 2 }}>
        <span className="muted small">{left > 0 ? 'Rest' : 'Rest over'}</span>
        <span className="big-number">{formatClock(left)}</span>
      </span>
      <button type="button" className="btn secondary" onClick={onDismiss}>{left > 0 ? 'Skip' : 'Done'}</button>
    </div>
  )
}
