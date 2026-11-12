// Stripe Connect webhook. Verifies the signature, then applies the event once.
// Deploy with --no-verify-jwt: Stripe signs requests itself and sends no Supabase token.
import Stripe from 'npm:stripe@17'
import { handleStripeEvent, type StripeEvent } from '../../../src/server/payments.ts'
import { stripe, stripeLike, supabaseStore } from '../_shared/context.ts'

const crypto = Stripe.createSubtleCryptoProvider()

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!signature || !secret) return new Response('Missing signature', { status: 400 })
  const body = await req.text()
  let event: StripeEvent
  try {
    event = (await stripe.webhooks.constructEventAsync(body, signature, secret, undefined, crypto)) as unknown as StripeEvent
  } catch {
    return new Response('Bad signature', { status: 400 })
  }
  try {
    const outcome = await handleStripeEvent(stripeLike, supabaseStore(), event)
    return new Response(JSON.stringify({ received: true, outcome }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    // A 500 makes Stripe retry later; handling is idempotent.
    console.error(event.type, event.id, err)
    return new Response('Handler failed', { status: 500 })
  }
})
