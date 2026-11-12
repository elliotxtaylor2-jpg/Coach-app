/**
 * How the app starts payment flows. Live mode calls the Supabase Edge Functions and sends the user to
 * Stripe's hosted pages. Demo mode (no Supabase keys) runs the same server logic against a simulated
 * Stripe on the device, so every screen can be tried before a Stripe account exists (Q9).
 */
import { db } from './db'
import { supabase } from './supabase'
import type { CoachProfile, Profile, Subscription } from './types'
import type { Plan } from './billing'
import { dexieServerStore } from '../server/dexieStore'
import { FakeStripe } from '../server/fakeStripe'
import { createCheckout, handleStripeEvent, startPayoutOnboarding, type StripeEvent } from '../server/payments'

export interface PaymentsGateway {
  mode: 'live' | 'demo'
  /** Coach: go to Stripe to set up payouts. Demo: finishes immediately. */
  setUpPayouts(coach: Profile): Promise<void>
  /** Member: pay for a programme. Demo: completes immediately with a test card. */
  checkout(member: Profile, coach: CoachProfile, programmeId: string, plan: Plan): Promise<void>
  /** Member: update card or cancel. Demo: cancels at period end after confirming. */
  manageBilling(member: Profile, sub: Subscription): Promise<'opened' | 'cancelled' | 'kept'>
}

const origin = () => window.location.origin

function liveGateway(): PaymentsGateway {
  async function call(name: string, body: Record<string, unknown>): Promise<string> {
    const { data, error } = await supabase!.functions.invoke(name, { body })
    if (error || !data?.url) throw new Error(data?.error ?? error?.message ?? 'Payments are unavailable right now.')
    return data.url as string
  }
  return {
    mode: 'live',
    async setUpPayouts() {
      window.location.assign(await call('connect-onboard', { returnUrl: `${origin()}/coach?payouts=done` }))
    },
    async checkout(_member, coach, programmeId, plan) {
      window.location.assign(
        await call('create-checkout', { coachId: coach.id, programmeId, plan, successUrl: `${origin()}/?paid=1`, cancelUrl: `${origin()}/c/${coach.slug}` }),
      )
    },
    async manageBilling(_member, sub) {
      window.location.assign(await call('billing-portal', { stripeSubscriptionId: sub.stripeSubscriptionId, returnUrl: `${origin()}/account` }))
      return 'opened'
    },
  }
}

let demoStripe: FakeStripe | null = null
const demoStore = dexieServerStore()

export function demoGateway(confirm: (msg: string) => boolean = (m) => window.confirm(m)): PaymentsGateway {
  const stripe = (demoStripe ??= new FakeStripe())
  const apply = async (events: StripeEvent[]) => {
    for (const e of events) await handleStripeEvent(stripe, demoStore, e)
  }
  return {
    mode: 'demo',
    async setUpPayouts(coach) {
      await startPayoutOnboarding(stripe, demoStore, { coachId: coach.id, email: coach.email, returnUrl: origin(), refreshUrl: origin() })
      const acct = (await db.payoutAccounts.get(coach.id))!
      if (!stripe.accountsById.has(acct.stripeAccountId)) stripe.accountsById.set(acct.stripeAccountId, { id: acct.stripeAccountId, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false })
      await apply(stripe.finishOnboarding(acct.stripeAccountId))
    },
    async checkout(member, coach, programmeId, plan) {
      // A device reload forgets the simulated Stripe; re-register the coach's account if needed.
      const acct = await db.payoutAccounts.get(coach.id)
      if (acct && !stripe.accountsById.has(acct.stripeAccountId)) {
        stripe.accountsById.set(acct.stripeAccountId, { id: acct.stripeAccountId, detailsSubmitted: true, chargesEnabled: acct.chargesEnabled, payoutsEnabled: acct.payoutsEnabled })
      }
      const { sessionId } = await createCheckout(stripe, demoStore, {
        memberId: member.id,
        memberName: member.displayName,
        memberEmail: member.email,
        coachId: coach.id,
        programmeId,
        plan,
        successUrl: origin(),
        cancelUrl: origin(),
      })
      await apply(stripe.completeCheckout(sessionId))
    },
    async manageBilling(_member, sub) {
      if (!confirm('Demo billing: cancel this subscription at the end of the current period?')) return 'kept'
      if (stripe.subs.has(sub.stripeSubscriptionId)) await apply(stripe.cancelAtPeriodEnd(sub.stripeSubscriptionId))
      else await db.subscriptions.put({ ...sub, cancelAtPeriodEnd: true, updatedAt: new Date().toISOString() })
      return 'cancelled'
    },
  }
}

export const payments: PaymentsGateway = supabase ? liveGateway() : demoGateway()
