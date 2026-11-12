import { describe, expect, it } from 'vitest'
import { earningsForMonth, programmeAccess, reconcile } from '../lib/billing'
import { createProgramme, emptyExercise, ensureCoachProfile, publishProgramme, saveDraft, updateCoachProfile } from '../lib/coach'
import { db } from '../lib/db'
import { joinCoach } from '../lib/enrolment'
import type { Profile } from '../lib/types'
import { dexieServerStore } from './dexieStore'
import { FakeStripe } from './fakeStripe'
import { billingPortal, createCheckout, handleStripeEvent, startPayoutOnboarding, type Clock, type StripeEvent } from './payments'

const coach: Profile = { id: 'coach-1', email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach' }
const member: Profile = { id: 'member-1', email: 'aisha@example.com', displayName: 'Aisha Khan', role: 'member' }

async function setup(opts: { trialDays?: number; onboard?: boolean } = {}) {
  const stripe = new FakeStripe('2026-11-05T10:00:00Z')
  const store = dexieServerStore()
  const clock: Clock = { now: () => stripe.nowIso(), id: () => crypto.randomUUID() }
  const apply = async (events: StripeEvent[]) => {
    const out: string[] = []
    for (const e of events) out.push(await handleStripeEvent(stripe, store, e, clock))
    return out
  }
  await ensureCoachProfile(coach)
  await updateCoachProfile(coach.id, { priceGbp: 29.99, trialDays: opts.trialDays ?? 0 })
  const p = await createProgramme(coach.id, 'Strength Block', 1, 1)
  const draft = structuredClone(p.draft)
  draft.weeks[0].days[0].exercises = [emptyExercise('Back squat')]
  await saveDraft(p.id, { draft })
  await publishProgramme(p.id)
  const urls = { returnUrl: 'https://app.test/coach', refreshUrl: 'https://app.test/coach' }
  if (opts.onboard !== false) {
    await startPayoutOnboarding(stripe, store, { coachId: coach.id, ...urls }, clock)
    const acct = (await db.payoutAccounts.get(coach.id))!
    await apply(stripe.finishOnboarding(acct.stripeAccountId))
  }
  const checkout = (plan: 'monthly' | 'annual' = 'monthly') =>
    createCheckout(stripe, store, {
      memberId: member.id,
      memberName: member.displayName,
      coachId: coach.id,
      programmeId: p.id,
      plan,
      successUrl: 'https://app.test/?paid=1',
      cancelUrl: 'https://app.test/c/sam-rivera',
    })
  return { stripe, store, clock, apply, programme: p, checkout, urls }
}

// T15, T16: coach payout onboarding.
describe('T15/T16: coach payouts', () => {
  it('creates one Stripe account per coach and enables payouts once onboarding is finished', async () => {
    const { stripe, store, apply, clock, urls } = await setup({ onboard: false })
    const { url } = await startPayoutOnboarding(stripe, store, { coachId: coach.id, ...urls }, clock)
    expect(url).toMatch(/connect\.stripe\.test\/setup\/acct_/)
    await startPayoutOnboarding(stripe, store, { coachId: coach.id, ...urls }, clock)
    expect(stripe.accountsById.size).toBe(1)

    const acct = (await db.payoutAccounts.get(coach.id))!
    expect(acct.chargesEnabled).toBe(false)
    await apply(stripe.finishOnboarding(acct.stripeAccountId))
    expect(await db.payoutAccounts.get(coach.id)).toMatchObject({ chargesEnabled: true, payoutsEnabled: true })
  })

  it('refuses checkout until the coach can take payments', async () => {
    const { checkout } = await setup({ onboard: false })
    await expect(checkout()).rejects.toThrow(/can’t take payments yet/)
  })
})

// T08, T17: web subscribe, happy path.
describe('T08/T17: subscribe and pay', () => {
  it('activates the subscription, records the charge and takes a 10% fee', async () => {
    const { stripe, apply, checkout } = await setup()
    const { sessionId, url } = await checkout()
    expect(url).toMatch(/checkout\.stripe\.test/)
    expect(await apply(stripe.completeCheckout(sessionId))).toEqual(['subscribed', 'charged'])

    const enrolment = (await db.enrolments.where('userId').equals(member.id).first())!
    expect(enrolment).toMatchObject({ status: 'active', billing: 'paid', coachId: coach.id })
    const sub = (await db.subscriptions.where('userId').equals(member.id).first())!
    expect(sub).toMatchObject({ status: 'active', plan: 'monthly', amountPence: 2999, enrolmentId: enrolment.id })
    const [payment] = await db.payments.toArray()
    expect(payment).toMatchObject({ kind: 'charge', amountPence: 2999, platformFeePence: 300, coachId: coach.id })
    expect(programmeAccess({ billing: 'paid', betaEndsAt: null, subscription: sub, now: stripe.nowIso() }).ok).toBe(true)
  })

  it('charges ten months for the annual plan (Q7)', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout('annual')).sessionId))
    expect(await db.subscriptions.toArray()).toMatchObject([{ plan: 'annual', amountPence: 29990 }])
    expect(await db.payments.toArray()).toMatchObject([{ amountPence: 29990, platformFeePence: 2999 }])
  })

  it('starts a 7-day trial with no charge when the coach offers one (Q8)', async () => {
    const { stripe, apply, checkout } = await setup({ trialDays: 7 })
    const { sessionId } = await checkout()
    expect(await apply(stripe.completeCheckout(sessionId))).toEqual(['subscribed'])
    const sub = (await db.subscriptions.toArray())[0]
    expect(sub.status).toBe('trialing')
    expect(Date.parse(sub.trialEnd!) - Date.parse(stripe.nowIso())).toBe(7 * 864e5)
    expect(await db.payments.count()).toBe(0)
    stripe.advanceDays(7)
    expect(await apply(stripe.renew(sub.stripeSubscriptionId))).toEqual(['subscription active', 'charged'])
  })
})

