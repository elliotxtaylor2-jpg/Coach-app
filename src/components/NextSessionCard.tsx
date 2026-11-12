import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { nextSession, startProgrammeSession } from '../lib/enrolment'

/** The member's next session from their coach's programme. Renders nothing if they don't follow a coach. */
export function NextSessionCard({ memberId, disabled }: { memberId: string; disabled?: boolean }) {
  const navigate = useNavigate()
  const next = useLiveQuery(() => nextSession(memberId), [memberId])
  const coach = useLiveQuery(async () => (next && next !== 'complete' ? db.coachProfiles.get(next.enrolment.coachId) : undefined), [next])

  if (next === undefined || next === null) return null
  if (next === 'complete') {
    return (
      <div className="card stack">
        <span className="eyebrow">Programme complete</span>
        <p>You've finished every session. Your coach will set you up with what's next.</p>
      </div>
    )
  }

  const { version, weekIndex, dayIndex, day, sessionNumber, totalSessions, completedThisWeek } = next
  const daysPerWeek = version.content.weeks[0].days.length

  async function onStart() {
    if (next === undefined || next === null || next === 'complete') return
    const w = await startProgrammeSession(memberId, next)
    navigate(`/workout/${w.id}`)
  }

  return (
    <section className="card dark stack" aria-label="Next session" style={{ padding: 24, gap: 14 }}>
      <span className="eyebrow" style={{ color: '#d9a57f' }}>Up next · Week {weekIndex + 1}, session {dayIndex + 1}</span>
      <h2 style={{ fontSize: 30 }}>{day.name || `Session ${dayIndex + 1}`}</h2>
      <span className="muted small">
        {version.title}
        {coach ? ` with ${coach.displayName}` : ''} · session {sessionNumber} of {totalSessions}
      </span>
      <div className="progress" aria-label={`This week: ${completedThisWeek} of ${daysPerWeek} sessions done`}>
        <div className="row between">
          <span className="small strong">This week</span>
          <span className="muted small">{completedThisWeek} of {daysPerWeek}</span>
        </div>
        <div className="progress-track" style={{ background: 'rgba(243,238,229,0.15)' }}><div className="progress-fill" style={{ background: '#d9a57f', width: `${(completedThisWeek / daysPerWeek) * 100}%` }} /></div>
      </div>
      <ol className="session-list">
        {day.exercises.map((ex) => (
          <li key={ex.id}>
            <span className="grow strong">{ex.name}</span>
            <span className="muted small">{ex.sets} × {ex.reps}{ex.load ? ` · ${ex.load}` : ''}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn block" style={{ background: 'var(--on-dark)', color: 'var(--ink)', borderColor: 'var(--on-dark)' }} onClick={() => void onStart()} disabled={disabled}>Start session</button>
    </section>
  )
}
