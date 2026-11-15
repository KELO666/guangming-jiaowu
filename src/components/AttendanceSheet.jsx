import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  Clock,
  MapPin,
  UserPlus,
  AlertTriangle,
  Undo2,
  ChevronRight,
  Plus,
} from 'lucide-react'
import { useApp } from '../store'
import { fmtDateFull, hhmm, hoursFmt, money, remaining, round2, unitPrice, STATUS_LABEL } from '../lib/core'
import { pickPackage } from '../lib/logic'
import { Avatar, Badge, Button, Card, Input, Modal, Spinner, cn } from '../ui'

// ============================================================
// 点名消课面板：默认全员到课，只标例外；临时加人；逐人换课包
// ============================================================
export default function AttendanceSheet({ session }) {
  const { db, rosterOf, saveAttendance, resetAttendance, create, toast, confirm, settings } = useApp()
  const nav = useNavigate()

  const group = db.groups.find((g) => g.id === session.groupId) || null
  const course = db.courses.find((c) => c.id === (session.courseId || group?.courseId))
  const savedRows = db.attendance.filter((a) => a.sessionId === session.id)
  const isCompleted = session.status === 'completed'
  const hasSaved = savedRows.some((a) => a.marked)

  // —— 初始化名单 ——
  const initEntries = () => {
    const roster = rosterOf(session.groupId).map((s) => s.id)
    const extra = savedRows.map((a) => a.studentId).filter((id) => !roster.includes(id))
    const ids = [...roster, ...extra]
    return ids.map((sid) => {
      const prev = savedRows.find((a) => a.studentId === sid)
      return {
        studentId: sid,
        status: prev?.status || 'present',
        packageIdOverride: null,
      }
    })
  }
  const [entries, setEntries] = useState(initEntries)
  const [hours, setHours] = useState(Number(session.hours) || 2)
  const [pkgModalFor, setPkgModalFor] = useState(null) // studentId
  const [addModal, setAddModal] = useState(false)
  const [saving, setSaving] = useState(false)

  const studentById = useMemo(() => new Map(db.students.map((s) => [s.id, s])), [db.students])

  const effSession = useMemo(() => ({ ...session, hours }), [session, hours])

  // 每个学生的消课预览
  const preview = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      if (e.status !== 'present' && e.status !== 'makeup') {
        map.set(e.studentId, { pkg: null, amount: 0 })
        continue
      }
      const pkg = pickPackage(db.packages, {
        studentId: e.studentId,
        courseId: session.courseId || group?.courseId,
        pool: session.pool || group?.defaultPool || 'formal',
        overrideId: e.packageIdOverride,
      })
      const amount = pkg ? (pkg.kind === 'gift' ? 0 : round2(unitPrice(pkg) * hours)) : 0
      map.set(e.studentId, { pkg, amount })
    }
    return map
  }, [entries, db.packages, session.courseId, group, hours])

  const noPkgIds = entries
    .filter((e) => (e.status === 'present' || e.status === 'makeup') && !preview.get(e.studentId)?.pkg)
    .map((e) => e.studentId)

  const summary = useMemo(() => {
    let present = 0
    let leave = 0
    let totalHours = 0
    let totalAmount = 0
    for (const e of entries) {
      if (e.status === 'present' || e.status === 'makeup') present += 1
      if (e.status === 'leave') leave += 1
      const p = preview.get(e.studentId)
      if (p?.pkg) {
        totalHours += hours
        totalAmount += p.amount
      }
    }
    return { present, leave, totalHours: round2(totalHours), totalAmount: round2(totalAmount) }
  }, [entries, preview, hours])

  const setStatus = (sid, patch) =>
    setEntries((es) => es.map((e) => (e.studentId === sid ? { ...e, ...patch } : e)))

  const addStudent = (sid) => {
    if (entries.some((e) => e.studentId === sid)) return
    setEntries((es) => [...es, { studentId: sid, status: 'present', packageIdOverride: null }])
  }

  const quickCreateStudent = async (name) => {
    const stu = await create('students', {
      name,
      enName: '',
      gender: '',
      birthDate: '',
      school: '',
      parentName: '',
      phone: '',
      wechat: '',
      notes: '临时课添加',
      status: 'active',
    })
    addStudent(stu.id)
    toast(`已创建学生「${name}」并加入本节课`)
  }

  const doSave = async () => {
    if (noPkgIds.length) {
      toast('有学生没有可用课包，请先处理', 'error')
      return
    }
    const ok = await confirm('保存点名', `将消课 ${hoursFmt(summary.totalHours)} 课时、扣费 ${money(summary.totalAmount)}，确认保存？`)
    if (!ok) return
    setSaving(true)
    try {
      const r = await saveAttendance({ ...session, hours }, entries)
      if (!r.ok) {
        toast('保存失败：有学生缺少课包', 'error')
        return
      }
      toast(`点名完成：消课 ${hoursFmt(summary.totalHours)} 课时`)
      nav(-1)
    } catch (e) {
      toast(e.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const doReset = async () => {
    const ok = await confirm('撤销点名', '将回冲已扣的课时和金额，本节课恢复为待点名。确定撤销？', true)
    if (!ok) return
    setSaving(true)
    try {
      await resetAttendance(session.id)
      toast('已撤销本次点名')
    } catch (e) {
      toast(e.message || '操作失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const pkgStudent = pkgModalFor ? studentById.get(pkgModalFor) : null
  const pkgEntry = pkgModalFor ? entries.find((e) => e.studentId === pkgModalFor) : null
  const pkgOptions = pkgModalFor ? db.packages.filter((p) => p.studentId === pkgModalFor) : []

  return (
    <div className="space-y-4">
      {/* 课程信息 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-bold">{group?.name || session.content || '临时课'}</h2>
          {course && (
            <span className="inline-flex items-center gap-1 text-sm text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ background: course.color }} />
              {course.name}
            </span>
          )}
          {isCompleted && <Badge tone="green">已点名 · 可修改</Badge>}
          {!isCompleted && hasSaved && <Badge tone="amber">已有课前登记</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock size={15} /> {fmtDateFull(session.date)} {hhmm(session.startTime)}-{hhmm(session.endTime)}
          </span>
          {session.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={15} /> {session.location}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-slate-500">本次课时长</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step="0.5"
              min="0.5"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 2)}
              className="h-9 w-20 text-center"
            />
            <span className="text-sm text-slate-500">小时</span>
          </div>
          <span className="text-xs text-slate-400">到课学生将按此时长消课</span>
        </div>
      </Card>

      {/* 名单 */}
      <Card className="divide-y divide-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm font-semibold text-slate-600">
            点名名单（{entries.length} 人）
          </div>
          <Button variant="soft" size="sm" onClick={() => setAddModal(true)}>
            <UserPlus size={15} /> 临时加人
          </Button>
        </div>

        {entries.map((e) => {
          const stu = studentById.get(e.studentId)
          if (!stu) return null
          const pv = preview.get(e.studentId)
          const checked = e.status === 'present' || e.status === 'makeup'
          return (
            <div key={e.studentId} className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => setStatus(e.studentId, { status: checked ? 'leave' : 'present' })}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                  checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 bg-white text-transparent hover:border-emerald-300'
                )}
                title={checked ? '点击改为请假' : '点击到课'}
              >
                <Check size={18} strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{stu.name}</span>
                  {stu.enName && <span className="text-xs text-slate-400">{stu.enName}</span>}
                  {noPkgIds.includes(e.studentId) && (
                    <Badge tone="red">
                      <AlertTriangle size={11} /> 无课包
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {!checked ? (
                    <span>不扣课时</span>
                  ) : pv?.pkg ? (
                    <button
                      className="inline-flex items-center gap-0.5 hover:text-blue-600"
                      onClick={() => setPkgModalFor(e.studentId)}
                    >
                      将扣 {pv.pkg.kind === 'gift' ? '赠送池' : '正式池'} · 剩{hoursFmt(remaining(pv.pkg))}
                      {pv.amount > 0 && ` · ${money(pv.amount)}`}
                      <ChevronRight size={12} />
                    </button>
                  ) : (
                    <button className="text-red-500 hover:underline" onClick={() => setPkgModalFor(e.studentId)}>
                      没有可用课包，点击选择
                    </button>
                  )}
                </div>
              </div>
              {!checked && (
                <div className="flex gap-1">
                  {['leave', 'absent', 'makeup'].map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatus(e.studentId, { status: st })}
                      className={cn(
                        'shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                        e.status === st
                          ? st === 'leave'
                            ? 'bg-amber-100 text-amber-700'
                            : st === 'absent'
                              ? 'bg-red-100 text-red-600'
                              : 'bg-blue-100 text-blue-700'
                          : 'text-slate-400 hover:bg-slate-100'
                      )}
                    >
                      {STATUS_LABEL[st]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {/* 保存栏 */}
      <Card className="sticky bottom-20 z-10 p-4 md:bottom-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-500">
            到课 <b className="text-slate-800">{summary.present}</b> · 请假{' '}
            <b className="text-slate-800">{summary.leave}</b> · 消课{' '}
            <b className="text-blue-600">{hoursFmt(summary.totalHours)}</b> 课时 · 扣费{' '}
            <b className="text-blue-600">{money(summary.totalAmount)}</b>
          </div>
          <div className="flex gap-2">
            {hasSaved && (
              <Button variant="outline" onClick={doReset} disabled={saving}>
                <Undo2 size={16} /> {saving ? '处理中…' : isCompleted ? '撤销点名' : '撤销登记'}
              </Button>
            )}
            <Button size="lg" onClick={doSave} disabled={noPkgIds.length > 0 || saving}>
              {saving ? <Spinner className="border-white/40 border-t-white" /> : <Check size={18} />}
              {saving ? '保存中…' : '保存点名并消课'}
            </Button>
          </div>
        </div>
      </Card>

      {/* 换课包弹窗 */}
      <Modal open={!!pkgModalFor} onClose={() => setPkgModalFor(null)} title={`选择扣哪个课包 · ${pkgStudent?.name || ''}`}>
        <div className="space-y-2">
          <button
            onClick={() => {
              setStatus(pkgModalFor, { packageIdOverride: null })
              setPkgModalFor(null)
            }}
            className={cn(
              'w-full rounded-xl border p-3 text-left transition',
              !pkgEntry?.packageIdOverride ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
            )}
          >
            <div className="font-medium">默认（跟随班课设置）</div>
            <div className="mt-0.5 text-xs text-slate-400">
              本班课默认从{group?.defaultPool === 'gift' ? '赠送池' : '正式池'}扣，课时不足时可扣为负数
            </div>
          </button>
          {pkgOptions.length === 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
              该学生名下没有任何课包。可到「学生管理」给他建档课包后再来点名。
            </div>
          )}
          {pkgOptions.map((p) => {
            const c = db.courses.find((x) => x.id === p.courseId)
            return (
              <button
                key={p.id}
                onClick={() => {
                  setStatus(pkgModalFor, { packageIdOverride: p.id })
                  setPkgModalFor(null)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border p-3 text-left transition',
                  pkgEntry?.packageIdOverride === p.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <div>
                  <div className="font-medium">
                    {c?.name} · {p.kind === 'gift' ? '赠送池' : '正式池'}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    共 {hoursFmt(p.totalHours)} 课时 · 剩 {hoursFmt(remaining(p))}
                    {p.kind === 'formal' && p.price > 0 && ` · ${money(unitPrice(p))}/课时`}
                  </div>
                </div>
                {remaining(p) < 0 && <Badge tone="red">已超扣</Badge>}
              </button>
            )
          })}
        </div>
      </Modal>

      {/* 临时加人弹窗 */}
      <AddStudentModal
        open={addModal}
        onClose={() => setAddModal(false)}
        excludeIds={entries.map((e) => e.studentId)}
        onPick={(id) => {
          addStudent(id)
          setAddModal(false)
        }}
        onCreate={async (name) => {
          await quickCreateStudent(name)
          setAddModal(false)
        }}
      />
    </div>
  )
}

// —— 临时加人：搜索已有 / 现场新建 ——
function AddStudentModal({ open, onClose, excludeIds, onPick, onCreate }) {
  const { db } = useApp()
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState('')
  const list = db.students
    .filter((s) => s.status !== 'archived' && !excludeIds.includes(s.id))
    .filter((s) => !q || s.name.includes(q) || (s.enName || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal open={open} onClose={onClose} title="临时加人">
      <Input autoFocus placeholder="搜索学生姓名 / 英文名" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-slate-50"
          >
            <Avatar name={s.name} size="sm" />
            <span className="font-medium">{s.name}</span>
            {s.enName && <span className="text-xs text-slate-400">{s.enName}</span>}
            <Plus size={16} className="ml-auto text-slate-300" />
          </button>
        ))}
        {!list.length && <div className="py-6 text-center text-sm text-slate-400">没有匹配的学生</div>}
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        <div className="mb-2 text-[13px] font-medium text-slate-500">学生还没建档？直接输入姓名创建：</div>
        <div className="flex gap-2">
          <Input
            placeholder="学生姓名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) onCreate(newName.trim())
            }}
          />
          <Button onClick={() => newName.trim() && onCreate(newName.trim())} disabled={!newName.trim()}>
            创建并加入
          </Button>
        </div>
      </div>
    </Modal>
  )
}
