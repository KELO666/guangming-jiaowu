import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Wand2,
  Upload,
  Pencil,
  Trash2,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  XCircle,
  Ban,
  ClipboardCheck,
  AlertTriangle,
} from 'lucide-react'
import { useApp } from '../store'
import {
  addDays,
  weekStart,
  fmtDate,
  fmtDateFull,
  hhmm,
  hoursFmt,
  hoursBetween,
  WEEK_CN,
  STATUS_LABEL,
  GROUP_TYPE_LABEL,
  todayStr,
  money,
  remaining,
} from '../lib/core'
import { sortSessions, findSessionConflicts, sessionsOverlap } from '../lib/logic'
import { Avatar, Badge, Button, Card, Empty, Field, Input, Modal, Segmented, Select, Switch, cn } from '../ui'
import Layout from '../components/Layout'
import TextScheduleModal from '../components/TextScheduleModal'
import ImportWizard from '../components/ImportWizard'
import GroupFormModal from '../components/GroupFormModal'

export default function Schedule() {
  const { db, rosterOf } = useApp()
  const nav = useNavigate()
  const [tab, setTab] = useState('week')
  const [weekAnchor, setWeekAnchor] = useState(weekStart(todayStr()))
  const [monthAnchor, setMonthAnchor] = useState(todayStr().slice(0, 7))
  const [textOpen, setTextOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [groupForm, setGroupForm] = useState({ open: false, initial: null })
  const [sessionModal, setSessionModal] = useState(null) // session id

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)), [weekAnchor])
  const byDate = useMemo(() => {
    const map = new Map()
    for (const s of db.sessions) {
      if (!map.has(s.date)) map.set(s.date, [])
      map.get(s.date).push(s)
    }
    for (const list of map.values()) list.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    return map
  }, [db.sessions])

  const thisWeekCount = days.reduce((a, d) => a + (byDate.get(d)?.filter((s) => s.status !== 'cancelled').length || 0), 0)
  const today = todayStr()

  // 冲突课次（同一老师、同一时间段被排了两节课）
  const conflictIds = useMemo(() => {
    const pairs = findSessionConflicts(db.sessions)
    const set = new Set()
    for (const [a, b] of pairs) {
      set.add(a.id)
      set.add(b.id)
    }
    return set
  }, [db.sessions])

  const monthCount = useMemo(
    () => db.sessions.filter((s) => s.date.startsWith(monthAnchor) && s.status !== 'cancelled').length,
    [db.sessions, monthAnchor]
  )

  return (
    <Layout title="课表">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">课表排课</h1>
        <Button variant="soft" onClick={() => setTextOpen(true)}>
          <Wand2 size={16} /> 文字排课
        </Button>
        <Button variant="soft" onClick={() => setImportOpen(true)}>
          <Upload size={16} /> 导入表格
        </Button>
        <Button onClick={() => setGroupForm({ open: true, initial: null })}>
          <Plus size={16} /> 新建班课
        </Button>
      </div>

      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'week', label: '周课表' },
          { value: 'month', label: '月课表' },
          { value: 'groups', label: '班课管理' },
        ]}
      />

      {tab === 'week' && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekAnchor(weekStart(todayStr()))}>
              本周
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>
              <ChevronRight size={16} />
            </Button>
            <span className="ml-2 text-sm text-slate-500">
              {fmtDate(days[0])} ~ {fmtDate(days[6])} · {thisWeekCount} 节
            </span>
            {conflictIds.size > 0 && (
              <Badge tone="red" className="ml-1">
                <AlertTriangle size={11} /> {conflictIds.size} 节时间冲突
              </Badge>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-7">
            {days.map((d) => {
              const list = byDate.get(d) || []
              const isToday = d === today
              return (
                <div key={d} className={cn('rounded-2xl border p-2', isToday ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200/70 bg-white')}>
                  <div className={cn('mb-2 px-1 text-[13px] font-semibold', isToday ? 'text-blue-600' : 'text-slate-500')}>
                    {fmtDate(d)}
                    {isToday && <span className="ml-1 text-[10px] font-normal text-blue-400">今天</span>}
                  </div>
                  <div className="space-y-2">
                    {list.length === 0 && <div className="py-4 text-center text-xs text-slate-300">—</div>}
                    {list.map((s) => (
                      <WeekCard key={s.id} s={s} conflict={conflictIds.has(s.id)} onClick={() => setSessionModal(s.id)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'month' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonthAnchor(dayjs(monthAnchor + '-01').add(-1, 'month').format('YYYY-MM'))}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMonthAnchor(todayStr().slice(0, 7))}>
              本月
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMonthAnchor(dayjs(monthAnchor + '-01').add(1, 'month').format('YYYY-MM'))}>
              <ChevronRight size={16} />
            </Button>
            <span className="ml-2 text-sm text-slate-500">
              {monthAnchor.slice(0, 4)} 年 {Number(monthAnchor.slice(5, 7))} 月 · {monthCount} 节
            </span>
            <span className="ml-auto text-[11px] text-slate-400">
              <span className="mr-2 inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-blue-400 bg-blue-50" />今天</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-blue-100 bg-blue-50/40" />本周所在行</span>
            </span>
          </div>
          <MonthGrid monthAnchor={monthAnchor} byDate={byDate} conflictIds={conflictIds} onOpen={(id) => setSessionModal(id)} />
        </>
      )}

      {tab === 'groups' && <GroupList onEdit={(g) => setGroupForm({ open: true, initial: g })} />}

      <TextScheduleModal open={textOpen} onClose={() => setTextOpen(false)} />
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
      <GroupFormModal open={groupForm.open} initial={groupForm.initial} onClose={() => setGroupForm({ open: false, initial: null })} />
      {sessionModal && <SessionModal id={sessionModal} onClose={() => setSessionModal(null)} />}
    </Layout>
  )
}

function WeekCard({ s, conflict, onClick }) {
  const { db } = useApp()
  const g = db.groups.find((x) => x.id === s.groupId)
  const course = db.courses.find((c) => c.id === (s.courseId || g?.courseId))
  const marked = s.status === 'completed'
  const past = s.date < todayStr()
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border bg-white p-2.5 text-left shadow-sm transition hover:border-blue-200 hover:shadow',
        conflict ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-100'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-bold tabular-nums text-slate-700">{hhmm(s.startTime)}</span>
        {conflict && <AlertTriangle size={12} className="text-red-500" />}
        <span
          className={cn(
            'ml-auto h-2 w-2 rounded-full',
            s.status === 'cancelled' ? 'bg-slate-300' : marked ? 'bg-emerald-500' : past ? 'bg-red-400' : 'bg-blue-400'
          )}
        />
      </div>
      <div className={cn('mt-1 truncate text-[13px] font-medium', s.status === 'cancelled' && 'text-slate-300 line-through')}>
        {g?.name || s.content || '临时课'}
      </div>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="truncate text-[11px] text-slate-400">{course?.name}</span>
        {s.pool === 'gift' && <span className="text-[10px] text-emerald-600">赠</span>}
      </div>
    </button>
  )
}

// ============================================================
// 月课表：当天强高亮，今天所在整周淡色高亮
// ============================================================
function MonthGrid({ monthAnchor, byDate, conflictIds, onOpen }) {
  const today = todayStr()
  const first = dayjs(monthAnchor + '-01')
  const daysInMonth = first.daysInMonth()
  const lead = (first.day() + 6) % 7 // 周一开头
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(first.date(d).format('YYYY-MM-DD'))
  while (cells.length % 7 !== 0) cells.push(null)
  const rows = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const todayRow = rows.findIndex((row) => row.includes(today))

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[680px]">
        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
            <div key={w} className="px-1 text-[11px] font-semibold text-slate-400">
              周{w}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {rows.map((row, ri) => (
            <div key={ri} className="grid grid-cols-7 gap-1.5">
              {row.map((d, ci) => {
                const all = d ? byDate.get(d) || [] : []
                const list = all.filter((s) => s.status !== 'cancelled')
                const isToday = d === today
                const inThisWeek = ri === todayRow && !!d
                return (
                  <div
                    key={ci}
                    className={cn(
                      'min-h-[78px] rounded-xl border p-1',
                      !d && 'border-transparent bg-slate-50/40',
                      d && !isToday && inThisWeek && 'border-blue-100 bg-blue-50/40',
                      isToday && 'border-blue-400 bg-blue-50 ring-1 ring-blue-200',
                      d && !isToday && !inThisWeek && 'border-slate-200/70 bg-white'
                    )}
                  >
                    {d && (
                      <>
                        <div className={cn('mb-1 px-0.5 text-[11px] font-semibold', isToday ? 'text-blue-600' : 'text-slate-400')}>
                          {Number(d.slice(8))}
                          {isToday && <span className="ml-0.5 text-[10px]">今天</span>}
                        </div>
                        <div className="space-y-0.5">
                          {list.slice(0, 3).map((s) => (
                            <MiniCard key={s.id} s={s} conflict={conflictIds.has(s.id)} onClick={() => onOpen(s.id)} />
                          ))}
                          {list.length > 3 && <div className="px-0.5 text-[9px] text-slate-400">+{list.length - 3} 节…</div>}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MiniCard({ s, conflict, onClick }) {
  const { db } = useApp()
  const g = db.groups.find((x) => x.id === s.groupId)
  const marked = s.status === 'completed'
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full truncate rounded-md px-1 py-0.5 text-left text-[10px] leading-4 transition',
        s.status === 'cancelled'
          ? 'bg-slate-100 text-slate-300 line-through'
          : marked
            ? 'bg-emerald-100 text-emerald-700'
            : conflict
              ? 'bg-red-100 text-red-600 ring-1 ring-red-300'
              : 'bg-slate-100 text-slate-600 hover:bg-blue-100'
      )}
      title={`${hhmm(s.startTime)} ${g?.name || s.content || '课'}`}
    >
      {String(s.startTime).slice(0, 5)} {g?.name || s.content || '课'}
    </button>
  )
}

// ============================================================
// 班课管理
// ============================================================
function GroupList({ onEdit }) {
  const { db, update, deleteGroup, confirm, toast } = useApp()
  const groups = [...db.groups].sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name, 'zh') : a.active ? -1 : 1))

  const desc = (g) => {
    const wd = (g.weekdays || []).map((n) => '周' + WEEK_CN[n % 7]).join('、')
    const time = `${hhmm(g.startTime)}-${hhmm(g.endTime)}`
    if (g.type === 'recurring') return `每周${wd.replace('周', '')} ${time}`
    if (g.type === 'limited') return `${g.startDate?.slice(5)} ~ ${g.endDate?.slice(5)} ${wd} ${time}`
    return `${g.startDate} ${time}`
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((g) => {
        const course = db.courses.find((c) => c.id === g.courseId)
        const count = db.groupStudents.filter((r) => r.groupId === g.id).length
        return (
          <Card key={g.id} className={cn('p-4', !g.active && 'opacity-60')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: course?.color }} />
                  <span className="font-semibold">{g.name}</span>
                  <Badge tone={g.type === 'recurring' ? 'blue' : g.type === 'limited' ? 'purple' : 'gray'}>
                    {GROUP_TYPE_LABEL[g.type]}
                  </Badge>
                  {g.defaultPool === 'gift' && <Badge tone="green">扣赠送池</Badge>}
                  {!g.active && <Badge tone="gray">已停用</Badge>}
                </div>
                <div className="mt-1.5 text-sm text-slate-500">{desc(g)}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-400">
                  <span>{hoursFmt(g.hours)} 小时/节</span>
                  <span>{count} 名学生</span>
                  {g.location && <span>{g.location}</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Switch checked={g.active} onChange={(v) => update('groups', g.id, { active: v })} />
                <div className="flex gap-1">
                  <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" onClick={() => onEdit(g)}>
                    <Pencil size={15} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                    onClick={async () => {
                      const ok = await confirm('删除班课', `删除「${g.name}」？未点名的课次将删除，已点名的历史记录保留。`, true)
                      if (!ok) return
                      await deleteGroup(g.id)
                      toast('班课已删除')
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          </Card>
        )
      })}
      {groups.length === 0 && (
        <Card className="md:col-span-2">
          <Empty text="还没有班课，用「文字排课」一句话就能建好" />
        </Card>
      )}
    </div>
  )
}

// ============================================================
// 课次详情 / 编辑
// ============================================================
function SessionModal({ id, onClose }) {
  const { db, update, remove, confirm, toast, rosterOf } = useApp()
  const nav = useNavigate()
  const s = db.sessions.find((x) => x.id === id)
  if (!s) return null
  const g = db.groups.find((x) => x.id === s.groupId)
  const course = db.courses.find((c) => c.id === (s.courseId || g?.courseId))
  const roster = rosterOf(s.groupId)
  const attRows = db.attendance.filter((a) => a.sessionId === s.id)
  const isCompleted = s.status === 'completed'
  const hasSaved = attRows.some((a) => a.marked)
  // 与其他课次的时间冲突
  const conflictWith = db.sessions.filter(
    (o) => o.id !== s.id && o.status !== 'cancelled' && sessionsOverlap(s, o)
  )

  const [form, setForm] = useState({
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    hours: s.hours,
    content: s.content || '',
    location: s.location || '',
    pool: s.pool || g?.defaultPool || 'formal',
  })

  const saveEdit = async () => {
    try {
      if (conflictWith.length > 0) {
        const ok = await confirm(
          '存在时间冲突',
          `调整后的时间与${conflictWith
            .map((o) => {
              const og = db.groups.find((x) => x.id === o.groupId)
              return `《${og?.name || o.content || '课程'}》${o.date.slice(5)} ${hhmm(o.startTime)}-${hhmm(o.endTime)}`
            })
            .join('、')}重叠。确定仍要这样排吗？`,
          true
        )
        if (!ok) return
      }
      await update('sessions', s.id, { ...form, hours: Number(form.hours) || hoursBetween(form.startTime, form.endTime) || 2 })
      toast('课次已更新')
    } catch (e) {
      toast(e.message || '更新失败', 'error')
    }
  }

  const del = async () => {
    if (hasSaved) return toast('已有点名/登记记录的课次不能删除，可先撤销记录', 'error')
    const ok = await confirm('删除课次', '确定删除这节课？', true)
    if (!ok) return
    await remove('sessions', s.id)
    onClose()
  }

  const cancel = async () => {
    const ok = await confirm(s.status === 'cancelled' ? '恢复课次' : '取消课次', s.status === 'cancelled' ? '恢复到课表' : '取消后这节课不再计入课表（可恢复）')
    if (!ok) return
    await update('sessions', s.id, { status: s.status === 'cancelled' ? 'scheduled' : 'cancelled' })
  }

  const stuById = new Map(db.students.map((x) => [x.id, x]))

  return (
    <Modal open onClose={onClose} title="课次详情" width="max-w-lg">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">{g?.name || form.content || '临时课'}</span>
        {course && (
          <Badge tone="blue">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: course.color }} /> {course.name}
          </Badge>
        )}
        {s.status === 'cancelled' && <Badge tone="gray">已取消</Badge>}
        {isCompleted && <Badge tone="green">已点名</Badge>}
        {!isCompleted && hasSaved && <Badge tone="amber">已有课前登记</Badge>}
      </div>

      {conflictWith.length > 0 && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-[13px] leading-relaxed text-red-600">
          <AlertTriangle size={13} className="mr-1 inline" />
          时间冲突：与
          {conflictWith.map((o) => {
            const og = db.groups.find((x) => x.id === o.groupId)
            return `《${og?.name || o.content || '课程'}》${o.date.slice(5).replace('-', '.')} ${hhmm(o.startTime)}-${hhmm(o.endTime)}`
          }).join('、')}
          同一时段，注意安排
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="日期">
          <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </Field>
        <Field label="消课池">
          <Select value={form.pool} onChange={(e) => setForm((f) => ({ ...f, pool: e.target.value }))}>
            <option value="formal">正式池</option>
            <option value="gift">赠送池（比赛/集训）</option>
          </Select>
        </Field>
        <Field label="开始时间">
          <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
        </Field>
        <Field label="结束时间">
          <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
        </Field>
        <Field label="课时（小时）">
          <Input type="number" step="0.5" min="0.5" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} />
        </Field>
        <Field label="地点">
          <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
        </Field>
        <Field label="课程内容" className="col-span-2">
          <Input value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="如：模拟比赛" />
        </Field>
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3">
        <div className="mb-2 text-[13px] font-medium text-slate-500">
          学生名单（{isCompleted ? '已点名' : hasSaved ? '含课前登记' : `${roster.length} 人`}）
        </div>
        <div className="flex flex-wrap gap-1.5">
          {roster.map((stu) => {
            const r = attRows.find((a) => a.studentId === stu.id && a.marked)
            return (
              <span
                key={stu.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ring-1',
                  r ? (r.status === 'present' || r.status === 'makeup' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200') : 'bg-white text-slate-600 ring-slate-200'
                )}
              >
                <Avatar name={stu.name} size="sm" /> {stu.name}
                {r && ` · ${STATUS_LABEL[r.status]}${r.hours > 0 ? ` -${hoursFmt(r.hours)}课时` : ''}`}
              </span>
            )
          })}
          {attRows
            .filter((a) => a.marked && !roster.some((stu) => stu.id === a.studentId))
            .map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                <Avatar name={stuById.get(a.studentId)?.name || '?'} size="sm" />
                {stuById.get(a.studentId)?.name || '未知'} · {STATUS_LABEL[a.status]}
              </span>
            ))}
          {!roster.length && !attRows.length && <span className="text-xs text-slate-400">班课未设置名单</span>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {!s.status || s.status !== 'cancelled' ? (
          <Button size="lg" className="flex-1" onClick={() => nav(`/session/${s.id}`)}>
            <ClipboardCheck size={18} /> {isCompleted ? '重新点名' : hasSaved ? '继续点名' : '去点名'}
          </Button>
        ) : (
          <Button size="lg" variant="soft" className="flex-1" onClick={cancel}>
            恢复课次
          </Button>
        )}
      </div>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-3">
        <Button variant="ghost" size="sm" onClick={del}>
          <Trash2 size={14} /> 删除
        </Button>
        <div className="flex gap-2">
          {s.status !== 'cancelled' && (
            <Button variant="ghost" size="sm" onClick={cancel}>
              <Ban size={14} /> 取消课次
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={saveEdit}>
            保存修改
          </Button>
        </div>
      </div>
    </Modal>
  )
}
