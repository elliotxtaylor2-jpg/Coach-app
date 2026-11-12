// POST {stripeSubscriptionId, returnUrl} → {url}: Stripe's billing portal to update a card or cancel.
import { billingPortal } from '../../../src/server/payments.ts'
import { caller, cors, json, stripeLike, supabaseStore } from '../_shared/context.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const user = await caller(req)
  if (!user) return json({ error: 'Sign in first.' }, 401)
  const body = await req.json()
  try {
    return json(await billingPortal(stripeLike, supabaseStore(), { memberId: user.id, stripeSubscriptionId: String(body.stripeSubscriptionId), returnUrl: String(body.returnUrl) }))
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Could not open billing.' }, 400)
  }
})
