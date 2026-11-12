import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { formatGbp } from '../lib/billing'
import { memberStatus } from '../lib/enrolment'
import { formatDate } from '../lib/format'
import { payments } from '../lib/payments'

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment failed, retrying',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
}

export function AccountPage() {
  const profile = useProfile()
  const status = useLiveQuery(() => memberStatus(profile.id), [profile.id])
  const [message, setMessage] = useState<string | null>(null)
  const sub = status?.subscription

  async function manage() {
    if (!sub) return
    setMessage(null)
    try {
      const result = await payments.manageBilling(profile, sub)
      if (result === 'cancelled') setMessage(`Cancelled. You can keep training until ${formatDate(sub.currentPeriodEnd)}.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not open billing.')
    }
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/" className="small">← Home</Link>
      </div>
      <h1>Account</h1>
      <div className="card stack">
        <span className="label">{profile.displayName}</span>
        <span className="muted small">{profile.email}</span>
      </div>

      {status === undefined ? (
        <p className="muted">Loading…</p>
      ) : !sub ? (
        <p className="muted">{status ? `You joined ${status.coach?.displayName ?? 'your coach'} free during the beta.` : 'You’re not subscribed to a coach.'}</p>
      ) : (
        <section className="card stack" aria-label="Subscription">
          <span className="eyebrow">Subscription</span>
          <h2>{status?.coach?.displayName}</h2>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{sub.plan === 'annual' ? 'Annual' : 'Monthly'}</span>
            <span style={{ fontWeight: 600 }}>{formatGbp(sub.amountPence)} / {sub.plan === 'annual' ? 'year' : 'month'}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Status</span>
            <span className={`badge ${sub.status === 'active' || sub.status === 'trialing' ? 'good' : 'warn'}`}>{STATUS_LABEL[sub.status] ?? sub.status}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{sub.cancelAtPeriodEnd || sub.status === 'canceled' ? 'Access until' : sub.status === 'trialing' ? 'First payment' : 'Renews'}</span>
            <span>{formatDate(sub.trialEnd && sub.status === 'trialing' ? sub.trialEnd : sub.currentPeriodEnd)}</span>
          </div>
          {!sub.cancelAtPeriodEnd && sub.status !== 'canceled' && (
            <button type="button" className="btn secondary" onClick={() => void manage()}>
              {payments.mode === 'demo' ? 'Cancel subscription' : 'Update card or cancel'}
            </button>
          )}
          {message && <p className="note" role="status">{message}</p>}
        </section>
      )}
    </main>
  )
}
