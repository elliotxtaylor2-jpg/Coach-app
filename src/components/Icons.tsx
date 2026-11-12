const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

export const TickIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg {...base} stroke={color} strokeWidth={2.5}><path d="M5 12l5 5 9-10" /></svg>
)
export const TrashIcon = () => (
  <svg {...base} stroke="currentColor" width={18} height={18}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
)
export const PlusIcon = () => (
  <svg {...base} stroke="currentColor"><path d="M12 5v14M5 12h14" /></svg>
)
export const ChevronIcon = () => (
  <svg {...base} stroke="currentColor" width={18} height={18}><path d="M9 6l6 6-6 6" /></svg>
)