// T10, T11, T12: declined card, 3-D Secure, double tap.
describe('T10–T12: checkout edge cases', () => {
  it('creates nothing when the card is declined or 3-D Secure fails', async () => {
    const { stripe, apply, checkout } = await setup()
    expect(await apply(stripe.completeCheckout((await checkout()).sessionId, 'declined'))).toEqual([])
    expect(await apply(stripe.completeCheckout((await checkout()).sessionId, 'needs-3ds-fail'))).toEqual([])
    expect(await db.subscriptions.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
  })

  it('activates only after 3-D Secure passes', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId, 'needs-3ds-pass'))
    expect(await db.subscriptions.count()).toBe(1)
  })

  it('records exactly one subscription and charge when events arrive twice', async () => {
    const { stripe, apply, checkout } = await setup()
    const { sessionId } = await checkout()
    const events = stripe.completeCheckout(sessionId)
    await apply(events)
    expect(await apply(events)).toEqual(['duplicate', 'duplicate']) // webhook retried
    expect(stripe.completeCheckout(sessionId)).toEqual([]) // pay button tapped twice
    expect(await db.subscriptions.count()).toBe(1)
    expect(await db.payments.count()).toBe(1)
  })

  it('refuses a second checkout once subscribed', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    await expect(checkout()).rejects.toThrow(/already subscribed/)
  })
})

// T18 and Q5: fee cap.
describe('fee cap (Q5)', () => {
  it('hands back fees above £30 in a month', async () => {
    const { stripe, apply, checkout } = await setup()
    // Ten other members already paid this month: £30 of fees taken.
    for (let i = 0; i < 10; i++) {
      await db.payments.put({ id: `p${i}`, userId: `m${i}`, coachId: coach.id, memberId: `m${i}`, kind: 'charge', amountPence: 2999, platformFeePence: 300, processingFeePence: 65, occurredAt: '2026-11-02T09:00:00Z', externalId: `ch_old_${i}`, updatedAt: '2026-11-02T09:00:00Z', deleted: false })
    }
    expect(await apply(stripe.completeCheckout((await checkout()).sessionId))).toEqual(['subscribed', 'charged, fee capped'])
    const newest = (await db.payments.filter((x) => x.memberId === member.id).first())!
    expect(newest.platformFeePence).toBe(0)
    expect(stripe.feeRefunds).toEqual([{ feeId: expect.stringMatching(/^fee_/), amount: 300 }])
    expect(earningsForMonth(await db.payments.toArray(), coach.id, '2026-11')).toMatchObject({ platformFeePence: 3000, capReached: true })
  })
})

