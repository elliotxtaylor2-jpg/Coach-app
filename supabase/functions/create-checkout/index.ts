// POST {coachId, programmeId, plan, successUrl, cancelUrl} → {url}: start a member's Stripe Checkout.
import { createCheckout } from '../../../src/server/payments.ts'
import { caller, cors, json, stripeLike, supabaseStore } from '../_shared/context.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const user = await caller(req)
  if (!user || user.role !== 'member') return json({ error: 'Sign in with a member account to subscribe.' }, 403)
  const body = await req.json()
  if (body.plan !== 'monthly' && body.plan !== 'annual') return json({ error: 'Choose monthly or annual.' }, 400)
  try {
    const result = await createCheckout(stripeLike, supabaseStore(), {
      memberId: user.id,
      memberName: user.displayName,
      memberEmail: user.email,
      coachId: String(body.coachId),
      programmeId: String(body.programmeId),
      plan: body.plan,
      successUrl: String(body.successUrl),
      cancelUrl: String(body.cancelUrl),
    })
    return json({ url: result.url })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Could not start checkout.' }, 400)
  }
})
