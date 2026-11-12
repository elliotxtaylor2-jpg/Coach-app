// Shared set-up for the payment Edge Functions (Deno). See README "Turn on payments".
import Stripe from 'npm:stripe@17'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ServerStore, StripeLike } from '../../../src/server/payments.ts'

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { httpClient: Stripe.createFetchHttpClient() })
export const stripeLike = stripe as unknown as StripeLike

/** Service-role client: bypasses row-level security, so only the server ever uses it. */
export const admin: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
})

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** The signed-in user calling the function, from their Supabase access token. */
export async function caller(req: Request): Promise<{ id: string; email?: string; role: string; displayName: string } | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data } = await admin.auth.getUser(token)
  if (!data.user) return null
  const { data: profile } = await admin.from('profiles').select('role, display_name').eq('id', data.user.id).single()
  return profile ? { id: data.user.id, email: data.user.email ?? undefined, role: profile.role, displayName: profile.display_name } : null
}

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const mapKeys = (row: Record<string, unknown>, fn: (k: string) => string) => Object.fromEntries(Object.entries(row).map(([k, v]) => [fn(k), v]))
// deno-lint-ignore no-explicit-any
const camel = (row: any) => (row ? (mapKeys(row, toCamel) as any) : undefined)
const snake = (row: object) => mapKeys(row as Record<string, unknown>, toSnake)

async function one(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return camel(data)
}

/** ServerStore over Postgres via the service-role client. */
export function supabaseStore(db: SupabaseClient = admin): ServerStore {
  return {
    getCoach: (id) => one(db.from('coach_profiles').select('*').eq('id', id).maybeSingle()),
    putCoach: async (row) => void (await one(db.from('coach_profiles').update({ takes_payments: row.takesPayments, updated_at: row.updatedAt }).eq('id', row.id).select().single())),
    getPayoutAccount: (coachId) => one(db.from('payout_accounts').select('*').eq('id', coachId).maybeSingle()),
    getPayoutAccountByStripeId: (sid) => one(db.from('payout_accounts').select('*').eq('stripe_account_id', sid).maybeSingle()),
    putPayoutAccount: async (row) => void (await one(db.from('payout_accounts').upsert(snake(row)).select().single())),
    getEnrolment: (id) => one(db.from('enrolments').select('*').eq('id', id).maybeSingle()),
    activeEnrolmentFor: (memberId, coachId) =>
      one(
        db.from('enrolments').select('*').eq('user_id', memberId).eq('coach_id', coachId).eq('status', 'active').eq('deleted', false)
          .order('started_at', { ascending: false }).limit(1).maybeSingle(),
      ),
    putEnrolment: async (row) => void (await one(db.from('enrolments').upsert(snake(row)).select().single())),
    getSubscriptionByStripeId: (sid) => one(db.from('subscriptions').select('*').eq('stripe_subscription_id', sid).maybeSingle()),
    putSubscription: async (row) => void (await one(db.from('subscriptions').upsert(snake(row)).select().single())),
    paymentsForCoach: async (coachId) => {
      const { data, error } = await db.from('payments').select('*').eq('coach_id', coachId)
      if (error) throw new Error(error.message)
      return (data ?? []).map(camel)
    },
    getPaymentByExternalId: (eid) => one(db.from('payments').select('*').eq('external_id', eid).maybeSingle()),
    insertPayment: async (row) => {
      const { error } = await db.from('payments').insert(snake(row))
      if (error && error.code === '23505') return false // duplicate external_id: a webhook retry
      if (error) throw new Error(error.message)
      return true
    },
    markEventHandled: async (id) => {
      const { error } = await db.from('stripe_events').insert({ id })
      if (error && error.code === '23505') return false
      if (error) throw new Error(error.message)
      return true
    },
  }
}
