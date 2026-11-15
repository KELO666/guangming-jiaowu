import React, { useMemo, useState } from 'react'
import { Sparkles, X, AlertCircle, Wand2, AlertTriangle } from 'lucide-react'
import { useApp } from '../store'
import { parseScheduleText } from '../lib/parser'
import { hoursBetween, hoursFmt, isoWeekday, addDays, WEEK_CN, todayStr, isCompetitionName } from '../lib/core'
import { expandParsedToSessions, sessionsOverlap } from '../lib/logic'
import { createScheduleLine } from '../lib/actions'
import { Badge, Button, Field, Input, Modal, Select, cn } from '../ui'

const SAMPLES = `每周四 17:20-19:20 vexIQ：王小明、Alina、Eason
每周六 9:00-11:00 vexgo：何远航、高晓菲、谢浩然、林志强
10.1~10.19 每周五、周六 18:00-20:00 vexiq 赛前集训：何远航、高晓菲`

// 文字排课：每行一个班课，解析后确认再创建
export default function TextScheduleModal({ open, onClose }) {
  const { db, create, createMany, toast, confirm } = useApp()
  const [text, setText] = useState('')

  const parsed = useMemo(
    () => parseScheduleText(text, { courses: db.courses, students: db.students, today: todayStr() }),
    [text, db.courses, db.students]
  )
  // 编辑覆盖层：直接改 parsed 太重，用浅拷贝 state
  const [parsedState, setParsed] = useState([])
  React.useEffect(() => {
    setParsed(parsed)
  }, [parsed]) // eslint-disable-line
  const okLines = parsedState.filter((p) => p.ok)
  const setP = (idx, patch) =>
    setParsed((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))

  // —— 冲突检测：新排的课与已排课次 / 本次各行之间，同一天时间段重叠 ——
  const conflictInfo = useMemo(() => {
    const existing = db.sessions
      .filter((s) => s.status !== 'cancelled')
      .map((s) => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        label: db.groups.find((g) => g.id === s.groupId)?.name || s.content || '课程',
      }))
    const details = []
    const batch = []
    for (const p of parsedState.filter((x) => x.ok)) {
      const rows = expandParsedToSessions(p, todayStr())
      for (const r of rows) {
        for (const e of existing) {
          if (sessionsOverlap(r, e)) {
            details.push(
              `${r.date.slice(5)} ${r.startTime || '全天'}「${p.name}」与已排《${e.label}》${e.date.slice(5)} ${e.startTime}-${e.endTime} 冲突`
            )
            break
          }
        }
      }
      for (const b of batch) {
        for (const r of rows) {
          for (const q of b) {
            if (sessionsOverlap(r, q)) {
              details.push(`${r.date.slice(5)} ${r.startTime || '全天'}「${p.name}」与本次输入的「${q.label}」冲突`)
              break
            }
          }
        }
      }
      batch.push(rows)
    }
    return { count: details.length, details: details.slice(0, 6), more: Math.max(0, details.length - 6) }
  }, [parsedState, db.sessions, db.groups])

  const countSessions = (p) => {
    if (p.type === 'single') return 1
    if (p.type === 'limited') {
      let n = 0
      for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1)) {
        if ((p.weekdays || []).includes(isoWeekday(d))) n++
      }
      return n
    }
    return null
  }

  const submit = async () => {
    if (!okLines.length) return toast('没有可创建的班课，请检查内容', 'error')
    if (conflictInfo.count > 0) {
      const ok = await confirm(
        '存在时间冲突',
        `${conflictInfo.details.join('\n')}${conflictInfo.more ? `\n…等共 ${conflictInfo.count} 处冲突` : ''}\n\n同一个老师同一时段上两节课，确定仍要这样排吗？`,
        true
      )
      if (!ok) return
    }
    try {
      let createdCourses = 0
      let createdGroups = 0
      let createdSessions = 0
      for (const p of parsedState) {
        if (!p.ok) continue
        const r = await createScheduleLine(p, { create, createMany })
        createdGroups++
        if (r.courseCreated) createdCourses++
        createdSessions += r.sessionsCreated
      }
      toast(`已创建 ${createdGroups} 个班课${createdCourses ? `、新课程 ${createdCourses} 门` : ''}${createdSessions ? `、${createdSessions} 节课` : ''}，课表已生成`)
      onClose()
    } catch (e) {
      toast(e.message || '创建失败', 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="文字排课" width="max-w-2xl">
      <div className="mb-2 flex items-center gap-2 text-[13px] text-slate-400">
        <Wand2 size={14} /> 每行一句话 = 一个班课。写清楚「频率 + 时间 + 课程 + 学生名单」就行
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        placeholder={SAMPLES}
        autoFocus
      />
      {!text.trim() && (
        <button
          onClick={() => setText(SAMPLES)}
          className="mt-2 text-[13px] text-blue-500 hover:underline"
        >
          插入示例看看效果
        </button>
      )}

      {parsedState.length > 0 && (
        <div className="mt-4 max-h-[46vh] space-y-3 overflow-y-auto pr-1">
          {parsedState.map((p, i) => (
            <LineCard key={i} idx={i} p={p} setP={setP} countSessions={countSessions} />
          ))}
        </div>
      )}

      {conflictInfo.count > 0 && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-red-600">
            <AlertTriangle size={15} /> 检测到 {conflictInfo.count} 处时间冲突（同一时段已排了课）
          </div>
          <div className="space-y-0.5 text-xs leading-relaxed text-red-500">
            {conflictInfo.details.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
            {conflictInfo.more > 0 && <div>…等共 {conflictInfo.count} 处</div>}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {okLines.length > 0 ? `将创建 ${okLines.length} 个班课` : '解析结果会显示在这里'}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={!okLines.length}
            variant={conflictInfo.count > 0 ? 'dangerSolid' : 'primary'}
          >
            {conflictInfo.count > 0 && <AlertTriangle size={15} />}
            <Sparkles size={16} /> 创建班课{conflictInfo.count > 0 ? `（${conflictInfo.count} 处冲突）` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const TYPE_BADGE = { recurring: ['blue', '长期循环'], limited: ['purple', '限时班课'], single: ['gray', '单次课'] }

export function LineCard({ idx, p, setP, countSessions }) {
  const { db } = useApp()
  const [tone, label] = TYPE_BADGE[p.type] || ['gray', '未知']
  const edit = (patch) => setP(idx, patch)
  const wdToggle = (n) =>
    edit({ weekdays: (p.weekdays || []).includes(n) ? p.weekdays.filter((x) => x !== n) : [...(p.weekdays || []), n].sort() })

  return (
    <div className={cn('rounded-2xl border p-3.5', p.ok ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/50')}>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
        {p.type !== 'single' && countSessions(p) != null && (
          <span className="text-xs text-slate-400">将生成 {countSessions(p)} 节课</span>
        )}
        <div className="ml-auto flex-1">
          <Input
            value={p.name}
            onChange={(e) => edit({ name: e.target.value })}
            className="h-8 max-w-[220px] border-dashed text-sm"
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Field label="开始">
          <Input type="time" value={p.startTime} onChange={(e) => edit({ startTime: e.target.value })} className="h-9" />
        </Field>
        <Field label="结束">
          <Input type="time" value={p.endTime} onChange={(e) => edit({ endTime: e.target.value })} className="h-9" />
        </Field>
        {p.type === 'single' ? (
          <Field label="日期">
            <Input type="date" value={p.date} onChange={(e) => edit({ date: e.target.value })} className="h-9" />
          </Field>
        ) : (
          <Field label="开始日">
            <Input type="date" value={p.startDate} onChange={(e) => edit({ startDate: e.target.value })} className="h-9" />
          </Field>
        )}
        <Field label="课程">
          <Select
            value={p.course?.id || (p.course?.__new ? '__new' : '')}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__new') edit({ course: { id: null, name: p.course?.name || '新课程', __new: true } })
              else {
                const c = db.courses.find((x) => x.id === v)
                edit({ course: c ? { id: c.id, name: c.name } : null })
              }
            }}
            className="h-9"
          >
            <option value="">未选择</option>
            {db.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {p.course?.__new && <option value="__new">新建：{p.course.name}</option>}
          </Select>
        </Field>
      </div>

      {p.type !== 'single' && (
        <div className="mt-2.5">
          <div className="mb-1 text-[13px] font-medium text-slate-500">上课星期</div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                onClick={() => wdToggle(n)}
                className={cn(
                  'h-8 flex-1 rounded-lg border text-xs font-medium transition',
                  (p.weekdays || []).includes(n)
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                )}
              >
                {WEEK_CN[n % 7]}
              </button>
            ))}
          </div>
        </div>
      )}
      {p.type === 'limited' && (
        <div className="mt-2.5">
          <Field label="结束日">
            <Input type="date" value={p.endDate} onChange={(e) => edit({ endDate: e.target.value })} className="h-9" />
          </Field>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Field label="消课池" className="w-40">
          <Select value={p.defaultPool} onChange={(e) => edit({ defaultPool: e.target.value })} className="h-9">
            <option value="formal">正式池</option>
            <option value="gift">赠送池（比赛）</option>
          </Select>
        </Field>
        {p.defaultPool === 'gift' && (
          <span className="text-[11px] text-emerald-600">
            {isCompetitionName(p.name) ? '🏆 识别为比赛课，已自动选赠送池' : '这批课将从赠送池扣（不计费）'}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.students.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {s.name}
            <button onClick={() => edit({ students: p.students.filter((x) => x.id !== s.id) })}>
              <X size={11} />
            </button>
          </span>
        ))}
        {p.unmatched.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            <AlertCircle size={11} /> 未匹配：{t}
            <button onClick={() => edit({ unmatched: p.unmatched.filter((_, j) => j !== i) })}>
              <X size={11} />
            </button>
          </span>
        ))}
        {!p.students.length && !p.unmatched.length && (
          <span className="text-xs text-slate-400">没识别到学生名单，可在创建后到班课里补</span>
        )}
      </div>

      {!p.ok && (
        <div className="mt-2 text-xs text-amber-600">
          {p.warnings.join('；')}（补全后自动计入创建）
        </div>
      )}
    </div>
  )
}
