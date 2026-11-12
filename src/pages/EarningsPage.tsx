import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import { earningsForMonth, formatGbp, monthKey, MONTHLY_FEE_CAP_PENCE } from '../lib/billing'
import { getCoachProfile, updateCoachProfile } from '../lib/coach'
import { db } from '../lib/db'
import { formatDate } from '../lib/format'

export function EarningsPage() {
  const profile = useProfile()
  const coach = useLiveQuery(() => getCoachProfile(profile.id), [profile.id])
  const ledger = useLiveQuery(() => db.payments.where('coachId').equals(profile.id).toArray(), [profile.id]) ?? []
  const betaMembers = useLiveQuery(
    () => db.enrolments.where('coachId').equals(profile.id).filter((e) => e.status === 'active' && (e.billing ?? 'beta') === 'beta').count(),
    [profile.id],
  )
  const [month] = useState(() => monthKey(new Date().toISOString()))
  const [error, setError] = useState<string | null>(null)
  const e = earningsForMonth(ledger, profile.id, month)
  const recent = [...ledger].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, 8)
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  async function setBetaEnd(daysFromNow: number | null) {
    setError(null)
    try {
      await updateCoachProfile(profile.id, { betaEndsAt: daysFromNow === null ? null : new Date(Date.now() + daysFromNow * 864e5).toISOString() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    }
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link to="/coach" className="small">← Dashboard</Link>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Earnings</h1>
        <span className="muted small">{monthName} · {e.charges} {e.charges === 1 ? 'payment' : 'payments'}</span>
      </div>

      <section className="card stack" aria-label="This month">
        <Row label="Members paid" value={formatGbp(e.grossPence)} />
        {e.refundsPence > 0 && <Row label="Refunds and disputes" value={formatGbp(-e.refundsPence)} muted />}
        <Row label="Platform fee (10%, max £30 a month)" value={formatGbp(-e.platformFeePence)} muted />
        <Row label="Card processing (estimate)" value={formatGbp(-e.processingFeePence)} muted />
        <div className="row" style={{ justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
          <span className="label">To you</span>
          <span className="big-number" style={{ color: 'var(--good)' }}>{formatGbp(e.netPence)}</span>
        </div>
      </section>

      {e.capReached ? (
        <p className="note">You've reached the {formatGbp(MONTHLY_FEE_CAP_PENCE)} fee cap. No more platform fees this month: you keep everything else.</p>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {formatGbp(MONTHLY_FEE_CAP_PENCE - e.platformFeePence)} of platform fees left before this month's cap.
        </p>
      )}
      <p className="muted small" style={{ margin: 0 }}>Stripe pays your earnings into your bank on its payout schedule.</p>

      <h2>Recent payments</h2>
      {recent.length === 0 ? (
        <p className="muted">No payments yet.</p>
      ) : (
        <div className="list">
          {recent.map((p) => (
            <div key={p.id} className="list-item">
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 600 }}>{p.kind === 'charge' ? 'Payment' : p.kind === 'refund' ? 'Refund' : 'Dispute'}</span>
                <span className="muted small">{formatDate(p.occurredAt)}</span>
              </span>
              <span style={{ fontWeight: 600, color: p.kind === 'charge' ? undefined : 'var(--warn)' }}>
                {p.kind === 'charge' ? formatGbp(p.amountPence) : formatGbp(-p.amountPence)}
              </span>
            </div>
          ))}
        </div>
      )}

      {coach && (betaMembers ?? 0) > 0 && (
        <section className="card stack" aria-label="Beta members">
          <span className="label">{betaMembers} {betaMembers === 1 ? 'member joined' : 'members joined'} free during the beta</span>
          {coach.betaEndsAt ? (
            <>
              <span className="muted small">They'll be asked to subscribe from {formatDate(coach.betaEndsAt)}.</span>
              <button type="button" className="btn ghost" onClick={() => void setBetaEnd(null)}>Keep them free instead</button>
            </>
          ) : (
            <>
              <span className="muted small">They stay free until you decide. When you're ready, give them a week's notice to subscribe.</span>
              <button type="button" className="btn secondary" onClick={() => void setBetaEnd(7)} disabled={!coach.takesPayments}>
                Ask them to subscribe in 7 days
              </button>
              {!coach.takesPayments && <span className="muted small">Set up payouts first.</span>}
            </>
          )}
          {error && <p className="error small">{error}</p>}
        </section>
      )}
    </main>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600, color: muted ? 'var(--muted)' : undefined }}>{value}</span>
    </div>
  )
}
