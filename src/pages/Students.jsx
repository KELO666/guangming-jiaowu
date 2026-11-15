import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Plus,
  Search,
  Phone,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  BookOpen,
  ClipboardList,
  Wallet,
} from 'lucide-react'
import { useApp } from '../store'
import { fmtDate, fmtDateFull, hoursFmt, money, remaining, round2, unitPrice, hhmm, STATUS_LABEL } from '../lib/core'
import { Avatar, Badge, Button, Card, Empty, Field, Input, Modal, Select, Textarea, cn, HoursText } from '../ui'
import Layout from '../components/Layout'

const STATUS_OPTS = [
  { v: 'active', t: '在读' },
  { v: 'paused', t: '停课' },
  { v: 'archived', t: '结课' },
]
const statusLabel = (v) => STATUS_OPTS.find((s) => s.v === v)?.t || '在读'

// ============================================================
// 学生列表
// ============================================================
export default function Students() {
  const { db } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const list = useMemo(
    () =>
      db.students
        .filter((s) => (status === 'all' ? true : s.status === status))
        .filter((s) => {
          if (!q.trim()) return true
          const t = q.trim().toLowerCase()
          return s.name.includes(t) || (s.enName || '').toLowerCase().includes(t) || (s.phone || '').includes(t)
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    [db.students, q, status]
  )

  // 每个学生的课程余额 chips
  const chipsOf = (studentId) => {
    const byCourse = new Map()
    for (const p of db.packages.filter((p) => p.studentId === studentId)) {
      if (!byCourse.has(p.courseId)) byCourse.set(p.courseId, { formal: 0, gift: 0 })
      const cell = byCourse.get(p.courseId)
      cell[p.kind] = round2((cell[p.kind] || 0) + remaining(p))
    }
    return [...byCourse.entries()].map(([courseId, v]) => ({
      course: db.courses.find((c) => c.id === courseId),
      ...v,
    }))
  }

  return (
    <Layout title="学生">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <Input placeholder="搜索姓名 / 英文名 / 电话" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-24">
          {STATUS_OPTS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.t}
            </option>
          ))}
          <option value="all">全部</option>
        </Select>
        <Button
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus size={17} /> 新增
        </Button>
      </div>

      {list.length === 0 ? (
        <Card>
          <Empty text="还没有学生，点右上角「新增」建档" />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {list.map((s) => (
            <div
              key={s.id}
              className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50"
              onClick={() => nav(`/students/${s.id}`)}
            >
              <Avatar name={s.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{s.name}</span>
                  {s.enName && <span className="text-xs text-slate-400">{s.enName}</span>}
                  {s.status !== 'active' && <Badge tone="gray">{statusLabel(s.status)}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {chipsOf(s.id).map((c, i) => (
                    <span
                      key={i}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]',
                        c.formal + c.gift < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.course?.color || '#94a3b8' }} />
                      {c.course?.name}
                      <HoursText value={c.formal} />
                      {c.gift > 0 && <span className="text-emerald-600">+{hoursFmt(c.gift)}赠</span>}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-slate-300" />
            </div>
          ))}
        </Card>
      )}

      <StudentForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={editing}
      />
    </Layout>
  )
}

// ============================================================
// 学生详情
// ============================================================
export function StudentDetail() {
  const { id } = useParams()
  const { db, remove, update, confirm, toast, settings } = useApp()
  const nav = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [pkgOpen, setPkgOpen] = useState(false)
  const [editPkg, setEditPkg] = useState(null) // 课包编辑对象
  const threshold = Number(settings.renewalThreshold) || 20

  const stu = db.students.find((s) => s.id === id)
  if (!stu)
    return (
      <Layout title="学生">
        <Card>
          <Empty text="学生不存在" />
          <div className="flex justify-center pb-6">
            <Button variant="soft" onClick={() => nav('/students')}>
              返回列表
            </Button>
          </div>
        </Card>
      </Layout>
    )

  const pkgs = db.packages.filter((p) => p.studentId === stu.id)
  // 按缴费(bundeId)分组展示
  const bundles = []
  const seen = new Set()
  for (const p of pkgs.sort((a, b) => (a.purchasedAt < b.purchasedAt ? 1 : -1))) {
    if (seen.has(p.bundleId)) continue
    seen.add(p.bundleId)
    bundles.push({
      bundleId: p.bundleId,
      courseId: p.courseId,
      purchasedAt: p.purchasedAt,
      note: p.note,
      formal: pkgs.find((x) => x.bundleId === p.bundleId && x.kind === 'formal'),
      gift: pkgs.find((x) => x.bundleId === p.bundleId && x.kind === 'gift'),
    })
  }

  const history = useMemo(() => {
    const sessById = new Map(db.sessions.map((s) => [s.id, s]))
    return db.attendance
      .filter((a) => a.studentId === stu.id && a.marked)
      .map((a) => ({ ...a, sess: sessById.get(a.sessionId) }))
      .filter((a) => a.sess)
      .sort((a, b) => b.sess.date.localeCompare(a.sess.date) || String(b.sess.startTime).localeCompare(String(a.sess.startTime)))
  }, [db, stu.id])

  const totalSpent = pkgs.filter((p) => p.kind === 'formal').reduce((a, p) => a + (Number(p.price) || 0), 0)

  const delStudent = async () => {
    const ok = await confirm('删除学生', `确定删除「${stu.name}」？其上课记录将一并删除，此操作不可恢复。`, true)
    if (!ok) return
    await remove('students', stu.id)
    toast('已删除')
    nav('/students')
  }

  return (
    <Layout title={stu.name}>
      <button onClick={() => nav('/students')} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
        <ChevronLeft size={16} /> 学生列表
      </button>

      {/* 基本信息 */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <Avatar name={stu.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{stu.name}</h2>
              {stu.enName && <span className="text-slate-400">{stu.enName}</span>}
              <Badge tone={stu.status === 'active' ? 'green' : 'gray'}>{statusLabel(stu.status)}</Badge>
            </div>
            <div className="mt-2 space-y-1 text-sm text-slate-500">
              {stu.parentName && <div>家长：{stu.parentName}</div>}
              {stu.phone && (
                <div className="flex items-center gap-1">
                  <Phone size={13} /> {stu.phone}
                </div>
              )}
              {stu.school && <div>学校：{stu.school}</div>}
              {stu.notes && <div className="text-slate-400">备注：{stu.notes}</div>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil size={14} /> 编辑
            </Button>
            <Button variant="danger" size="sm" onClick={delStudent}>
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Wallet size={15} /> 累计缴费 <b className="text-slate-700">{money(totalSpent)}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            <ClipboardList size={15} /> 上课 <b className="text-slate-700">{history.filter((h) => h.status !== 'leave').length}</b> 次
          </span>
        </div>
      </Card>

      {/* 课包 */}
      <div className="mt-6 mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">课包（{bundles.length}）</h3>
        <Button variant="soft" size="sm" onClick={() => setPkgOpen(true)}>
          <Plus size={15} /> 新增课包 / 缴费
        </Button>
      </div>
      {bundles.length === 0 ? (
        <Card>
          <Empty text="还没有课包，点击「新增课包」录入缴费" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {bundles.map((b) => {
            const course = db.courses.find((c) => c.id === b.courseId)
            const fRem = b.formal ? remaining(b.formal) : null
            const gRem = b.gift ? remaining(b.gift) : null
            const low = (fRem ?? 0) + (gRem ?? 0) <= threshold
            return (
              <Card key={b.bundleId} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: course?.color }} />
                    {course?.name} 课包
                    <span className="text-xs font-normal text-slate-400">{fmtDate(b.purchasedAt)} 购</span>
                  </div>
                  <button
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-50 hover:text-slate-500"
                    onClick={() => setEditPkg(b)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {b.formal && (
                    <div className={cn('rounded-xl p-3', fRem < 0 ? 'bg-red-50' : 'bg-slate-50')}>
                      <div className="text-xs text-slate-400">正式池</div>
                      <div className="mt-0.5 text-xl font-bold tabular-nums">
                        <HoursText value={fRem} />
                        <span className="ml-1 text-xs font-normal text-slate-400">/ {hoursFmt(b.formal.totalHours)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {money(b.formal.price)} · {money(unitPrice(b.formal))}/课时
                      </div>
                    </div>
                  )}
                  {b.gift && (
                    <div className="rounded-xl bg-emerald-50/60 p-3">
                      <div className="text-xs text-emerald-600/70">赠送池（比赛课时）</div>
                      <div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-700">
                        {hoursFmt(gRem)}
                        <span className="ml-1 text-xs font-normal text-emerald-600/60">/ {hoursFmt(b.gift.totalHours)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-600/50">消课不计费</div>
                    </div>
                  )}
                </div>
                {low && (
                  <div className="mt-2 text-xs text-amber-600">⚠ 剩余课时不足，建议跟进续费</div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* 上课记录 */}
      <div className="mt-6 mb-3">
        <h3 className="font-semibold text-slate-700">上课记录</h3>
      </div>
      <Card className="divide-y divide-slate-100 overflow-hidden">
        {history.length === 0 ? (
          <Empty text="暂无上课记录" />
        ) : (
          history.slice(0, 30).map((h) => {
            const course = db.courses.find((c) => c.id === h.sess.courseId)
            const group = db.groups.find((g) => g.id === h.sess.groupId)
            const kind = h.packageId ? db.packages.find((p) => p.id === h.packageId)?.kind : null
            return (
              <div key={h.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="w-24 shrink-0 text-slate-500">{fmtDate(h.sess.date)}</div>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{group?.name || h.sess.content || course?.name || '课程'}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {hhmm(h.sess.startTime)}-{hhmm(h.sess.endTime)}
                  </span>
                </div>
                {kind && (
                  <Badge tone={kind === 'gift' ? 'green' : 'blue'}>{kind === 'gift' ? '赠送池' : '正式池'}</Badge>
                )}
                <div className="w-24 shrink-0 text-right">
                  {h.hours > 0 ? (
                    <>
                      <span className="font-medium text-slate-700">{hoursFmt(h.hours)}</span>
                      <span className="text-xs text-slate-400"> 课时</span>
                      {h.amount > 0 && <div className="text-[11px] text-slate-400">{money(h.amount)}</div>}
                    </>
                  ) : (
                    <span className="text-slate-300">{STATUS_LABEL[h.status]}</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>

      <StudentForm open={editOpen} onClose={() => setEditOpen(false)} initial={stu} />
      <PackageForm open={pkgOpen} onClose={() => setPkgOpen(false)} studentId={stu.id} />
      <PackageEditModal bundle={editPkg} onClose={() => setEditPkg(null)} student={stu} />
    </Layout>
  )
}

// ============================================================
// 学生表单
// ============================================================
export function StudentForm({ open, onClose, initial }) {
  const { create, update, toast } = useApp()
  const [form, setForm] = useState(null)

  React.useEffect(() => {
    if (open) {
      setForm(
        initial
          ? { ...initial }
          : {
              name: '',
              enName: '',
              grade: '',
              gender: '',
              birthDate: '',
              school: '',
              parentName: '',
              phone: '',
              wechat: '',
              notes: '',
              status: 'active',
            }
      )
    }
  }, [open, initial])

  if (!open || !form) return null
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.name.trim()) {
      toast('请填写学生姓名', 'error')
      return
    }
    try {
      if (initial) {
        await update('students', initial.id, form)
        toast('已保存')
      } else {
        await create('students', form)
        toast(`已创建学生「${form.name}」`)
      }
      onClose()
    } catch (e) {
      toast(e.message || '保存失败', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑学生' : '新增学生'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="姓名 *">
          <Input value={form.name} onChange={set('name')} placeholder="如：王小明" autoFocus />
        </Field>
        <Field label="英文名">
          <Input value={form.enName} onChange={set('enName')} placeholder="如：Eason" />
        </Field>
        <Field label="年级">
          <Input value={form.grade || ''} onChange={set('grade')} placeholder="如：G5 / 五年级" />
        </Field>
        <Field label="性别">
          <Select value={form.gender} onChange={set('gender')}>
            <option value="">未填</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </Select>
        </Field>
        <Field label="出生日期">
          <Input type="date" value={form.birthDate} onChange={set('birthDate')} />
        </Field>
        <Field label="学校">
          <Input value={form.school} onChange={set('school')} />
        </Field>
        <Field label="在读状态">
          <Select value={form.status} onChange={set('status')}>
            {STATUS_OPTS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="家长姓名">
          <Input value={form.parentName} onChange={set('parentName')} />
        </Field>
        <Field label="联系电话">
          <Input value={form.phone} onChange={set('phone')} inputMode="tel" />
        </Field>
        <Field label="微信号" className="col-span-2">
          <Input value={form.wechat} onChange={set('wechat')} />
        </Field>
        <Field label="备注" className="col-span-2">
          <Textarea rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

// ============================================================
// 课包表单（一次录入 正式 + 赠送）
// ============================================================
export function PackageForm({ open, onClose, studentId, defaultCourseId }) {
  const { db, create, createMany, toast } = useApp()
  const [form, setForm] = useState(null)

  React.useEffect(() => {
    if (open) {
      setForm({
        courseId: defaultCourseId || db.courses[0]?.id || '',
        formalHours: 100,
        price: 9800,
        giftHours: 20,
        purchasedAt: new Date().toISOString().slice(0, 10),
        note: '',
      })
    }
  }, [open, defaultCourseId, db.courses])

  if (!open || !form) return null
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const unit = form.formalHours > 0 ? round2(form.price / form.formalHours) : 0

  const submit = async () => {
    if (!form.courseId) {
      toast('请选择课程', 'error')
      return
    }
    if (!(form.formalHours > 0) && !(form.giftHours > 0)) {
      toast('课时要大于 0', 'error')
      return
    }
    const bundleId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
    const rows = []
    if (form.formalHours > 0) {
      rows.push({
        studentId,
        courseId: form.courseId,
        kind: 'formal',
        bundleId,
        totalHours: Number(form.formalHours),
        usedHours: 0,
        price: Number(form.price) || 0,
        purchasedAt: form.purchasedAt,
        note: form.note,
      })
    }
    if (form.giftHours > 0) {
      rows.push({
        studentId,
        courseId: form.courseId,
        kind: 'gift',
        bundleId,
        totalHours: Number(form.giftHours),
        usedHours: 0,
        price: 0,
        purchasedAt: form.purchasedAt,
        note: form.note ? form.note + '（赠送）' : '报名赠送',
      })
    }
    try {
      await createMany('packages', rows)
      toast(`课包已录入：正式 ${hoursFmt(form.formalHours)} + 赠送 ${hoursFmt(form.giftHours)} 课时`)
      onClose()
    } catch (e) {
      toast(e.message || '保存失败', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新增课包（缴费）"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存课包</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="课程 *" className="col-span-2">
          <Select value={form.courseId} onChange={set('courseId')}>
            {db.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="正式课时 *">
          <Input type="number" min="0" value={form.formalHours} onChange={set('formalHours')} />
        </Field>
        <Field label="缴费金额（元）">
          <Input type="number" min="0" value={form.price} onChange={set('price')} />
        </Field>
        <Field label="赠送课时（比赛课时）">
          <Input type="number" min="0" value={form.giftHours} onChange={set('giftHours')} />
        </Field>
        <Field label="购买日期">
          <Input type="date" value={form.purchasedAt} onChange={set('purchasedAt')} />
        </Field>
        <Field label="备注" className="col-span-2">
          <Input value={form.note} onChange={set('note')} placeholder="如：老生续费优惠" />
        </Field>
      </div>
      <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">
        单价：{money(unit)} / 课时，消课时自动计算耗课金额；赠送池消课计 ¥0。
      </div>
    </Modal>
  )
}

// ============================================================
// 课包编辑（调整课时/金额/备注/删除）
// ============================================================
function PackageEditModal({ bundle, onClose }) {
  const { db, update, remove, toast, confirm } = useApp()
  const [form, setForm] = useState(null)

  React.useEffect(() => {
    if (bundle) {
      setForm({
        formalHours: bundle.formal?.totalHours ?? 0,
        price: bundle.formal?.price ?? 0,
        giftHours: bundle.gift?.totalHours ?? 0,
        note: bundle.formal?.note || bundle.gift?.note || '',
      })
    }
  }, [bundle])
  if (!bundle || !form) return null

  const save = async () => {
    try {
      if (bundle.formal) await update('packages', bundle.formal.id, { totalHours: Number(form.formalHours) || 0, price: Number(form.price) || 0, note: form.note })
      if (bundle.gift) await update('packages', bundle.gift.id, { totalHours: Number(form.giftHours) || 0, note: form.note })
      toast('课包已更新')
      onClose()
    } catch (e) {
      toast(e.message || '保存失败', 'error')
    }
  }

  const del = async () => {
    const ok = await confirm('删除课包', '删除后该课包的剩余课时和金额将消失（历史点名记录保留）。确定删除？', true)
    if (!ok) return
    try {
      if (bundle.formal) await remove('packages', bundle.formal.id)
      if (bundle.gift) await remove('packages', bundle.gift.id)
      toast('课包已删除')
      onClose()
    } catch (e) {
      toast(e.message || '删除失败', 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑课包"
      footer={
        <>
          <Button variant="danger" onClick={del}>
            <Trash2 size={15} /> 删除课包
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save}>保存</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {bundle.formal && (
          <>
            <Field label="正式课时">
              <Input type="number" min="0" value={form.formalHours} onChange={(e) => setForm((f) => ({ ...f, formalHours: e.target.value }))} />
            </Field>
            <Field label="缴费金额（元）">
              <Input type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </Field>
          </>
        )}
        {bundle.gift && (
          <Field label="赠送课时">
            <Input type="number" min="0" value={form.giftHours} onChange={(e) => setForm((f) => ({ ...f, giftHours: e.target.value }))} />
          </Field>
        )}
        <Field label="备注" className="col-span-2">
          <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  )
}
