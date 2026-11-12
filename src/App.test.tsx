import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { AuthProvider } from './app/AuthContext'
import { demoAuth } from './lib/auth'
import type { Role } from './lib/types'

async function signedInAs(role: Role) {
  const backend = demoAuth(localStorage)
  await backend.signUp({ email: `${role}@example.com`, password: 'password-123', displayName: `Test ${role}`, role })
  return backend
}

function renderAt(path: string, backend = demoAuth(localStorage)) {
  return render(
    <AuthProvider backend={backend}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  )
}

// T03: role isolation in the app. (The database enforces the same rule with row-level security.)
describe('T03: role isolation', () => {
  it('sends a member who opens the coach dashboard back to their own home', async () => {
    renderAt('/coach', await signedInAs('member'))
    expect(await screen.findByRole('heading', { name: /ready to train/i })).toBeInTheDocument()
    expect(screen.queryByText(/coach tools/i)).not.toBeInTheDocument()
  })

  it('sends a coach who opens member screens to the coach dashboard', async () => {
    renderAt('/history', await signedInAs('coach'))
    expect(await screen.findByRole('heading', { name: 'Programmes' })).toBeInTheDocument()
  })

  it('sends signed-out visitors to sign-in', async () => {
    renderAt('/history')
    expect(await screen.findByRole('heading', { name: /create your account/i })).toBeInTheDocument()
  })
})

describe('end-to-end: sign up, log a workout, see it in history', () => {
  it('works for a new member', async () => {
    const user = userEvent.setup()
    renderAt('/sign-in')

    await user.type(await screen.findByLabelText('Your name'), 'Aisha Khan')
    await user.type(screen.getByLabelText('Email'), 'aisha@example.com')
    await user.type(screen.getByLabelText('Password'), 'password-123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await user.click(await screen.findByRole('button', { name: /start a workout/i }))
    await user.click(await screen.findByRole('button', { name: /add exercise/i }))
    await user.click(await screen.findByRole('button', { name: 'Back squat' }))

    const card = await screen.findByRole('region', { name: 'Back squat' })
    await user.type(await within(card).findByLabelText('Back squat set 1 weight in kg'), '80')
    await user.type(within(card).getByLabelText('Back squat set 1 reps'), '5')
    await user.click(within(card).getByRole('button', { name: 'Mark Back squat set 1 done' }))

    expect(await screen.findByRole('timer')).toHaveTextContent(/rest/i)
    expect(await within(card).findByText('1/3 done')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /finish workout/i }))
    expect(await screen.findByText('set done')).toBeInTheDocument()
    expect(screen.getByText('400 kg')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Done' }))
    expect(await screen.findByRole('navigation', { name: /recent workouts/i })).toBeInTheDocument()
  })
})

