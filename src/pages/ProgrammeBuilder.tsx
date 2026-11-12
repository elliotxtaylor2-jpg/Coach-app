import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { PlusIcon, TrashIcon } from '../components/Icons'
import {
  copyWeekToAll,
  daysPerWeekOf,
  emptyExercise,
  featureProgramme,
  getCoachProfile,
  hasUnpublishedChanges,
  publishProgramme,
  resizeContent,
  saveDraft,
  validateContent,
  weeksOf,
} from '../lib/coach'
import { db } from '../lib/db'
import { EXERCISES } from '../lib/exercises'
import type { PlannedExercise, Programme, ProgrammeContent } from '../lib/types'

export function ProgrammeBuilder() {
  const { id = '' } = useParams()
  const profile = useProfile()
  const stored = useLiveQuery(async () => (await db.programmes.get(id)) ?? null, [id])
  if (stored === undefined) return <p className="center muted">Loading…</p>
  if (!stored || stored.userId !== profile.id || stored.deleted) {
    return (
      <main className="shell">
        <h1>Programme not found</h1>
        <Link to="/coach">Back to dashboard</Link>
      </main>
    )
  }
  return <Editor key={stored.id} initial={stored} />
}

function Editor({ initial }: { initial: Programme }) {
  const profile = useProfile()
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [draft, setDraft] = useState<ProgrammeContent>(initial.draft)
  const [week, setWeek] = useState(0)
  const [day, setDay] = useState(0)
  const [message, setMessage] = useState<{ tone: 'good' | 'error'; text: string } | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const programme = useLiveQuery(() => db.programmes.get(initial.id), [initial.id]) ?? initial
  const coach = useLiveQuery(() => getCoachProfile(profile.id), [profile.id])
  const unpublished = useLiveQuery(async () => (await hasUnpublishedChanges({ ...programme, title, draft })) || programme.description !== description, [programme, title, draft, description])

  // Autosave the draft half a second after the last edit.
  const timer = useRef<number | undefined>(undefined)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void saveDraft(initial.id, { title, description, draft }), 500)
    return () => window.clearTimeout(timer.current)
  }, [title, description, draft, initial.id])

  const problems = useMemo(() => validateContent(draft), [draft])
  const weeks = weeksOf(draft)
  const days = daysPerWeekOf(draft)
  const w = Math.min(week, weeks - 1)
  const d = Math.min(day, days - 1)
  const current = draft.weeks[w].days[d]

  const updateDay = (fn: (exs: PlannedExercise[]) => PlannedExercise[], name?: string) => {
    setMessage(null)
    setDraft((c) => ({
      weeks: c.weeks.map((wk, wi) =>
        wi !== w ? wk : { days: wk.days.map((dy, di) => (di !== d ? dy : { ...dy, name: name ?? dy.name, exercises: fn(dy.exercises) })) },
      ),
    }))
  }
  const updateExercise = (exId: string, patch: Partial<PlannedExercise>) => updateDay((exs) => exs.map((e) => (e.id === exId ? { ...e, ...patch } : e)))
  const move = (index: number, by: number) =>
    updateDay((exs) => {
      const next = [...exs]
      const [item] = next.splice(index, 1)
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item)
      return next
    })

  async function onPublish() {
    setShowProblems(true)
    if (problems.length) {
      setMessage({ tone: 'error', text: `Fix ${problems.length} ${problems.length === 1 ? 'issue' : 'issues'} before publishing.` })
      return
    }
    try {
      window.clearTimeout(timer.current)
      await saveDraft(initial.id, { title, description, draft })
      const v = await publishProgramme(initial.id)
      setMessage({ tone: 'good', text: `Published version ${v.version}. Members get it from their next session; their logged history stays as it was.` })
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not publish.' })
    }
  }

  const status = programme.latestVersion === 0 ? 'Not published' : unpublished ? `Unpublished changes · live: v${programme.latestVersion}` : `Published · v${programme.latestVersion}`
  const featured = coach?.featuredProgrammeId === initial.id

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/coach" className="small">← Dashboard</Link>
        <span className={`badge ${programme.latestVersion && !unpublished ? 'good' : unpublished && programme.latestVersion ? 'warn' : ''}`}>{status}</span>
      </div>

      <div className="field">
        <label htmlFor="title">Programme name</label>
        <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="description">Short description for your page</label>
        <input id="description" className="input" maxLength={140} value={description} placeholder="e.g. Barbell basics for busy people" onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="segmented">
        <div className="field">
          <label htmlFor="weeks">Weeks</label>
          <select id="weeks" className="input" value={weeks} onChange={(e) => setDraft((c) => resizeContent(c, Number(e.target.value), days))}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="days">Sessions a week</label>
          <select id="days" className="input" value={days} onChange={(e) => setDraft((c) => resizeContent(c, weeks, Number(e.target.value)))}>
            {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Week">
        {draft.weeks.map((_, i) => (
          <button key={i} type="button" role="tab" className="choice tab" aria-pressed={i === w} aria-selected={i === w} onClick={() => setWeek(i)}>Wk {i + 1}</button>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="Session">
        {draft.weeks[w].days.map((dy, i) => (
          <button key={dy.id} type="button" role="tab" className="choice tab" aria-pressed={i === d} aria-selected={i === d} onClick={() => setDay(i)}>{dy.name || `Day ${i + 1}`}</button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="day-name">Session name</label>
        <input id="day-name" className="input" value={current.name} onChange={(e) => updateDay((x) => x, e.target.value)} placeholder="e.g. Lower body strength" />
      </div>

      <datalist id="exercise-library">{EXERCISES.map((e) => <option key={e} value={e} />)}</datalist>

      {current.exercises.map((ex, i) => {
        const exProblems = showProblems ? problems.filter((p) => p.exerciseId === ex.id) : []
        const label = ex.name || `Exercise ${i + 1}`
        return (
          <section key={ex.id} className="card stack" aria-label={label}>
            <div className="row">
              <input className="input grow" list="exercise-library" aria-label={`Exercise ${i + 1} name`} placeholder="Exercise name" value={ex.name} onChange={(e) => updateExercise(ex.id, { name: e.target.value })} />
              <button type="button" className="icon-btn" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" aria-label={`Move ${label} down`} disabled={i === current.exercises.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="icon-btn" aria-label={`Remove ${label}`} onClick={() => updateDay((exs) => exs.filter((e) => e.id !== ex.id))}><TrashIcon /></button>
            </div>
            <div className="stat-grid">
              <div className="field">
                <label htmlFor={`${ex.id}-sets`} className="small">Sets</label>
                <input id={`${ex.id}-sets`} className="input" inputMode="numeric" value={Number.isNaN(ex.sets) ? '' : ex.sets} onChange={(e) => updateExercise(ex.id, { sets: e.target.value === '' ? NaN : Number(e.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor={`${ex.id}-reps`} className="small">Reps</label>
                <input id={`${ex.id}-reps`} className="input" value={ex.reps} placeholder="8-10" onChange={(e) => updateExercise(ex.id, { reps: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${ex.id}-rest`} className="small">Rest (s)</label>
                <input id={`${ex.id}-rest`} className="input" inputMode="numeric" value={ex.restSec ?? ''} onChange={(e) => updateExercise(ex.id, { restSec: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor={`${ex.id}-load`} className="small">Load</label>
              <input id={`${ex.id}-load`} className="input" value={ex.load} placeholder="RPE 7, 70%, bodyweight" onChange={(e) => updateExercise(ex.id, { load: e.target.value })} />
            </div>
            <details>
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Notes and video</summary>
              <div className="stack" style={{ marginTop: 10 }}>
                <div className="field">
                  <label htmlFor={`${ex.id}-notes`} className="small">Coaching notes</label>
                  <input id={`${ex.id}-notes`} className="input" value={ex.notes} onChange={(e) => updateExercise(ex.id, { notes: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${ex.id}-video`} className="small">Video link</label>
                  <input id={`${ex.id}-video`} className="input" inputMode="url" placeholder="https://" value={ex.videoUrl} onChange={(e) => updateExercise(ex.id, { videoUrl: e.target.value })} />
                </div>
              </div>
            </details>
            {exProblems.map((p) => <p key={p.message} className="error small" style={{ margin: 0 }}>{p.message}</p>)}
          </section>
        )
      })}

      <button type="button" className="btn dashed" onClick={() => updateDay((exs) => [...exs, emptyExercise()])}>
        <PlusIcon /> Add exercise
      </button>
      {weeks > 1 && (
        <button type="button" className="btn ghost" onClick={() => setDraft((c) => copyWeekToAll(c, w))}>Copy week {w + 1} to all weeks</button>
      )}

      <div className="spacer" />
      {showProblems && problems.length > 0 && (
        <div className="card stack" role="alert">
          <span className="label">Before you publish</span>
          {problems.slice(0, 6).map((p, i) => (
            <button key={i} type="button" className="btn ghost small" style={{ justifyContent: 'flex-start', minHeight: 32 }} onClick={() => { setWeek(p.week); setDay(p.day) }}>{p.message}</button>
          ))}
          {problems.length > 6 && <span className="muted small">…and {problems.length - 6} more</span>}
        </div>
      )}
      {message && <p className={message.tone === 'good' ? 'note' : 'error'} role="status">{message.text}</p>}
      <button type="button" className="btn block" onClick={() => void onPublish()} disabled={programme.latestVersion > 0 && unpublished === false}>
        {programme.latestVersion === 0 ? 'Publish programme' : 'Publish changes'}
      </button>
      {programme.latestVersion > 0 && !featured && (
        <button type="button" className="btn secondary" onClick={() => void featureProgramme(profile.id, initial.id)}>Show first on my page</button>
      )}
      {programme.latestVersion > 0 && <span className="muted small center">{featured ? 'On your page, shown first' : 'On your page'}</span>}
    </main>
  )
}
