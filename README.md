# Coach App

Coaches publish training programmes; members subscribe, follow them and log every set. This repo is the web app (an installable PWA), built milestone by milestone from the [plan](https://claude.ai/artifact/2bS3pLrZ5BH2GxTgeuqjeW).

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
| T13 Today's workout pre-filled | `src/lib/enrolment.test.ts` (from the programme), `src/lib/repo.test.ts` (last weights) |
| T14 Offline logging, synced once | `src/lib/sync.test.ts` |
| End-to-end: sign up → log → history | `src/App.test.tsx` |

## Next: M3 payments

Stripe Connect for coach payouts, web checkout with a capped 10% platform fee, annual plans, cancellations, refunds and failed renewals.
