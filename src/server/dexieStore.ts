/**
 * ServerStore backed by the on-device database: used by tests and by demo mode, where there is no
 * server. Writes go straight to the tables, not the sync outbox, because in production these rows
 * are written by the server and only pulled down by the app.
 */
import { db } from '../lib/db.ts'
import type { ServerStore } from './payments.ts'

export function dexieServerStore(): ServerStore {
  const handled = new Set<string>()
  return {
    getCoach: (id) => db.coachProfiles.get(id),
    putCoach: async (row) => void (await db.coachProfiles.put(row)),
    getPayoutAccount: (coachId) => db.payoutAccounts.get(coachId),
    getPayoutAccountByStripeId: (sid) => db.payoutAccounts.where('stripeAccountId').equals(sid).first(),
    putPayoutAccount: async (row) => void (await db.payoutAccounts.put(row)),
    getEnrolment: (id) => db.enrolments.get(id),
    activeEnrolmentFor: async (memberId, coachId) =>
      (await db.enrolments.where('userId').equals(memberId).filter((e) => e.coachId === coachId && e.status === 'active' && !e.deleted).toArray())
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0],
    putEnrolment: async (row) => void (await db.enrolments.put(row)),
    getSubscriptionByStripeId: (sid) => db.subscriptions.where('stripeSubscriptionId').equals(sid).first(),
    putSubscription: async (row) => void (await db.subscriptions.put(row)),
    paymentsForCoach: (coachId) => db.payments.where('coachId').equals(coachId).toArray(),
    getPaymentByExternalId: (eid) => db.payments.where('externalId').equals(eid).first(),
    insertPayment: async (row) => {
      if (await db.payments.where('externalId').equals(row.externalId).count()) return false
      await db.payments.put(row)
      return true
    },
    markEventHandled: async (id) => {
      if (handled.has(id)) return false
      handled.add(id)
      return true
    },
  }
}
