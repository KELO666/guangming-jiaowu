import React, { useMemo, useState } from 'react'
import { Search, Check } from 'lucide-react'
import { useApp } from '../store'
import { Avatar, Input, cn } from '../ui'

// 学生多选器：搜索 + 勾选，已选置顶
export default function RosterPicker({ value, onChange, placeholder = '搜索学生' }) {
  const { db } = useApp()
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map(db.students.map((s) => [s.id, s])), [db.students])

  const selected = (value || []).map((id) => byId.get(id)).filter(Boolean)
  const candidates = db.students
    .filter((s) => s.status !== 'archived' && !(value || []).includes(s.id))
    .filter((s) => !q.trim() || s.name.includes(q.trim()) || (s.enName || '').toLowerCase().includes(q.trim().toLowerCase()))

  const toggle = (id) => {
    if ((value || []).includes(id)) onChange((value || []).filter((x) => x !== id))
    else onChange([...(value || []), id])
  }

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 p-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 pl-8 text-sm" />
        </div>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-2.5">
          {selected.map((s) => (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-1 pr-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              <Avatar name={s.name} size="sm" />
              {s.name} ✕
            </button>
          ))}
        </div>
      )}
      <div className="max-h-52 overflow-y-auto p-1.5">
        {candidates.map((s) => (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-slate-50"
          >
            <Avatar name={s.name} size="sm" />
            <span className="text-sm font-medium">{s.name}</span>
            {s.enName && <span className="text-xs text-slate-400">{s.enName}</span>}
            <span
              className={cn(
                'ml-auto flex h-5 w-5 items-center justify-center rounded-full border-2',
                'border-slate-200 text-transparent'
              )}
            >
              <Check size={12} strokeWidth={3} />
            </span>
          </button>
        ))}
        {!candidates.length && !selected.length && (
          <div className="py-6 text-center text-sm text-slate-400">没有学生，先到「学生管理」建档</div>
        )}
      </div>
    </div>
  )
}
