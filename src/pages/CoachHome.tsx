import { useAuth, useProfile } from '../app/AuthContext'

/** Placeholder until M2 adds the profile, share link and programme builder. */
export function CoachHome() {
  const profile = useProfile()
  const { signOut } = useAuth()
  return (
    <main className="shell">
      <div className="topbar">
        <span className="muted small">Coach dashboard</span>
        <button type="button" className="btn ghost small" onClick={() => void signOut()}>Sign out</button>
      </div>
      <h1>Hi, {profile.displayName.split(' ')[0]}</h1>
      <div className="card stack">
        <span className="label">Your coach tools are on the way</span>
        <p className="muted" style={{ margin: 0 }}>
          Profile, share link and programme builder arrive in the next milestone. Your account is set up as a coach.
        </p>
      </div>
    </main>
  )
}
