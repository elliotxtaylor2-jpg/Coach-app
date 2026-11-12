import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile, Role } from './types'

/** Sign-in backends: Supabase in production, an on-device store in demo mode and tests. */
export interface AuthBackend {
  mode: 'supabase' | 'demo'
  current(): Promise<Profile | null>
  signUp(input: { email: string; password: string; displayName: string; role: Role }): Promise<Profile>
  signIn(input: { email: string; password: string }): Promise<Profile>
  signOut(): Promise<void>
}

export class AuthError extends Error {}

export function validateSignUp(input: { email: string; password: string; displayName: string }): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'Enter a valid email address.'
  if (input.password.length < 8) return 'Use at least 8 characters for your password.'
  if (!input.displayName.trim()) return 'Enter your name.'
  return null
}

const DEMO_USERS = 'coach-app:demo-users'
const DEMO_SESSION = 'coach-app:demo-session'

interface DemoUser extends Profile {
  password: string
}

/**
 * Demo mode keeps accounts in this browser only. It exists so the app is usable
 * before a Supabase project is set up; passwords here are not secure.
 */
export function demoAuth(storage: Storage = localStorage): AuthBackend {
  const read = (): DemoUser[] => JSON.parse(storage.getItem(DEMO_USERS) ?? '[]')
  const write = (users: DemoUser[]) => storage.setItem(DEMO_USERS, JSON.stringify(users))
  const strip = ({ password: _p, ...profile }: DemoUser): Profile => profile

  return {
    mode: 'demo',
    async current() {
      const id = storage.getItem(DEMO_SESSION)
      const user = read().find((u) => u.id === id)
      return user ? strip(user) : null
    },
    async signUp(input) {
      const problem = validateSignUp(input)
      if (problem) throw new AuthError(problem)
      const email = input.email.trim().toLowerCase()
      const users = read()
      if (users.some((u) => u.email === email)) throw new AuthError('An account with that email already exists.')
      const user: DemoUser = {
        id: crypto.randomUUID(),
        email,
        displayName: input.displayName.trim(),
        role: input.role,
        password: input.password,
      }
      write([...users, user])
      storage.setItem(DEMO_SESSION, user.id)
      return strip(user)
    },
    async signIn(input) {
      const email = input.email.trim().toLowerCase()
      const user = read().find((u) => u.email === email && u.password === input.password)
      if (!user) throw new AuthError('Email or password is incorrect.')
      storage.setItem(DEMO_SESSION, user.id)
      return strip(user)
    },
    async signOut() {
      storage.removeItem(DEMO_SESSION)
    },
  }
}

export function supabaseAuth(client: SupabaseClient): AuthBackend {
  async function loadProfile(userId: string, email: string): Promise<Profile> {
    const { data, error } = await client.from('profiles').select('id, display_name, role').eq('id', userId).single()
    if (error || !data) throw new AuthError('Could not load your profile.')
    return { id: data.id, email, displayName: data.display_name, role: data.role }
  }

  return {
    mode: 'supabase',
    async current() {
      const { data } = await client.auth.getSession()
      const user = data.session?.user
      return user ? loadProfile(user.id, user.email ?? '') : null
    },
    async signUp(input) {
      const problem = validateSignUp(input)
      if (problem) throw new AuthError(problem)
      const { data, error } = await client.auth.signUp({
        email: input.email.trim(),
        password: input.password,
        // A database trigger copies these into the profiles table (see supabase/schema.sql).
        options: { data: { display_name: input.displayName.trim(), role: input.role } },
      })
      if (error) throw new AuthError(error.message)
      if (!data.user) throw new AuthError('Check your email to confirm your account, then sign in.')
      if (!data.session) throw new AuthError('Check your email to confirm your account, then sign in.')
      return loadProfile(data.user.id, data.user.email ?? '')
    },
    async signIn(input) {
      const { data, error } = await client.auth.signInWithPassword({ email: input.email.trim(), password: input.password })
      if (error || !data.user) throw new AuthError(error?.message ?? 'Email or password is incorrect.')
      return loadProfile(data.user.id, data.user.email ?? '')
    },
    async signOut() {
      await client.auth.signOut()
    },
  }
}
