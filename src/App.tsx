import { useMemo } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './app/AuthContext'
import { RequireRole } from './app/RequireRole'
import { useSync } from './app/useSync'
import { demoAuth, supabaseAuth, type AuthBackend } from './lib/auth'
import { supabase } from './lib/supabase'
import { CoachHome } from './pages/CoachHome'
import { History, WorkoutDetail } from './pages/History'
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import { WorkoutPage } from './pages/WorkoutPage'

export function AppRoutes() {
  const { profile } = useAuth()
  const sync = useSync(undefined, !!profile)
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/" element={<RequireRole role="member"><Home sync={sync} /></RequireRole>} />
      <Route path="/workout/:id" element={<RequireRole role="member"><WorkoutPage /></RequireRole>} />
      <Route path="/history" element={<RequireRole role="member"><History /></RequireRole>} />
      <Route path="/history/:id" element={<RequireRole role="member"><WorkoutDetail /></RequireRole>} />
      <Route path="/coach" element={<RequireRole role="coach"><CoachHome /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App({ backend }: { backend?: AuthBackend }) {
  const auth = useMemo(() => backend ?? (supabase ? supabaseAuth(supabase) : demoAuth()), [backend])
  return (
    <AuthProvider backend={auth}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
