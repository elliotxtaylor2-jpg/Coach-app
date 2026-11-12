/** Starter library; coaches will extend this in M2. */
export const EXERCISES = [
  'Back squat',
  'Front squat',
  'Deadlift',
  'Romanian deadlift',
  'Bench press',
  'Incline dumbbell press',
  'Overhead press',
  'Pull-up',
  'Barbell row',
  'Lat pulldown',
  'Seated cable row',
  'Split squat',
  'Walking lunge',
  'Hip thrust',
  'Leg press',
  'Leg curl',
  'Leg extension',
  'Calf raise',
  'Dumbbell curl',
  'Triceps pushdown',
  'Lateral raise',
  'Face pull',
  'Plank',
  'Hanging leg raise',
] as const

export function searchExercises(query: string, extra: string[] = []): string[] {
  const q = query.trim().toLowerCase()
  const all = Array.from(new Set([...extra, ...EXERCISES]))
  return q ? all.filter((e) => e.toLowerCase().includes(q)) : all
}
