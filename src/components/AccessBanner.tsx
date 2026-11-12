import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../app/AuthContext'
import type { MemberStatus } from '../lib/enrolment'
import { formatDate } from '../lib/format'
import { payments } from '../lib/payments'

/** Tells the member where they stand with payment, and what to do if anything. */
export function AccessBanner({ status }: { status: MemberStatus }) {
  const profile = useProfile()
  const [error, setError] = useState<string | null>(null)
  const { access, coach, subscription } = status
  const first = coach?.displayName.split(' ')[0] ?? 'Your coach'
  const pageLink = coach ? `/c/${coach.slug}` : '/'

  async function fixCard() {
    if (!subscription) return
    try {
      await payments.manageBilling(profile, subscription)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing.')
    }
  }

  if (access.ok) {
    if (access.reason === 'trial' && subscription?.trialEnd)
      return <p className="note">Free trial until {formatDate(subscription.trialEnd)}. You won't be charged before then.</p>
    if (access.reason === 'retrying')
      return (
        <div className="card stack" role="alert" style={{ borderColor: 'var(--warn)' }}>
          <span className="label">Your last payment didn't go through</span>
          <span className="muted small">You can keep training while we retry. Update your card to avoid losing access.</span>
          {error && <p className="error small">{error}</p>}
          <button type="button" className="btn secondary" onClick={() => void fixCard()}>Update card</button>
        </div>
      )
    if (access.reason === 'cancelled-until-period-end' && subscription)
      return <p className="note">Subscription cancelled. You can train until {formatDate(subscription.currentPeriodEnd)}.</p>
    if (access.reason === 'active' && subscription?.cancelAtPeriodEnd)
      return <p className="note">Cancelled: your access ends on {formatDate(subscription.currentPeriodEnd)}.</p>
    if (access.reason === 'beta' && coach?.betaEndsAt)
      return (
        <div className="card stack">
          <span className="label">{first} starts charging on {formatDate(coach.betaEndsAt)}</span>
          <span className="muted small">Subscribe before then to keep your programme and your place.</span>
          <Link to={pageLink} className="btn secondary">See plans</Link>
        </div>
      )
    return null
  }

  const message =
    access.reason === 'beta-ended'
      ? `${first}'s free beta has ended. Subscribe to keep training with ${first}.`
      : access.reason === 'payment-failed'
        ? 'Your payments failed, so your programme is paused. Subscribe again to continue.'
        : access.reason === 'ended'
          ? 'Your subscription has ended. Your history is still here.'
          : `Subscribe to start ${first}'s programme.`
  return (
    <div className="card stack" role="alert">
      <span className="label">Programme paused</span>
      <span className="muted small">{message}</span>
      <Link to={pageLink} className="btn">See plans</Link>
    </div>
  )
}