// T20, T22: cancel and failed renewal.
describe('T20/T22: cancelling and failed renewals', () => {
  it('cancel keeps access to period end with no further charge', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    const sub = (await db.subscriptions.toArray())[0]
    await apply(stripe.cancelAtPeriodEnd(sub.stripeSubscriptionId))
    expect((await db.subscriptions.get(sub.id))!.cancelAtPeriodEnd).toBe(true)
    stripe.advanceDays(30)
    expect(await apply(stripe.renew(sub.stripeSubscriptionId))).toEqual(['subscription canceled'])
    expect(await db.payments.count()).toBe(1)
    expect((await db.enrolments.get(sub.enrolmentId))!.status).toBe('cancelled')
  })

  it('failed renewal goes past due (access kept), then access ends when retries run out', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    const sub = (await db.subscriptions.toArray())[0]
    stripe.advanceDays(30)
    await apply(stripe.renew(sub.stripeSubscriptionId, 'declined'))
    let s = (await db.subscriptions.get(sub.id))!
    expect(s.status).toBe('past_due')
    expect(programmeAccess({ billing: 'paid', betaEndsAt: null, subscription: s, now: stripe.nowIso() }).ok).toBe(true)
    stripe.advanceDays(14)
    await apply(stripe.exhaustRetries(sub.stripeSubscriptionId))
    s = (await db.subscriptions.get(sub.id))!
    expect(programmeAccess({ billing: 'paid', betaEndsAt: null, subscription: s, now: stripe.nowIso() })).toEqual({ ok: false, reason: 'ended' })
    expect((await db.enrolments.get(sub.enrolmentId))!.status).toBe('cancelled')
  })
})

// T21, T23, T19: refunds, disputes, reconciliation.
describe('T19/T21/T23: refunds, disputes and reconciliation', () => {
  it('records a refund with the fee reversed, and a dispute against the coach', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    const charge = (await db.payments.toArray())[0]
    await apply(stripe.refund(charge.externalId))
    await apply(stripe.dispute(charge.externalId))
    const rows = await db.payments.orderBy('occurredAt').toArray()
    expect(rows.map((r) => [r.kind, r.amountPence, r.platformFeePence])).toEqual(
      expect.arrayContaining([['charge', 2999, 300], ['refund', 2999, 300], ['dispute', 2999, 0]]),
    )
    const month = earningsForMonth(rows, coach.id, '2026-11')
    expect(month.platformFeePence).toBe(0)
  })

  it('matches the provider to the penny after many payments', async () => {
    const { stripe, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    const sub = (await db.subscriptions.toArray())[0]
    for (let i = 0; i < 12; i++) {
      stripe.advanceDays(30)
      await apply(stripe.renew(sub.stripeSubscriptionId))
    }
    const ledger = (await db.payments.toArray()).filter((p) => p.kind === 'charge')
    expect(ledger).toHaveLength(13)
    expect(reconcile(ledger, stripe.providerRecords())).toEqual([])
  })
})

describe('beta members (Q10)', () => {
  it('turns a free beta enrolment into a paid one on checkout, keeping their place', async () => {
    const { stripe, apply, checkout, programme } = await setup()
    const page = (await db.coachProfiles.get(coach.id))!
    const beta = await joinCoach(member, page, programme.id)
    expect(beta.billing).toBe('beta')
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    const after = await db.enrolments.where('userId').equals(member.id).toArray()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: beta.id, billing: 'paid', status: 'active' })
  })
})

describe('billing portal', () => {
  it('opens only for the subscription’s own member', async () => {
    const { stripe, store, apply, checkout } = await setup()
    await apply(stripe.completeCheckout((await checkout()).sessionId))
    const sub = (await db.subscriptions.toArray())[0]
    const { url } = await billingPortal(stripe, store, { memberId: member.id, stripeSubscriptionId: sub.stripeSubscriptionId, returnUrl: 'https://app.test/account' })
    expect(url).toMatch(/billing\.stripe\.test\/cus_/)
    await expect(billingPortal(stripe, store, { memberId: 'someone-else', stripeSubscriptionId: sub.stripeSubscriptionId, returnUrl: 'x' })).rejects.toThrow(/not found/)
  })
})
