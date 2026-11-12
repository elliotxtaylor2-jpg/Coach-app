export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const mins = Math.max(0, Math.round(((endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso)) / 60000))
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`
}

export function formatKg(kg: number): string {
  return `${kg.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kg`
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Parse a weight/reps input; empty or invalid becomes null. Accepts "77,5" too. */
export function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim())
  return raw.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n
}
