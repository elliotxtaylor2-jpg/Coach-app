# Sett

Coaches publish training programmes; members subscribe, follow them and log every set. This repo is the web app (an installable PWA), built milestone by milestone from the [plan](https://claude.ai/artifact/2bS3pLrZ5BH2GxTgeuqjeW).

## What's in M3 (payments)

- **Coaches are the seller** (Stripe Connect Express). A coach connects their bank through Stripe's hosted set-up; their page then shows plans instead of free joining.
- **Plans:** monthly, or annual at ten months' price (two months free). Coaches can offer a 7-day free trial.
- **Platform fee:** 10% of each payment, never more than £30 per coach per calendar month. Stripe takes 10% up front; the webhook refunds anything above the cap.
- **Members:** checkout on Stripe, banners for trial, failed payment (access kept while Stripe retries), cancelled (access to the end of the paid period) and paused; an account page to update a card or cancel.
- **Beta members** who joined free stay free until their coach gives them a week's notice to subscribe.
- **Earnings:** gross, refunds and disputes, platform fee, estimated card fees and net for the month, with how much of the cap is left.
- **Demo mode** runs the same payment code against a simulated Stripe on the device, so every flow works without a Stripe account. No real card is charged.

## What's in M2 (coach side)

- **Coach page and share link:** coaches set name, bio, specialism, monthly price and their link (`/c/your-name`). The page works for signed-out visitors and lists every published programme for members to choose from, with the coach's pick first.
- **Programme builder:** weeks × sessions × exercises, each with sets, reps (ranges like `8-10` and timed sets like `45s`), load, rest, notes and a video link. Reorder, copy a week to all weeks, autosave, and checks that say exactly what to fix before publishing.
- **Versions:** publishing creates a new, unchangeable version. Members get it from their next session; sessions already logged keep the prescription they were done with.
- **Members follow a programme:** joining is free until payments arrive in M3. Home shows the next session with this week's progress; starting it pre-fills sets from the coach's target reps and the member's last weights.
- **Coach dashboard:** set-up checklist, share link, programmes, members with status and last workout, and each member's full set logs.

## What's in M1 (tracker core)

- **Accounts with roles:** sign up as a coach or a member. Members land on their training home; coaches land on a coach dashboard (tools arrive in M2).
- **Workout logging:** start a workout, add exercises from a library or your own, log weight and reps, tick sets done, rest timer, add or remove sets.
- **Pre-filled targets:** a new exercise starts from the weight and reps you last completed.
- **History:** finished workouts with exercises, completed sets and total volume.
- **Offline first:** everything saves on the device immediately (IndexedDB) and syncs when online. Nothing is lost in a gym with no signal.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit and integration tests
npm run build      # production build in dist/
```

Without Supabase keys the app runs in **demo mode**: accounts and workouts stay in that browser only. Fine for trying it out and for coach interviews.

## Turn on accounts and sync (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project: **SQL Editor → New query**, paste `supabase/schema.sql`, run it.
3. **Settings → API**: copy the project URL and the `anon` public key.
4. `cp .env.example .env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Restart `npm run dev`.

If you set up Supabase before M2, run `supabase/schema.sql` again: it adds the M2 tables and is safe to re-run.

Optional while testing: **Authentication → Providers → Email** → turn off "Confirm email" so sign-up logs you straight in.

## Turn on payments (Stripe)

Needs Supabase set up first, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

1. Create a [Stripe](https://dashboard.stripe.com/register) account and stay in **test mode**. Turn on **Connect** (Express accounts, UK).
2. Copy the test **secret key** (Developers → API keys).
3. Deploy the server functions from this folder:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... APP_ORIGIN=https://<your-app-domain>
   supabase functions deploy connect-onboard
   supabase functions deploy create-checkout
   supabase functions deploy billing-portal
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
4. In Stripe: Developers → Webhooks → **Add endpoint**, choose **Events on Connected accounts**, URL `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, events: `account.updated`, `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `charge.refunded`, `charge.dispute.created`.
5. Copy the endpoint's signing secret and run `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`.
6. Re-run `supabase/schema.sql` to add the payment tables.
7. Test with Stripe's test cards, e.g. `4242 4242 4242 4242` (any future date, any CVC), `4000 0000 0000 0002` (declined), `4000 0027 6000 3184` (3-D Secure).

Card processing fees on the earnings screen are an estimate (1.5% + 20p, UK cards); Stripe's dashboard has the exact figures. VAT handling assumes coaches are the seller and still needs an accountant's sign-off before going live.

## Install on a phone

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages), open it on the phone and choose **Add to Home Screen**. It then opens full-screen and works offline.

## How it's built

| Part | Choice |
| --- | --- |
| UI | React 19 + TypeScript, Vite, React Router |
| On-device data | Dexie (IndexedDB) with live queries |
| Sync | Outbox queue: every local write queues its row; `syncNow` pushes, then pulls. Last write wins on `updatedAt`; edits made during a push stay queued |
| Backend | Supabase (Postgres, auth, row-level security) |
| Offline | `vite-plugin-pwa` service worker |
| Tests | Vitest, Testing Library, fake-indexeddb |

```
src/
  lib/        data model, repository, sync engine, auth backends, Supabase adapter
  app/        auth context, role guard, sync hook
  components/ set row, exercise card, rest timer, exercise picker
  pages/      sign-in, home, workout, history, coach dashboard
supabase/     schema.sql (tables, sign-up trigger, row-level security)
```

## Tests mapped to the plan

| Plan test | Covered by |
| --- | --- |
| T01 New coach sign-up | `src/lib/auth.test.ts` |
| T02 Sign in with Apple | Not in the web MVP; added with the iOS app |
| T03 Role isolation | `src/App.test.tsx` (screens) and `supabase/schema.sql` (row-level security) |
| T04 Share link page | `src/App.test.tsx` |
| T05 Build and publish 4 × 3 × 5 | `src/lib/coach.test.ts` |
| T06 Validation before publishing | `src/lib/coach.test.ts`, `src/App.test.tsx` |
| T07 Edit a live programme | `src/lib/enrolment.test.ts` |
| T08 Web subscribe, happy path | `src/server/payments.test.ts`, `src/App.test.tsx` |
| T10 Declined card · T11 3-D Secure · T12 Double tap | `src/server/payments.test.ts` |
| T15 Payout onboarding · T16 Payouts blocked | `src/server/payments.test.ts` |
| T17 Fee calculation · fee cap | `src/lib/billing.test.ts`, `src/server/payments.test.ts` |
| T19 Reconciliation | `src/lib/billing.test.ts`, `src/server/payments.test.ts` |
| T20 Cancel · T22 Failed renewal | `src/server/payments.test.ts`, `src/App.test.tsx` |
| T21 Refund · T23 Chargeback | `src/server/payments.test.ts` |
| T09 iOS in-app purchase · T18 in-app fee | Not in the web app; added with the iOS app |
| T13 Today's workout pre-filled | `src/lib/enrolment.test.ts` (from the programme), `src/lib/repo.test.ts` (last weights) |
| T14 Offline logging, synced once | `src/lib/sync.test.ts` |
| End-to-end: sign up → log → history | `src/App.test.tsx` |

## Next

Closed beta with real coaches (M5), then wearables and app-store builds (M4): Apple Health and Health Connect need a native app.
