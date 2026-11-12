// POST {returnUrl} → {url}: send a coach to Stripe's hosted payout set-up.
import { startPayoutOnboarding } from '../../../src/server/payments.ts'
import { caller, cors, json, stripeLike, supabaseStore } from '../_shared/context.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const user = await caller(req)
  if (!user || user.role !== 'coach') return json({ error: 'Only coaches can set up payouts.' }, 403)
  const { returnUrl } = await req.json()
  try {
    const result = await startPayoutOnboarding(stripeLike, supabaseStore(), { coachId: user.id, email: user.email, returnUrl, refreshUrl: returnUrl })
    return json(result)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Could not start payout set-up.' }, 400)
  }
})
