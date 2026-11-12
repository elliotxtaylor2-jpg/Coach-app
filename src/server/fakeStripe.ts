/**
 * A small in-memory Stripe for tests and demo mode. It implements the calls the payment server makes,
 * and has helpers that play out what a real customer or Stripe would do (finish onboarding, pay,
 * fail a renewal, cancel, refund, dispute), returning the webhook events Stripe would send.
 */
import { uncappedFeePence } from '../lib/billing.ts'
import type { StripeEvent, StripeLike, StripeSubscription } from './payments.ts'

interface FakeSession {
  id: string
  account: string
  params: Record<string, unknown>
  completed: boolean
}

export type CardOutcome = 'ok' | 'declined' | 'needs-3ds-pass' | 'needs-3ds-fail'

export class FakeStripe implements StripeLike {
  private n = 0
  private clockSeconds: number
  accountsById = new Map<string, { id: string; detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean }>()
  sessions = new Map<string, FakeSession>()
  subs = new Map<string, StripeSubscription & { account: string; amount: number }>()
  charges = new Map<string, { id: string; amount: number; account: string; fee: number; feeId: string; refunded: number }>()
  feeRefunds: { feeId: string; amount: number }[] = []

  constructor(startIso = new Date().toISOString()) {
    this.clockSeconds = Math.floor(Date.parse(startIso) / 1000)
  }

  private id(prefix: string) {
    return `${prefix}_${(++this.n).toString().padStart(6, '0')}`
  }
  private event(type: string, object: Record<string, unknown>, account?: string): StripeEvent {
    return { id: this.id('evt'), type, account, data: { object } }
  }
  /** Move simulated time forward (for renewals). */
  advanceDays(days: number) {
    this.clockSeconds += Math.round(days * 86400)
  }
  nowIso() {
    return new Date(this.clockSeconds * 1000).toISOString()
  }

  // ----- StripeLike -----

  accounts = {
    create: async () => {
      const id = this.id('acct')
      this.accountsById.set(id, { id, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false })
      return { id }
    },
  }

  accountLinks = {
    create: async (p: { account: string; return_url: string }) => ({ url: `https://connect.stripe.test/setup/${p.account}?return=${encodeURIComponent(p.return_url)}` }),
  }

  checkout = {
    sessions: {
      create: async (params: Record<string, unknown>, opts: { stripeAccount: string }) => {
        const acct = this.accountsById.get(opts.stripeAccount)
        if (!acct?.chargesEnabled) throw new Error('Connected account cannot accept charges')
        const id = this.id('cs')
        this.sessions.set(id, { id, account: opts.stripeAccount, params, completed: false })
        return { id, url: `https://checkout.stripe.test/${id}` }
      },
    },
  }

  billingPortal = {
    sessions: { create: async (p: { customer: string }) => ({ url: `https://billing.stripe.test/${p.customer}` }) },
  }

  subscriptions = {
    retrieve: async (id: string) => {
      const s = this.subs.get(id)
      if (!s) throw new Error(`No such subscription ${id}`)
      const { account: _a, amount: _m, ...rest } = s
      return structuredClone(rest)
    },
  }

  applicationFees = {
    createRefund: async (feeId: string, p: { amount: number }) => {
      this.feeRefunds.push({ feeId, amount: p.amount })
      return { id: this.id('fr') }
    },
  }

  // ----- What people and Stripe do -----

  /** Coach completes (or abandons) Stripe's hosted onboarding. */
  finishOnboarding(accountId: string, complete = true): StripeEvent[] {
    const a = this.accountsById.get(accountId)
    if (!a) throw new Error('No such account')
    Object.assign(a, { detailsSubmitted: complete, chargesEnabled: complete, payoutsEnabled: complete })
    return [this.event('account.updated', { id: a.id, details_submitted: a.detailsSubmitted, charges_enabled: a.chargesEnabled, payouts_enabled: a.payoutsEnabled }, a.id)]
  }

