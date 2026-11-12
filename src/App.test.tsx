import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
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
    expect(await screen.findByText(/coach tools are on the way/i)).toBeInTheDocument()
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
