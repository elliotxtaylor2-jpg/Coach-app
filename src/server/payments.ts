/**
 * Payment server logic. Runs in Supabase Edge Functions in production (see supabase/functions),
 * and in the browser against a simulated Stripe in demo mode and tests. It talks to Stripe and to
 * storage only through the small interfaces below, so every path runs the same code.
 *
 * Coaches are the seller (Q6): subscriptions are created on the coach's connected account
 * ("direct charges") with the platform taking an application fee.
 */
import { feesSoFar, planPricePence, platformFeePence, estimatedCardFeePence, refundedFeePence, type Plan } from '../lib/billing.ts'
import type { CoachProfile, Enrolment, Payment, PayoutAccount, Subscription } from '../lib/types.ts'

// ---------- What we need from Stripe ----------

export interface StripeSubscription {
  id: string
  customer: string
  status: Subscription['status']
  current_period_end: number
  trial_end: number | null
  cancel_at_period_end: boolean
  metadata: Record<string, string>
  items: { data: { price: { unit_amount: number | null; recurring: { interval: 'month' | 'year' } | null } }[] }
}

export interface StripeEvent {
  id: string
  type: string
  account?: string
  data: { object: Record<string, unknown> }
}

export interface StripeLike {
  accounts: {
    create(params: { type: 'express'; country: 'GB'; email?: string; capabilities: Record<string, { requested: boolean }>; metadata: Record<string, string> }): Promise<{ id: string }>
  }
  accountLinks: {
    create(params: { account: string; refresh_url: string; return_url: string; type: 'account_onboarding' }): Promise<{ url: string }>
  }
  checkout: {
    sessions: {
      create(params: Record<string, unknown>, opts: { stripeAccount: string }): Promise<{ id: string; url: string | null }>
    }
  }
  billingPortal: {
    sessions: { create(params: { customer: string; return_url: string }, opts: { stripeAccount: string }): Promise<{ url: string }> }
  }
  subscriptions: {
    retrieve(id: string, opts: { stripeAccount: string }): Promise<StripeSubscription>
  }
  applicationFees: {
    createRefund(feeId: string, params: { amount: number }): Promise<{ id: string }>
  }
}

// ---------- What we need from storage ----------

export interface ServerStore {
  getCoach(coachId: string): Promise<CoachProfile | undefined>
  putCoach(row: CoachProfile): Promise<void>
  getPayoutAccount(coachId: string): Promise<PayoutAccount | undefined>
  getPayoutAccountByStripeId(stripeAccountId: string): Promise<PayoutAccount | undefined>
  putPayoutAccount(row: PayoutAccount): Promise<void>
  getEnrolment(id: string): Promise<Enrolment | undefined>
  activeEnrolmentFor(memberId: string, coachId: string): Promise<Enrolment | undefined>
  putEnrolment(row: Enrolment): Promise<void>
  getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined>
  putSubscription(row: Subscription): Promise<void>
  paymentsForCoach(coachId: string): Promise<Payment[]>
  getPaymentByExternalId(externalId: string): Promise<Payment | undefined>
  /** Must ignore a duplicate externalId so webhook retries never double-count (T12-style idempotency). */
  insertPayment(row: Payment): Promise<boolean>
  /** Returns false if this event was already handled. */
  markEventHandled(eventId: string): Promise<boolean>
}

export interface Clock {
  now(): string
  id(): string
}

export const systemClock: Clock = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() }

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString()

export class PaymentError extends Error {}

// ---------- Coach payouts (T15, T16) ----------

export async function startPayoutOnboarding(
  stripe: StripeLike,
  store: ServerStore,
  input: { coachId: string; email?: string; returnUrl: string; refreshUrl: string },
  clock: Clock = systemClock,
): Promise<{ url: string }> {
  let account = await store.getPayoutAccount(input.coachId)
  if (!account) {
    const created = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      email: input.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { coachId: input.coachId },
    })
    account = {
      id: input.coachId,
      userId: input.coachId,
      stripeAccountId: created.id,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      updatedAt: clock.now(),
      deleted: false,
    }
    await store.putPayoutAccount(account)
  }
  const link = await stripe.accountLinks.create({
    account: account.stripeAccountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: 'account_onboarding',
  })
  return { url: link.url }
}

// ---------- Member checkout (T08, T10, T11, T12) ----------

export interface CheckoutInput {
  memberId: string
  memberName: string
  memberEmail?: string
  coachId: string
  programmeId: string
  plan: Plan
  successUrl: string
  cancelUrl: string
}

