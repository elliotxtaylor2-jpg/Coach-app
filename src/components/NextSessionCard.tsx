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
        <p style={{ margin: 0 }}>You've finished every session. Your coach will set you up with what's next.</p>
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
    <section className="card stack" aria-label="Next session">
      <span className="eyebrow">Week {weekIndex + 1} · Session {dayIndex + 1}</span>
      <h2>{day.name || `Session ${dayIndex + 1}`}</h2>
      <span className="muted small">
        {version.title}
        {coach ? ` with ${coach.displayName}` : ''} · session {sessionNumber} of {totalSessions}
      </span>
      <div className="progress" aria-label={`This week: ${completedThisWeek} of ${daysPerWeek} sessions done`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small" style={{ fontWeight: 600 }}>This week</span>
          <span className="muted small">{completedThisWeek} of {daysPerWeek}</span>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${(completedThisWeek / daysPerWeek) * 100}%` }} /></div>
      </div>
      <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
        {day.exercises.map((ex) => (
          <li key={ex.id}>
            <span style={{ fontWeight: 600 }}>{ex.name}</span>{' '}
            <span className="muted small">{ex.sets} × {ex.reps}{ex.load ? ` · ${ex.load}` : ''}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn block" onClick={() => void onStart()} disabled={disabled}>Start session</button>
    </section>
  )
}
