/**
 * Money rules for the platform. Pure functions, shared by the app, the demo gateway and the
 * Stripe webhook, so every place computes fees the same way. All amounts are in pence.
 */

export const PLATFORM_FEE_RATE = 0.1
/** Most the platform takes from one coach in a calendar month (Q5): £30. */
export const MONTHLY_FEE_CAP_PENCE = 3000
/** Annual plan = 10 × monthly, i.e. two months free (Q7). */
export const ANNUAL_MONTHS_CHARGED = 10
export const TRIAL_DAYS = 7
/** Estimate of Stripe's UK card fee, for showing coaches what they'll receive: 1.5% + 20p. */
export const CARD_FEE_RATE = 0.015
export const CARD_FEE_FIXED_PENCE = 20

export type Plan = 'monthly' | 'annual'

export const toPence = (gbp: number) => Math.round(gbp * 100)
export const toGbp = (pence: number) => pence / 100
export const formatGbp = (pence: number) =>
  `${pence < 0 ? '−' : ''}£${(Math.abs(pence) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function planPricePence(monthlyGbp: number, plan: Plan): number {
  const monthly = toPence(monthlyGbp)
  return plan === 'annual' ? monthly * ANNUAL_MONTHS_CHARGED : monthly
}

/** What the coach saves per year on the annual plan. */
export const annualSavingPence = (monthlyGbp: number) => toPence(monthlyGbp) * (12 - ANNUAL_MONTHS_CHARGED)

/** Calendar month a charge falls in (UTC), e.g. "2026-11". The fee cap resets each month. */
export const monthKey = (iso: string) => iso.slice(0, 7)

/** 10% of the charge, rounded half up to the penny. */
export const uncappedFeePence = (amountPence: number) => Math.round(amountPence * PLATFORM_FEE_RATE)

/**
 * The platform fee for one charge, given the fees already taken from this coach this month.
 * Never more than 10%, and never pushes the month's total past the cap.
 */
export function platformFeePence(amountPence: number, feesSoFarThisMonthPence: number): number {
  const remaining = Math.max(0, MONTHLY_FEE_CAP_PENCE - feesSoFarThisMonthPence)
  return Math.min(uncappedFeePence(amountPence), remaining)
}

/** Share of the original fee to hand back when part or all of a charge is refunded. */
export function refundedFeePence(chargeAmountPence: number, chargeFeePence: number, refundAmountPence: number): number {
  if (chargeAmountPence <= 0) return 0
  return Math.round(chargeFeePence * Math.min(1, refundAmountPence / chargeAmountPence))
}

export const estimatedCardFeePence = (amountPence: number) => Math.round(amountPence * CARD_FEE_RATE) + CARD_FEE_FIXED_PENCE

// ---------- Ledger ----------

export interface LedgerEntry {
  id: string
  coachId: string
  memberId: string
  kind: 'charge' | 'refund' | 'dispute'
  /** Positive for charges; refunds and disputes are recorded as positive amounts of their own kind. */
  amountPence: number
  platformFeePence: number
  processingFeePence: number
  occurredAt: string
  /** Stripe object id (charge, refund or dispute) for reconciliation. */
  externalId: string
}

export interface MonthEarnings {
  month: string
  grossPence: number
  refundsPence: number
  platformFeePence: number
  processingFeePence: number
  netPence: number
  charges: number
  capReached: boolean
}

/** Coach earnings for one month, as the earnings screen shows them. */
export function earningsForMonth(entries: LedgerEntry[], coachId: string, month: string): MonthEarnings {
  const mine = entries.filter((e) => e.coachId === coachId && monthKey(e.occurredAt) === month)
  const charges = mine.filter((e) => e.kind === 'charge')
  const reversals = mine.filter((e) => e.kind !== 'charge')
  const grossPence = sum(charges, 'amountPence')
  const refundsPence = sum(reversals, 'amountPence')
  const platformFeePence = sum(charges, 'platformFeePence') - sum(reversals, 'platformFeePence')
  const processingFeePence = sum(charges, 'processingFeePence')
  return {
    month,
    grossPence,
    refundsPence,
    platformFeePence,
    processingFeePence,
    netPence: grossPence - refundsPence - platformFeePence - processingFeePence,
    charges: charges.length,
    capReached: sum(charges, 'platformFeePence') >= MONTHLY_FEE_CAP_PENCE,
  }
}

/** Platform fees already taken from a coach in the month of `iso`. */
export function feesSoFar(entries: LedgerEntry[], coachId: string, iso: string): number {
  const month = monthKey(iso)
  return entries
    .filter((e) => e.coachId === coachId && monthKey(e.occurredAt) === month)
    .reduce((t, e) => t + (e.kind === 'charge' ? e.platformFeePence : -e.platformFeePence), 0)
}

export interface ProviderRecord {
  externalId: string
  amountPence: number
  platformFeePence: number
}

export interface Mismatch {
  externalId: string
  problem: 'missing in ledger' | 'missing at provider' | 'amount differs' | 'fee differs'
}

/** T19: every payment, refund and fee must match the provider's records to the penny. */
export function reconcile(ledger: LedgerEntry[], provider: ProviderRecord[]): Mismatch[] {
  const out: Mismatch[] = []
  const byId = new Map(ledger.map((e) => [e.externalId, e]))
  const seen = new Set<string>()
  for (const p of provider) {
    const e = byId.get(p.externalId)
    seen.add(p.externalId)
    if (!e) out.push({ externalId: p.externalId, problem: 'missing in ledger' })
    else if (e.amountPence !== p.amountPence) out.push({ externalId: p.externalId, problem: 'amount differs' })
    else if (e.platformFeePence !== p.platformFeePence) out.push({ externalId: p.externalId, problem: 'fee differs' })
  }
  for (const e of ledger) if (!seen.has(e.externalId)) out.push({ externalId: e.externalId, problem: 'missing at provider' })
  return out
}

// ---------- Subscription access ----------

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired'

export interface AccessInput {
  billing: 'beta' | 'paid'
  /** Set when the coach asks beta members to start paying (Q10). */
  betaEndsAt: string | null
  subscription?: { status: SubscriptionStatus; currentPeriodEnd: string } | null
  now: string
}

export type Access =
  | { ok: true; reason: 'beta' | 'trial' | 'active' | 'retrying' | 'cancelled-until-period-end' }
  | { ok: false; reason: 'beta-ended' | 'no-subscription' | 'payment-failed' | 'ended' }

/**
 * Whether a member can follow their programme. Past-due members keep access while Stripe retries
 * the card; cancelled members keep it to the end of the period they paid for (T20, T22).
 */
export function programmeAccess(input: AccessInput): Access {
  const { billing, betaEndsAt, subscription, now } = input
  if (billing === 'beta' && !subscription) {
    return !betaEndsAt || now < betaEndsAt ? { ok: true, reason: 'beta' } : { ok: false, reason: 'beta-ended' }
  }
  if (!subscription) return { ok: false, reason: 'no-subscription' }
  switch (subscription.status) {
    case 'trialing':
      return { ok: true, reason: 'trial' }
    case 'active':
      return { ok: true, reason: 'active' }
    case 'past_due':
      return { ok: true, reason: 'retrying' }
    case 'canceled':
      return now < subscription.currentPeriodEnd ? { ok: true, reason: 'cancelled-until-period-end' } : { ok: false, reason: 'ended' }
    case 'unpaid':
    case 'incomplete_expired':
      return { ok: false, reason: 'payment-failed' }
    case 'incomplete':
      return { ok: false, reason: 'no-subscription' }
  }
}

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((t, r) => t + (r[key] as unknown as number), 0)
}
