# Coach App

Coaches publish training programmes; members subscribe, follow them and log every set. This repo is the web app (an installable PWA), built milestone by milestone from the [plan](https://claude.ai/artifact/2bS3pLrZ5BH2GxTgeuqjeW).

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
| T13 Today's workout pre-filled | `src/lib/repo.test.ts` (from last completed sets until coach programmes exist) |
| T14 Offline logging, synced once | `src/lib/sync.test.ts` |
| End-to-end: sign up → log → history | `src/App.test.tsx` |

## Next: M2 coach side

Coach profile and share link, programme builder with versions, and members following a coach's programme (T04–T07).