export async function createCheckout(stripe: StripeLike, store: ServerStore, input: CheckoutInput): Promise<{ url: string; sessionId: string }> {
  const coach = await store.getCoach(input.coachId)
  if (!coach) throw new PaymentError('Coach not found.')
  const offer = (coach.offers ?? []).find((o) => o.programmeId === input.programmeId)
  if (!offer) throw new PaymentError('That programme isn’t available.')
  const account = await store.getPayoutAccount(input.coachId)
  if (!account?.chargesEnabled) throw new PaymentError(`${coach.displayName} can’t take payments yet.`)

  const existing = await store.activeEnrolmentFor(input.memberId, input.coachId)
  if (existing?.billing === 'paid' && existing.programmeId === input.programmeId) throw new PaymentError('You’re already subscribed.')

  const amount = planPricePence(coach.priceGbp, input.plan)
  const metadata = {
    memberId: input.memberId,
    memberName: input.memberName,
    coachId: input.coachId,
    programmeId: input.programmeId,
    plan: input.plan,
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      client_reference_id: input.memberId,
      customer_email: input.memberEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: amount,
            recurring: { interval: input.plan === 'annual' ? 'year' : 'month' },
            product_data: { name: `${coach.displayName} · ${offer.title}` },
          },
        },
      ],
      subscription_data: {
        // 10% up front; invoice.paid hands back anything above the monthly cap.
        application_fee_percent: 10,
        trial_period_days: coach.trialDays > 0 ? coach.trialDays : undefined,
        metadata,
      },
      metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    },
    { stripeAccount: account.stripeAccountId },
  )
  if (!session.url) throw new PaymentError('Stripe did not return a checkout link.')
  return { url: session.url, sessionId: session.id }
}

export async function billingPortal(
  stripe: StripeLike,
  store: ServerStore,
  input: { memberId: string; stripeSubscriptionId: string; returnUrl: string },
): Promise<{ url: string }> {
  const sub = await store.getSubscriptionByStripeId(input.stripeSubscriptionId)
  if (!sub || sub.userId !== input.memberId) throw new PaymentError('Subscription not found.')
  const account = await store.getPayoutAccount(sub.coachId)
  if (!account) throw new PaymentError('Coach account not found.')
  return stripe.billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: input.returnUrl }, { stripeAccount: account.stripeAccountId })
}

// ---------- Webhooks ----------

/** Apply one Stripe event. Safe to receive twice: repeats are ignored. */
export async function handleStripeEvent(stripe: StripeLike, store: ServerStore, event: StripeEvent, clock: Clock = systemClock): Promise<string> {
  if (!(await store.markEventHandled(event.id))) return 'duplicate'
  const obj = event.data.object
  switch (event.type) {
    case 'account.updated':
      return accountUpdated(store, obj, clock)
    case 'checkout.session.completed':
      return checkoutCompleted(stripe, store, event, clock)
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return subscriptionChanged(store, obj as unknown as StripeSubscription, event.type, clock)
    case 'invoice.paid':
      return invoicePaid(stripe, store, event, clock)
    case 'charge.refunded':
      return chargeRefunded(store, event, clock)
    case 'charge.dispute.created':
      return disputeCreated(store, event, clock)
    default:
      return 'ignored'
  }
}

async function accountUpdated(store: ServerStore, obj: Record<string, unknown>, clock: Clock) {
  const account = await store.getPayoutAccountByStripeId(String(obj.id))
  if (!account) return 'unknown account'
  await store.putPayoutAccount({
    ...account,
    detailsSubmitted: !!obj.details_submitted,
    chargesEnabled: !!obj.charges_enabled,
    payoutsEnabled: !!obj.payouts_enabled,
    updatedAt: clock.now(),
  })
  // Public flag so the coach's page knows to show plans instead of free joining.
  const coach = await store.getCoach(account.id)
  if (coach && coach.takesPayments !== !!obj.charges_enabled) await store.putCoach({ ...coach, takesPayments: !!obj.charges_enabled, updatedAt: clock.now() })
  return 'account updated'
}

async function checkoutCompleted(stripe: StripeLike, store: ServerStore, event: StripeEvent, clock: Clock) {
  const session = event.data.object as { subscription?: string; metadata?: Record<string, string> }
  const md = session.metadata ?? {}
  if (!session.subscription || !md.memberId || !md.coachId || !md.programmeId || !event.account) return 'missing data'
  const stripeSub = await stripe.subscriptions.retrieve(session.subscription, { stripeAccount: event.account })
  const t = clock.now()

  // Reuse a beta enrolment for the same programme (Q10), otherwise switch to a new paid one.
  const current = await store.activeEnrolmentFor(md.memberId, md.coachId)
  let enrolment: Enrolment
  if (current && current.programmeId === md.programmeId) {
    enrolment = { ...current, billing: 'paid', updatedAt: t }
  } else {
    if (current) await store.putEnrolment({ ...current, status: 'cancelled', updatedAt: t })
    enrolment = {
      id: clock.id(),
      userId: md.memberId,
      coachId: md.coachId,
      programmeId: md.programmeId,
      memberName: md.memberName ?? 'Member',
      status: 'active',
      startedAt: t,
      billing: 'paid',
      updatedAt: t,
      deleted: false,
    }
  }
  await store.putEnrolment(enrolment)
  await store.putSubscription(toSubscription(stripeSub, { id: clock.id(), memberId: md.memberId, coachId: md.coachId, programmeId: md.programmeId, enrolmentId: enrolment.id }, t))
  return 'subscribed'
}

