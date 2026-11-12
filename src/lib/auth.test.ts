import { describe, expect, it } from 'vitest'
import { AuthError, demoAuth, validateSignUp } from './auth'

const valid = { email: 'sam@example.com', password: 'squat-heavy-1', displayName: 'Sam Rivera' }

// T01: new coach sign-up creates a coach account and signs them in.
describe('T01: sign-up with a role', () => {
  it('creates a coach account and keeps them signed in', async () => {
    const auth = demoAuth(localStorage)
    const profile = await auth.signUp({ ...valid, role: 'coach' })
    expect(profile).toMatchObject({ email: 'sam@example.com', displayName: 'Sam Rivera', role: 'coach' })
    expect(await auth.current()).toEqual(profile)
    expect(profile).not.toHaveProperty('password')
  })

  it('creates a member account', async () => {
    const profile = await demoAuth(localStorage).signUp({ ...valid, role: 'member' })
    expect(profile.role).toBe('member')
  })

  it('rejects a duplicate email regardless of case', async () => {
    const auth = demoAuth(localStorage)
    await auth.signUp({ ...valid, role: 'member' })
    await expect(auth.signUp({ ...valid, email: 'SAM@example.com', role: 'coach' })).rejects.toThrow(AuthError)
  })

  it('signs in with the right password only, and signs out', async () => {
    const auth = demoAuth(localStorage)
    await auth.signUp({ ...valid, role: 'member' })
    await auth.signOut()
    expect(await auth.current()).toBeNull()
    await expect(auth.signIn({ email: valid.email, password: 'wrong-password' })).rejects.toThrow(/incorrect/)
    const back = await auth.signIn({ email: valid.email, password: valid.password })
    expect(back.email).toBe(valid.email)
  })
})

describe('sign-up validation', () => {
  it.each([
    [{ ...valid, email: 'not-an-email' }, /valid email/],
    [{ ...valid, password: 'short' }, /8 characters/],
    [{ ...valid, displayName: '  ' }, /name/],
  ])('explains what to fix', (input, message) => {
    expect(validateSignUp(input)).toMatch(message)
  })

  it('accepts valid details', () => {
    expect(validateSignUp(valid)).toBeNull()
  })
})