  /**
   * Member pays on the checkout page. Declined cards and failed 3-D Secure create nothing (T10, T11).
   * A session can only complete once (T12).
   */
  completeCheckout(sessionId: string, card: CardOutcome = 'ok'): StripeEvent[] {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('No such session')
    if (s.completed) return []
    if (card === 'declined' || card === 'needs-3ds-fail') return []
    s.completed = true
    const line = (s.params.line_items as { price_data: { unit_amount: number; recurring: { interval: 'month' | 'year' } } }[])[0]
    const subData = s.params.subscription_data as { trial_period_days?: number; metadata: Record<string, string> }
    const amount = line.price_data.unit_amount
    const interval = line.price_data.recurring.interval
    const trialDays = subData.trial_period_days ?? 0
    const subId = this.id('sub')
    const start = this.clockSeconds
    const trialEnd = trialDays ? start + trialDays * 86400 : null
    const periodEnd = trialEnd ?? start + (interval === 'year' ? 365 : 30) * 86400
    const sub = {
      id: subId,
      customer: this.id('cus'),
      status: (trialEnd ? 'trialing' : 'active') as StripeSubscription['status'],
      current_period_end: periodEnd,
      trial_end: trialEnd,
      cancel_at_period_end: false,
      metadata: subData.metadata,
      items: { data: [{ price: { unit_amount: amount, recurring: { interval } } }] },
      account: s.account,
      amount,
    }
    this.subs.set(subId, sub)
    const events = [this.event('checkout.session.completed', { id: s.id, subscription: subId, metadata: s.params.metadata }, s.account)]
    if (!trialEnd) events.push(this.invoicePaid(sub))
    return events
  }

  private invoicePaid(sub: StripeSubscription & { account: string; amount: number }): StripeEvent {
    const chargeId = this.id('ch')
    const feeId = this.id('fee')
    const fee = uncappedFeePence(sub.amount)
    this.charges.set(chargeId, { id: chargeId, amount: sub.amount, account: sub.account, fee, feeId, refunded: 0 })
    return this.event(
      'invoice.paid',
      {
        id: this.id('in'),
        subscription: sub.id,
        charge: chargeId,
        amount_paid: sub.amount,
        application_fee_amount: fee,
        application_fee: feeId,
        status_transitions: { paid_at: this.clockSeconds },
      },
      sub.account,
    )
  }

  private subEvent(type: string, sub: StripeSubscription & { account: string }) {
    const { account, ...rest } = sub as StripeSubscription & { account: string; amount: number }
    const { amount: _amount, ...obj } = rest as typeof rest & { amount: number }
    return this.event(type, structuredClone(obj) as unknown as Record<string, unknown>, account)
  }

  /** The period ends: trial converts or the subscription renews, charging the card. */
  renew(subId: string, card: 'ok' | 'declined' = 'ok'): StripeEvent[] {
    const s = this.subs.get(subId)
    if (!s) throw new Error('No such subscription')
    if (s.cancel_at_period_end) {
      s.status = 'canceled'
      return [this.subEvent('customer.subscription.deleted', s)]
    }
    if (card === 'declined') {
      s.status = 'past_due'
      return [this.subEvent('customer.subscription.updated', s)]
    }
    const interval = s.items.data[0].price.recurring?.interval
    s.status = 'active'
    s.trial_end = null
    s.current_period_end = this.clockSeconds + (interval === 'year' ? 365 : 30) * 86400
    return [this.subEvent('customer.subscription.updated', s), this.invoicePaid(s)]
  }

  /** Stripe's retries run out (T22). */
  exhaustRetries(subId: string): StripeEvent[] {
    const s = this.subs.get(subId)!
    s.status = 'canceled'
    s.current_period_end = this.clockSeconds
    return [this.subEvent('customer.subscription.deleted', s)]
  }

  /** Member cancels in the billing portal: no further charges, access to period end (T20). */
  cancelAtPeriodEnd(subId: string): StripeEvent[] {
    const s = this.subs.get(subId)!
    s.cancel_at_period_end = true
    return [this.subEvent('customer.subscription.updated', s)]
  }

  /** Admin refunds a charge in full or part (T21). */
  refund(chargeId: string, amount?: number): StripeEvent[] {
    const c = this.charges.get(chargeId)
    if (!c) throw new Error('No such charge')
    const refundAmount = Math.min(amount ?? c.amount, c.amount - c.refunded)
    c.refunded += refundAmount
    return [this.event('charge.refunded', { id: c.id, amount: c.amount, refunds: { data: [{ id: this.id('re'), amount: refundAmount }] } }, c.account)]
  }

  /** A member disputes a charge with their bank (T23). */
  dispute(chargeId: string): StripeEvent[] {
    const c = this.charges.get(chargeId)!
    return [this.event('charge.dispute.created', { id: this.id('dp'), charge: c.id, amount: c.amount }, c.account)]
  }

  /** Provider-side records for reconciliation (T19). */
  providerRecords() {
    const out: { externalId: string; amountPence: number; platformFeePence: number }[] = []
    for (const c of this.charges.values()) {
      const refunded = this.feeRefunds.filter((r) => r.feeId === c.feeId).reduce((t, r) => t + r.amount, 0)
      out.push({ externalId: c.id, amountPence: c.amount, platformFeePence: c.fee - refunded })
    }
    return out
  }
}
