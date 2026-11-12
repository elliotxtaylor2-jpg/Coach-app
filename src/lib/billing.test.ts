import { describe, expect, it } from 'vitest'
import {
  annualSavingPence,
  earningsForMonth,
  feesSoFar,
  formatGbp,
  planPricePence,
  platformFeePence,
  programmeAccess,
  reconcile,
  refundedFeePence,
  type LedgerEntry,
  type SubscriptionStatus,
} from './billing'

const charge = (id: string, amountPence: number, platformFeePence: number, occurredAt = '2026-11-05T10:00:00Z', coachId = 'c1'): LedgerEntry => ({
  id,
  coachId,
  memberId: 'm1',
  kind: 'charge',
  amountPence,
  platformFeePence,
  processingFeePence: Math.round(amountPence * 0.015) + 20,
  occurredAt,
  externalId: `ch_${id}`,
})

// T17: £29.99 → platform fee £3.00 (10% of gross, rounded half up).
describe('T17/T18: platform fee', () => {
  it('takes 10% of gross, rounded half up to the penny', () => {
    expect(platformFeePence(2999, 0)).toBe(300)
    expect(platformFeePence(3499, 0)).toBe(350)
    expect(platformFeePence(1995, 0)).toBe(200) // 199.5 rounds up
  })

  it('stops at the £30 monthly cap per coach (Q5)', () => {
    expect(platformFeePence(2999, 2800)).toBe(200) // only £2 of headroom left
    expect(platformFeePence(2999, 3000)).toBe(0)
    expect(platformFeePence(29990, 0)).toBe(2999) // an annual plan alone stays under the cap
  })

  it('resets the cap each calendar month', () => {
    const ledger = [charge('a', 29990, 2999, '2026-11-01T09:00:00Z')]
    expect(feesSoFar(ledger, 'c1', '2026-11-20T09:00:00Z')).toBe(2999)
    expect(feesSoFar(ledger, 'c1', '2026-12-01T00:00:00Z')).toBe(0)
    expect(feesSoFar(ledger, 'other-coach', '2026-11-20T09:00:00Z')).toBe(0)
  })
})

describe('plans (Q7, two months free)', () => {
  it('prices annual at ten months', () => {
    expect(planPricePence(29.99, 'monthly')).toBe(2999)
    expect(planPricePence(29.99, 'annual')).toBe(29990)
    expect(annualSavingPence(29.99)).toBe(5998)
  })

  it('formats money for people', () => {
    expect(formatGbp(29990)).toBe('£299.90')
    expect(formatGbp(-300)).toBe('−£3.00')
  })
})

// T21: refund reverses the platform fee in proportion.
describe('T21: refunds', () => {
  it('returns the whole fee on a full refund and a share on a partial one', () => {
    expect(refundedFeePence(2999, 300, 2999)).toBe(300)
    expect(refundedFeePence(2999, 300, 1500)).toBe(150)
    expect(refundedFeePence(2999, 300, 99999)).toBe(300)
  })
})

describe('coach earnings', () => {
  it('sums a month: gross, refunds, fees, card costs and net', () => {
    const ledger: LedgerEntry[] = [
      charge('a', 2999, 300),
      charge('b', 2999, 300),
      { ...charge('r', 2999, 300), kind: 'refund', processingFeePence: 0, externalId: 're_r' },
      charge('old', 2999, 300, '2026-10-30T10:00:00Z'),
    ]
    const e = earningsForMonth(ledger, 'c1', '2026-11')
    expect(e).toMatchObject({ grossPence: 5998, refundsPence: 2999, platformFeePence: 300, processingFeePence: 130, charges: 2, capReached: false })
    expect(e.netPence).toBe(5998 - 2999 - 300 - 130)
  })

  it('flags when the cap is reached', () => {
    const ledger = Array.from({ length: 11 }, (_, i) => charge(String(i), 2999, platformFeePence(2999, i * 300)))
    expect(earningsForMonth(ledger, 'c1', '2026-11')).toMatchObject({ platformFeePence: 3000, capReached: true })
  })
})

// T19: month-end reconciliation matches the provider to the penny.
describe('T19: reconciliation', () => {
  it('passes when every record matches', () => {
    const ledger = Array.from({ length: 50 }, (_, i) => charge(String(i), 2999, 300))
    const provider = ledger.map((e) => ({ externalId: e.externalId, amountPence: e.amountPence, platformFeePence: e.platformFeePence }))
    expect(reconcile(ledger, provider)).toEqual([])
  })

  it('names every mismatch', () => {
    const ledger = [charge('a', 2999, 300), charge('b', 2999, 300), charge('c', 2999, 300)]
    const provider = [
      { externalId: 'ch_a', amountPence: 2999, platformFeePence: 299 },
      { externalId: 'ch_b', amountPence: 3000, platformFeePence: 300 },
      { externalId: 'ch_z', amountPence: 2999, platformFeePence: 300 },
    ]
    expect(reconcile(ledger, provider)).toEqual([
      { externalId: 'ch_a', problem: 'fee differs' },
      { externalId: 'ch_b', problem: 'amount differs' },
      { externalId: 'ch_z', problem: 'missing in ledger' },
      { externalId: 'ch_c', problem: 'missing at provider' },
    ])
  })
})

// T20, T22 and Q10: who can follow their programme.
describe('programme access', () => {
  const now = '2026-11-15T12:00:00Z'
  it('keeps beta members free until the coach asks them to pay (Q10)', () => {
    expect(programmeAccess({ billing: 'beta', betaEndsAt: null, now })).toEqual({ ok: true, reason: 'beta' })
    expect(programmeAccess({ billing: 'beta', betaEndsAt: '2026-12-01T00:00:00Z', now }).ok).toBe(true)
    expect(programmeAccess({ billing: 'beta', betaEndsAt: '2026-11-01T00:00:00Z', now })).toEqual({ ok: false, reason: 'beta-ended' })
  })

  it('lets a beta member who subscribes carry on', () => {
    const sub = { status: 'active' as const, currentPeriodEnd: '2026-12-15T12:00:00Z' }
    expect(programmeAccess({ billing: 'beta', betaEndsAt: '2026-11-01T00:00:00Z', subscription: sub, now }).ok).toBe(true)
  })

  it('handles trial, active, retrying, cancelled and failed subscriptions', () => {
    const at = (status: SubscriptionStatus, end = '2026-12-01T00:00:00Z') =>
      programmeAccess({ billing: 'paid', betaEndsAt: null, subscription: { status, currentPeriodEnd: end }, now })
    expect(at('trialing')).toEqual({ ok: true, reason: 'trial' })
    expect(at('active')).toEqual({ ok: true, reason: 'active' })
    expect(at('past_due')).toEqual({ ok: true, reason: 'retrying' })
    expect(at('canceled')).toEqual({ ok: true, reason: 'cancelled-until-period-end' })
    expect(at('canceled', '2026-11-10T00:00:00Z')).toEqual({ ok: false, reason: 'ended' })
    expect(at('unpaid')).toEqual({ ok: false, reason: 'payment-failed' })
    expect(programmeAccess({ billing: 'paid', betaEndsAt: null, subscription: null, now })).toEqual({ ok: false, reason: 'no-subscription' })
  })
})
