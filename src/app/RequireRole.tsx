import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Role } from '../lib/types'
import { useAuth } from './AuthContext'

/** Redirects signed-out users to sign-in, and users with the wrong role to their own home. */
export function RequireRole({ role, children }: { role?: Role; children: ReactNode }) {
  const { profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p className="center muted">Loading…</p>
  if (!profile) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
  if (role && profile.role !== role) return <Navigate to={homeFor(profile.role)} replace />
  return <>{children}</>
}

export const homeFor = (role: Role) => (role === 'coach' ? '/coach' : '/')
