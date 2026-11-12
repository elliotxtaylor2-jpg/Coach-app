import { useEffect, useRef, useState } from 'react'
import { searchExercises } from '../lib/exercises'

/** Bottom sheet to search the library or add a custom exercise. */
export function ExercisePicker({ open, onPick, onClose }: { open: boolean; onPick: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    // Fall back to the open attribute where showModal isn't supported (older browsers, test DOMs).
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [open])

  const close = () => {
    setQuery('')
    onClose()
  }
  const pick = (name: string) => {
    setQuery('')
    onPick(name)
  }

  const results = searchExercises(query)
  const custom = query.trim()
  const showCustom = custom.length > 1 && !results.some((r) => r.toLowerCase() === custom.toLowerCase())

  return (
    <dialog ref={ref} className="sheet" onClose={close} aria-label="Add exercise">
      {open && (
        <div className="sheet-body">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Add exercise</h2>
            <button type="button" className="btn ghost" onClick={close}>Close</button>
          </div>
          <div className="field">
            <label htmlFor="exercise-search">Search</label>
            <input id="exercise-search" className="input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. squat" />
          </div>
          <div className="list sheet-list">
            {showCustom && (
              <button type="button" className="list-item" style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }} onClick={() => pick(custom)}>
                Add “{custom}”
              </button>
            )}
            {results.map((name) => (
              <button key={name} type="button" className="list-item" style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }} onClick={() => pick(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </dialog>
  )
}
