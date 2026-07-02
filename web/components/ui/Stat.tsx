import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}

const valueTone: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-white',
  success: 'text-fuchsia-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueTone[tone]}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export default Stat