// T04: the coach's share link opens a public page showing name, bio, price and a join button.
describe('T04: coach share page', () => {
  async function publishedCoach() {
    const { createProgramme, emptyExercise, ensureCoachProfile, publishProgramme, saveDraft, updateCoachProfile } = await import('./lib/coach')
    const coach = { id: 'coach-x', email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach' as const }
    await ensureCoachProfile(coach)
    await updateCoachProfile(coach.id, { bio: 'Strength for busy people', priceGbp: 29.99 })
    for (const title of ['Strength Block', 'Muscle Builder']) {
      const p = await createProgramme(coach.id, title, 2, 1)
      const draft = structuredClone(p.draft)
      draft.weeks.forEach((w) => (w.days[0].exercises = [{ ...emptyExercise('Back squat'), sets: 3, reps: '5' }]))
      await saveDraft(p.id, { draft })
      await publishProgramme(p.id)
    }
  }

  it('shows the coach to a signed-out visitor and sends them to sign up on join', async () => {
    await publishedCoach()
    const user = userEvent.setup()
    renderAt('/c/sam-rivera')
    expect(await screen.findByRole('heading', { name: 'Sam Rivera' })).toBeInTheDocument()
    expect(screen.getByText('Strength for busy people')).toBeInTheDocument()
    expect(screen.getByText('£29.99')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Join Sam' }))
    expect(await screen.findByRole('heading', { name: /create your account/i })).toBeInTheDocument()
  })

  it('lets a member pick a programme, join, and start its first session', async () => {
    await publishedCoach()
    const user = userEvent.setup()
    renderAt('/c/sam-rivera', await signedInAs('member'))
    await user.click(await screen.findByRole('radio', { name: /muscle builder/i }))
    await user.click(screen.getByRole('button', { name: 'Join Sam' }))
    const card = await screen.findByRole('region', { name: 'Next session' })
    expect(await within(card).findByText(/Muscle Builder with Sam Rivera/)).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Start session' }))
    const squat = await screen.findByRole('region', { name: 'Back squat' })
    expect(within(squat).getByText(/Target 3 × 5/)).toBeInTheDocument()
    expect(await within(squat).findAllByLabelText(/reps$/)).toHaveLength(3)
  })

  it('shows a clear message for a link that doesn’t exist', async () => {
    renderAt('/c/nobody-here')
    expect(await screen.findByRole('heading', { name: 'Coach not found' })).toBeInTheDocument()
  })
})

describe('coach builds and publishes a programme on screen', () => {
  it('blocks publishing until sessions are filled, then publishes', async () => {
    const user = userEvent.setup()
    renderAt('/coach', await signedInAs('coach'))
    await user.click(await screen.findByRole('button', { name: /new programme/i }))
    await user.selectOptions(await screen.findByLabelText('Weeks'), '1')
    await user.selectOptions(screen.getByLabelText('Sessions a week'), '1')
    await user.click(screen.getByRole('button', { name: 'Publish programme' }))
    expect(await screen.findByText(/fix 1 issue/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add exercise/i }))
    await user.type(screen.getByLabelText('Exercise 1 name'), 'Back squat')
    await user.click(screen.getByRole('button', { name: 'Publish programme' }))
    expect(await screen.findByText(/published version 1/i)).toBeInTheDocument()
    expect(screen.getByText('On your page, shown first')).toBeInTheDocument()
  })
})

describe('M3: payments on screen (demo gateway, simulated Stripe)', () => {
  async function payingCoach(trialDays = 7) {
    const { createProgramme, emptyExercise, ensureCoachProfile, publishProgramme, saveDraft, updateCoachProfile } = await import('./lib/coach')
    const { payments } = await import('./lib/payments')
    const coach = { id: 'coach-pay', email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach' as const }
    await ensureCoachProfile(coach)
    await updateCoachProfile(coach.id, { priceGbp: 29.99, trialDays })
    const p = await createProgramme(coach.id, 'Strength Block', 1, 1)
    const draft = structuredClone(p.draft)
    draft.weeks[0].days[0].exercises = [{ ...emptyExercise('Back squat'), sets: 3, reps: '5' }]
    await saveDraft(p.id, { draft })
    await publishProgramme(p.id)
    await payments.setUpPayouts(coach)
    return coach
  }

  it('shows plans once the coach takes payments, and starts a free trial', async () => {
    await payingCoach(7)
    const user = userEvent.setup()
    renderAt('/c/sam-rivera', await signedInAs('member'))
    expect(await screen.findByRole('radio', { name: /annual · 2 months free/i })).toBeInTheDocument()
    expect(screen.getByText(/7-day free trial, then £29\.99 a month/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /annual/i }))
    expect(screen.getByText(/£299\.90 a year \(save £59\.98\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /monthly/i }))
    await user.click(screen.getByRole('button', { name: 'Start 7-day free trial' }))
    expect(await screen.findByText(/free trial until/i)).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Next session' })).toBeInTheDocument()
  })

  it('lets the member cancel and keep access to the end of the period', async () => {
    await payingCoach(0)
    const { demoGateway } = await import('./lib/payments')
    const { db } = await import('./lib/db')
    const member = await signedInAs('member')
    const profile = (await member.current())!
    await demoGateway(() => true).checkout(profile, (await db.coachProfiles.get('coach-pay'))!, (await db.programmes.toArray())[0].id, 'monthly')

    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/account', member)
    expect(await screen.findByText('£29.99 / month')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel subscription' }))
    expect(await screen.findByText(/cancelled\. you can keep training until/i)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('shows coach earnings with the fee taken', async () => {
    await payingCoach(0)
    const { demoGateway } = await import('./lib/payments')
    const { db } = await import('./lib/db')
    const { demoAuth: auth } = await import('./lib/auth')
    const m = await auth(localStorage).signUp({ email: 'm2@example.com', password: 'password-123', displayName: 'Member Two', role: 'member' })
    await demoGateway(() => true).checkout(m, (await db.coachProfiles.get('coach-pay'))!, (await db.programmes.toArray())[0].id, 'monthly')
    const coachBackend = demoAuth(localStorage)
    await coachBackend.signOut()
    localStorage.setItem('coach-app:demo-users', JSON.stringify([...JSON.parse(localStorage.getItem('coach-app:demo-users') ?? '[]'), { id: 'coach-pay', email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach', password: 'password-123' }]))
    await coachBackend.signIn({ email: 'sam@example.com', password: 'password-123' })
    renderAt('/coach/earnings', coachBackend)
    const month = await screen.findByRole('region', { name: 'This month' })
    expect(await within(month).findByText('£29.99')).toBeInTheDocument()
    expect(within(month).getByText('−£3.00')).toBeInTheDocument()
    expect(screen.getByText(/£27\.00 of platform fees left/)).toBeInTheDocument()
  })

  it('pauses the programme when the coach ends the free beta (Q10)', async () => {
    const { createProgramme, emptyExercise, ensureCoachProfile, publishProgramme, saveDraft, updateCoachProfile } = await import('./lib/coach')
    const { joinCoach } = await import('./lib/enrolment')
    const coach = { id: 'coach-beta', email: 'jo@example.com', displayName: 'Jo Bloggs', role: 'coach' as const }
    const page = await ensureCoachProfile(coach)
    const p = await createProgramme(coach.id, 'Block', 1, 1)
    const draft = structuredClone(p.draft)
    draft.weeks[0].days[0].exercises = [emptyExercise('Row')]
    await saveDraft(p.id, { draft })
    await publishProgramme(p.id)
    const member = await signedInAs('member')
    await joinCoach((await member.current())!, { ...page, offers: [{ programmeId: p.id, title: 'Block', description: '', weeks: 1, daysPerWeek: 1 }] }, p.id)
    await updateCoachProfile(coach.id, { betaEndsAt: new Date(Date.now() - 1000).toISOString() })
    renderAt('/', member)
    expect(await screen.findByText(/free beta has ended/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Next session' })).not.toBeInTheDocument()
  })
})
