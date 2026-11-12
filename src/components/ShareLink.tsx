import { useState } from 'react'

export const shareUrl = (slug: string) => `${window.location.origin}/c/${slug}`

/** The coach's link with copy and native share. */
export function ShareLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const url = shareUrl(slug)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      window.prompt('Copy your link', url)
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Train with me', url })
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="card stack">
      <span className="label">Share link</span>
      <div className="row">
        <input className="input" readOnly value={url} aria-label="Your share link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {typeof navigator !== 'undefined' && 'share' in navigator && (
        <button type="button" className="btn ghost" onClick={() => void share()}>Share…</button>
      )}
      <span className="muted small">Put it in your Instagram bio or send it to clients.</span>
    </div>
  )
}