function toSubscription(
  s: StripeSubscription,
  ids: { id: string; memberId: string; coachId: string; programmeId: string; enrolmentId: string },
  t: string,
): Subscription {
  const price = s.items.data[0]?.price
  return {
    id: ids.id,
    userId: ids.memberId,
    coachId: ids.coachId,
    programmeId: ids.programmeId,
    enrolmentId: ids.enrolmentId,
    plan: price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
    status: s.status,
    amountPence: price?.unit_amount ?? 0,
    currentPeriodEnd: iso(s.current_period_end),
    trialEnd: s.trial_end ? iso(s.trial_end) : null,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    stripeSubscriptionId: s.id,
    stripeCustomerId: s.customer,
    updatedAt: t,
    deleted: false,
  }
}

async function subscriptionChanged(store: ServerStore, s: StripeSubscription, type: string, clock: Clock) {
  const existing = await store.getSubscriptionByStripeId(s.id)
  if (!existing) return 'unknown subscription'
  const t = clock.now()
  const next = { ...toSubscription(s, { id: existing.id, memberId: existing.userId, coachId: existing.coachId, programmeId: existing.programmeId, enrolmentId: existing.enrolmentId }, t) }
  if (type === 'customer.subscription.deleted') next.status = 'canceled'
  await store.putSubscription(next)
  // Access ends when Stripe gives up on payment or the subscription is deleted (T22).
  if (next.status === 'canceled' || next.status === 'unpaid' || next.status === 'incomplete_expired') {
    const e = await store.getEnrolment(existing.enrolmentId)
    if (e && e.status === 'active' && next.currentPeriodEnd <= t) await store.putEnrolment({ ...e, status: 'cancelled', updatedAt: t })
  }
  return `subscription ${next.status}`
}

async function invoicePaid(stripe: StripeLike, store: ServerStore, event: StripeEvent, clock: Clock) {
  const inv = event.data.object as {
    id: string
    subscription?: string
    charge?: string
    amount_paid: number
    application_fee_amount?: number | null
    application_fee?: string | null
    status_transitions?: { paid_at?: number }
  }
  if (!inv.subscription || inv.amount_paid <= 0 || !inv.charge) return 'nothing charged'
  const sub = await store.getSubscriptionByStripeId(inv.subscription)
  if (!sub) return 'unknown subscription'
  if (await store.getPaymentByExternalId(inv.charge)) return 'already recorded'

  const occurredAt = inv.status_transitions?.paid_at ? iso(inv.status_transitions.paid_at) : clock.now()
  const ledger = await store.paymentsForCoach(sub.coachId)
  const allowed = platformFeePence(inv.amount_paid, feesSoFar(ledger, sub.coachId, occurredAt))
  const charged = inv.application_fee_amount ?? 0
  // Stripe took 10%; hand back whatever is above the £30 monthly cap.
  if (charged > allowed && inv.application_fee) await stripe.applicationFees.createRefund(inv.application_fee, { amount: charged - allowed })

  await store.insertPayment({
    id: clock.id(),
    userId: sub.userId,
    coachId: sub.coachId,
    memberId: sub.userId,
    kind: 'charge',
    amountPence: inv.amount_paid,
    platformFeePence: Math.min(charged, allowed),
    processingFeePence: estimatedCardFeePence(inv.amount_paid),
    occurredAt,
    externalId: inv.charge,
    updatedAt: clock.now(),
    deleted: false,
  })
  return charged > allowed ? 'charged, fee capped' : 'charged'
}

async function chargeRefunded(store: ServerStore, event: StripeEvent, clock: Clock) {
  const charge = event.data.object as { id: string; amount: number; refunds?: { data: { id: string; amount: number }[] } }
  const original = await store.getPaymentByExternalId(charge.id)
  if (!original) return 'unknown charge'
  let recorded = 0
  for (const r of charge.refunds?.data ?? []) {
    const inserted = await store.insertPayment({
      id: clock.id(),
      userId: original.userId,
      coachId: original.coachId,
      memberId: original.memberId,
      kind: 'refund',
      amountPence: r.amount,
      platformFeePence: refundedFeePence(original.amountPence, original.platformFeePence, r.amount),
      processingFeePence: 0,
      occurredAt: clock.now(),
      externalId: r.id,
      updatedAt: clock.now(),
      deleted: false,
    })
    if (inserted) recorded++
  }
  return `refunds recorded: ${recorded}`
}

async function disputeCreated(store: ServerStore, event: StripeEvent, clock: Clock) {
  const d = event.data.object as { id: string; charge: string; amount: number }
  const original = await store.getPaymentByExternalId(d.charge)
  if (!original) return 'unknown charge'
  await store.insertPayment({
    id: clock.id(),
    userId: original.userId,
    coachId: original.coachId,
    memberId: original.memberId,
    kind: 'dispute',
    amountPence: d.amount,
    platformFeePence: 0,
    processingFeePence: 0,
    occurredAt: clock.now(),
    externalId: d.id,
    updatedAt: clock.now(),
    deleted: false,
  })
  return 'dispute recorded'
}
