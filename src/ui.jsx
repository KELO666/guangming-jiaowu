import React, { useEffect } from 'react'
import { X } from 'lucide-react'

export const cn = (...cls) => cls.filter(Boolean).join(' ')

// —— 按钮 ——
export function Button({ variant = 'primary', size = 'md', className, children, ...rest }) {
  const base =
    'inline-flex whitespace-nowrap shrink-0 items-center justify-center gap-1.5 rounded-xl font-medium transition-colors select-none disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]'
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20',
    soft: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
    dangerSolid: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  }
  const sizes = {
    xs: 'h-7 px-2.5 text-xs',
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-[15px]',
    lg: 'h-12 px-5 text-base',
  }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </button>
  )
}

// —— 表单 ——
const fieldCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-800 placeholder:text-slate-300 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition'

export function Input({ className, ...rest }) {
  return <input className={cn(fieldCls, 'h-10', className)} {...rest} />
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cn(fieldCls, 'py-2.5 leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cn(fieldCls, 'h-10 appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' fill=\'none\' stroke=\'%2394a3b8\' stroke-width=\'2\'%3E%3Cpath d=\'m4 6 4 4 4-4\'/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn('block', className)}>
      {label && <div className="mb-1.5 text-[13px] font-medium text-slate-500">{label}</div>}
      {children}
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </label>
  )
}

export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-blue-600' : 'bg-slate-200'
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
      {label && <span className="ml-2 text-sm">{label}</span>}
    </button>
  )
}

// —— 卡片 / 徽标 ——
export function Card({ className, children, onClick }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-slate-200/70 bg-white',
        onClick && 'cursor-pointer transition hover:border-blue-200 hover:shadow-md',
        className
      )}
    >
      {children}
    </div>
  )
}

const toneCls = {
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-700',
  gray: 'bg-slate-100 text-slate-500',
  purple: 'bg-purple-50 text-purple-700',
}
export function Badge({ tone = 'gray', className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', toneCls[tone], className)}>
      {children}
    </span>
  )
}

// —— 头像 ——
const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#6366f1']
export function Avatar({ name, size = 'md' }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  let hash = 0
  for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length]
  const sizes = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-lg' }
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold text-white', sizes[size])}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  )
}

// —— 弹窗 ——
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cn('fade-up max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl', width)}>
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X size={20} />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

// —— 空状态 / 加载 ——
export function Empty({ icon, text, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <div className="text-sm text-slate-400">{text}</div>
      {children}
    </div>
  )
}

export function Spinner({ className }) {
  return (
    <div className={cn('h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500', className)} />
  )
}

// —— 分段控件 ——
export function Segmented({ options, value, onChange, className }) {
  return (
    <div className={cn('inline-flex rounded-xl bg-slate-100 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
            value === o.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// —— 统计卡 ——
export function StatCard({ label, value, sub, tone = 'blue', onClick }) {
  const accents = {
    blue: 'text-blue-600',
    green: 'text-emerald-600',
    red: 'text-red-500',
    amber: 'text-amber-600',
  }
  return (
    <Card className={cn('p-4', onClick && 'cursor-pointer')} onClick={onClick}>
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', accents[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </Card>
  )
}

// —— 课时余额文字着色 ——
export function HoursText({ value, className }) {
  const v = Number(value) || 0
  return (
    <span className={cn('tabular-nums', v < 0 ? 'font-semibold text-red-500' : v <= 20 ? 'text-amber-600' : 'text-slate-700', className)}>
      {Math.round(v * 100) / 100}
    </span>
  )
}
