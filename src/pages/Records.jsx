import React, { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useApp } from '../store'
import { fmtDate, hhmm, hoursFmt, money, STATUS_LABEL, todayStr } from '../lib/core'
import { Badge, Button, Card, Empty, Input, Select, cn } from '../ui'
import Layout from '../components/Layout'

export default function Records() {
  const { db } = useApp()
  const [studentId, setStudentId] = useState('all')
  const [month, setMonth] = useState(todayStr().slice(0, 7))
  const [kind, setKind] = useState('all')

  const rows = useMemo(() => {
    const sessById = new Map(db.sessions.map((s) => [s.id, s]))
    const pkgById = new Map(db.packages.map((p) => [p.id, p]))
    return db.attendance
      .filter((a) => a.marked)
      .map((a) => ({ ...a, sess: sessById.get(a.sessionId), pkg: a.packageId ? pkgById.get(a.packageId) : null }))
      .filter((a) => a.sess)
      .filter((a) => (studentId === 'all' ? true : a.studentId === studentId))
      .filter((a) => String(a.sess.date).startsWith(month))
      .filter((a) => (kind === 'all' ? true : kind === 'gift' ? a.pkg?.kind === 'gift' : a.pkg?.kind !== 'gift'))
      .sort((a, b) => b.sess.date.localeCompare(a.sess.date) || String(b.sess.startTime).localeCompare(String(a.sess.startTime)))
  }, [db, studentId, month, kind])

  const totalHours = rows.reduce((a, r) => a + (Number(r.hours) || 0), 0)
  const totalAmount = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)

  const exportCsv = () => {
    const head = ['日期', '星期', '时间', '学生', '班课/内容', '状态', '消课池', '课时', '金额']
    const week = ['日', '一', '二', '三', '四', '五', '六']
    const lines = rows.map((r) => {
      const stu = db.students.find((s) => s.id === r.studentId)
      const g = db.groups.find((x) => x.id === r.sess.groupId)
      const course = db.courses.find((c) => c.id === r.sess.courseId)
      return [
        r.sess.date,
        '周' + week[new Date(r.sess.date.replace(/-/g, '/')).getDay()],
        `${hhmm(r.sess.startTime)}-${hhmm(r.sess.endTime)}`,
        stu?.name || '',
        g?.name || r.sess.content || course?.name || '',
        STATUS_LABEL[r.status],
        r.pkg?.kind === 'gift' ? '赠送池' : '正式池',
        hoursFmt(r.hours),
        r.amount || 0,
      ].join(',')
    })
    const csv = '\uFEFF' + [head.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `上课记录_${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout title="记录">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">上课记录</h1>
        <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-32">
          <option value="all">全部学生</option>
          {db.students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-36" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-28">
          <option value="all">全部课包</option>
          <option value="formal">正式池</option>
          <option value="gift">赠送池</option>
        </Select>
        <Button variant="outline" onClick={exportCsv}>
          <Download size={16} /> 导出
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
        <span>
          共 <b className="text-slate-800">{rows.length}</b> 条
        </span>
        <span>
          消课 <b className="text-blue-600">{hoursFmt(totalHours)}</b> 课时
        </span>
        <span>
          耗课金额 <b className="text-blue-600">{money(totalAmount)}</b>
        </span>
      </div>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        {rows.length === 0 ? (
          <Empty text="该筛选条件下没有记录" />
        ) : (
          rows.map((r) => {
            const stu = db.students.find((s) => s.id === r.studentId)
            const g = db.groups.find((x) => x.id === r.sess.groupId)
            const course = db.courses.find((c) => c.id === r.sess.courseId)
            const deductive = r.status === 'present' || r.status === 'makeup'
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="w-20 shrink-0 text-slate-500">{fmtDate(r.sess.date)}</div>
                <div className="w-20 shrink-0 font-medium">{stu?.name}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{g?.name || r.sess.content || course?.name || '课程'}</div>
                  <div className="text-xs text-slate-400">
                    {hhmm(r.sess.startTime)}-{hhmm(r.sess.endTime)} · {course?.name}
                  </div>
                </div>
                {r.status !== 'present' && (
                  <Badge tone={r.status === 'makeup' ? 'blue' : r.status === 'leave' ? 'amber' : 'red'}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                )}
                {r.pkg && <Badge tone={r.pkg.kind === 'gift' ? 'green' : 'gray'}>{r.pkg.kind === 'gift' ? '赠送池' : '正式池'}</Badge>}
                <div className={cn('w-24 shrink-0 text-right tabular-nums', deductive ? '' : 'text-slate-300')}>
                  {deductive ? (
                    <>
                      <span className="font-semibold">{hoursFmt(r.hours)}</span> 课时
                      <div className="text-[11px] text-slate-400">{r.amount > 0 ? money(r.amount) : '赠送 ¥0'}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>
    </Layout>
  )
}
