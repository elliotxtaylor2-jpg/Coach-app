import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { ShareLink } from '../components/ShareLink'
import { ensureCoachProfile, getCoachProfile, slugify, updateCoachProfile, validateProfile } from '../lib/coach'

export function CoachProfilePage() {
  const profile = useProfile()
  const coach = useLiveQuery(() => getCoachProfile(profile.id), [profile.id])
  const [form, setForm] = useState({ displayName: '', bio: '', specialism: '', price: '', slug: '' })
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [trial, setTrial] = useState(true)

  useEffect(() => {
    void ensureCoachProfile(profile)
  }, [profile])

  useEffect(() => {
    if (coach && !loaded) {
      setForm({ displayName: coach.displayName, bio: coach.bio, specialism: coach.specialism, price: coach.priceGbp.toFixed(2), slug: coach.slug })
      setTrial((coach.trialDays ?? 7) > 0)
      setLoaded(true)
    }
  }, [coach, loaded])

  const set = (k: keyof typeof form) => (v: string) => {
    setSaved(false)
    setForm((f) => ({ ...f, [k]: v }))
  }

  const patch = {
    displayName: form.displayName,
    bio: form.bio,
    specialism: form.specialism,
    priceGbp: Number(form.price.replace('£', '')),
    slug: form.slug.trim().toLowerCase(),
  }
  const errors = loaded ? validateProfile(patch) : {}

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateCoachProfile(profile.id, { ...patch, trialDays: trial ? 7 : 0 })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    }
  }

  if (!coach) return <p className="center muted">Loading…</p>

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/coach" className="small">← Dashboard</Link>
        <Link to={`/c/${coach.slug}`} className="small">Preview as a member</Link>
      </div>
      <h1>Your page</h1>

      <ShareLink slug={coach.slug} />

      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field id="displayName" label="Name members see" value={form.displayName} onChange={set('displayName')} error={errors.displayName} />
        <Field id="specialism" label="Specialism" placeholder="e.g. Strength coach · London" value={form.specialism} onChange={set('specialism')} />
        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea id="bio" className="input" style={{ height: 110, paddingTop: 12, resize: 'vertical' }} maxLength={500} value={form.bio} onChange={(e) => set('bio')(e.target.value)} placeholder="Who you coach and how" />
          {errors.bio && <span className="error small">{errors.bio}</span>}
        </div>
        <Field id="price" label="Monthly price (£)" inputMode="decimal" value={form.price} onChange={set('price')} error={errors.priceGbp} />
        <div className="field">
          <label htmlFor="slug">Your link</label>
          <div className="row">
            <span className="muted small">/c/</span>
            <input id="slug" className="input" value={form.slug} onChange={(e) => set('slug')(e.target.value)} autoCapitalize="none" />
            <button type="button" className="btn ghost small" onClick={() => set('slug')(slugify(form.displayName))}>From name</button>
          </div>
          {errors.slug && <span className="error small">{errors.slug}</span>}
        </div>
        <label className="row card" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={trial} onChange={(e) => { setSaved(false); setTrial(e.target.checked) }} style={{ width: 22, height: 22 }} />
          <span className="grow">
            <span className="title">Offer a 7-day free trial</span>
            <span className="muted small">New members aren't charged until the trial ends.</span>
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {saved && <p className="badge good" role="status">Saved</p>}
        <button type="submit" className="btn block" disabled={Object.keys(errors).length > 0}>Save page</button>
      </form>
    </main>
  )
}

function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string; inputMode?: 'decimal' }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} className="input" value={props.value} placeholder={props.placeholder} inputMode={props.inputMode} onChange={(e) => props.onChange(e.target.value)} aria-invalid={!!props.error} />
      {props.error && <span className="error small">{props.error}</span>}
    </div>
  )
}
