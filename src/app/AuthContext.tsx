import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthBackend } from '../lib/auth'
import type { Profile, Role } from '../lib/types'

interface AuthState {
  mode: AuthBackend['mode']
  profile: Profile | null
  loading: boolean
  signUp: (input: { email: string; password: string; displayName: string; role: Role }) => Promise<void>
  signIn: (input: { email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ backend, children }: { backend: AuthBackend; children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    backend
      .current()
      .then((p) => alive && setProfile(p))
      .catch(() => alive && setProfile(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [backend])

  const signUp = useCallback<AuthState['signUp']>(async (input) => setProfile(await backend.signUp(input)), [backend])
  const signIn = useCallback<AuthState['signIn']>(async (input) => setProfile(await backend.signIn(input)), [backend])
  const signOut = useCallback(async () => {
    await backend.signOut()
    setProfile(null)
  }, [backend])

  const value = useMemo(
    () => ({ mode: backend.mode, profile, loading, signUp, signIn, signOut }),
    [backend.mode, profile, loading, signUp, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** For screens that only render once signed in. */
export function useProfile(): Profile {
  const { profile } = useAuth()
  if (!profile) throw new Error('No signed-in profile')
  return profile
}
