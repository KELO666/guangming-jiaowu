import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, RefreshCcw, TrendingUp } from 'lucide-react'
import { useApp } from '../store'
import { hoursFmt, money, remaining, round2 } from '../lib/core'
import { Badge, Button, Card, Empty, HoursText, StatCard, cn } from '../ui'
import Layout from '../components/Layout'

export default function Stats() {
  const { db, renewal, stats, toast, settings } = useApp()
  const nav = useNavigate()
  const threshold = Number(settings.renewalThreshold) || 20

  // 全部学生课时余额（有课包的）
  const balanceRows = useMemo(() => {
    const rows = []
    for (const stu of db.students) {
      if (stu.status === 'archived') continue
      const mine = db.packages.filter((p) => p.studentId === stu.id)
      if (!mine.length) continue
      const byCourse = new Map()
      for (const p of mine) {
        if (!byCourse.has(p.courseId)) byCourse.set(p.courseId, { formal: 0, gift: 0 })
        const cell = byCourse.get(p.courseId)
        cell[p.kind] = round2((cell[p.kind] || 0) + remaining(p))
      }
      const total = [...byCourse.values()].reduce((a, c) => a + c.formal + c.gift, 0)
      rows.push({ stu, byCourse, total: round2(total) })
    }
    rows.sort((a, b) => a.total - b.total)
    return rows
  }, [db])

  const copyRenewal = async () => {
    const text = renewal
      .map((r) => {
        const parts = [`${r.student.name}`]
        parts.push(`${r.course?.name || '课程'} 正式课时剩 ${hoursFmt(r.formalRem)}`)
        if (r.giftRem > 0) parts.push(`（另有赠送 ${hoursFmt(r.giftRem)} 课时）`)
        if (r.formalRem < 0) parts.push('已超扣，请尽快续费')
        return parts.join('')
      })
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('名单已复制，可直接发给家长')
    } catch {
      toast('复制失败，请手动选择文本', 'error')
    }
  }

  return (
    <Layout title="统计">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">统计看板</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="本月耗课金额" value={money(stats.amount)} tone="blue" sub="正式池确认收入" onClick={() => nav('/records')} />
        <StatCard label="本月消课" value={hoursFmt(stats.formalHours)} tone="blue" sub={`共 ${stats.count} 人次`} onClick={() => nav('/records')} />
        <StatCard label="赠送池消耗" value={hoursFmt(stats.giftHours)} tone="green" sub="比赛/集训课时" onClick={() => nav('/records')} />
        <StatCard label="待续费" value={`${renewal.length} 人`} tone={renewal.length ? 'amber' : 'blue'} sub={`剩余 ≤ ${threshold} 课时`} />
      </div>

      {/* 待续费名单 */}
      <div className="mt-6 mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">待续费名单</h3>
        {renewal.length > 0 && (
          <Button variant="soft" size="sm" onClick={copyRenewal}>
            <Copy size={14} /> 复制名单（发给家长）
          </Button>
        )}
      </div>
      <Card className="divide-y divide-slate-100 overflow-hidden">
        {renewal.length === 0 ? (
          <Empty icon={<TrendingUp size={36} />} text="课时都很充足，暂时没有人需要续费" />
        ) : (
          renewal.map((r) => (
            <div key={r.student.id + r.courseId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.student.name}</span>
                  {r.student.parentName && <span className="text-xs text-slate-400">家长：{r.student.parentName}</span>}
                  {r.student.phone && <span className="text-xs text-slate-400">{r.student.phone}</span>}
                  {r.formalRem < 0 && <Badge tone="red">已超扣</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {r.course?.name} · 正式池剩 {hoursFmt(r.formalRem)} + 赠送池剩 {hoursFmt(r.giftRem)}
                </div>
              </div>
              <div className={cn('text-xl font-bold tabular-nums', r.formalRem < 0 ? 'text-red-500' : 'text-amber-600')}>
                {hoursFmt(r.formalRem)}
                <span className="ml-0.5 text-xs font-normal text-slate-400">课时</span>
              </div>
            </div>
          ))
        )}
      </Card>

      {/* 全部余额 */}
      <h3 className="mt-6 mb-3 font-semibold text-slate-700">学生课时余额</h3>
      <Card className="divide-y divide-slate-100 overflow-hidden">
        {balanceRows.length === 0 ? (
          <Empty text="还没有课包数据" />
        ) : (
          balanceRows.map((row) => (
            <div key={row.stu.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="w-20 font-semibold">{row.stu.name}</span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {[...row.byCourse.entries()].map(([courseId, v]) => {
                  const course = db.courses.find((c) => c.id === courseId)
                  return (
                    <span
                      key={courseId}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs',
                        v.formal + v.gift < 0 ? 'bg-red-50 text-red-600' : v.formal + v.gift <= threshold ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: course?.color }} />
                      {course?.name}
                      <b className="tabular-nums">{hoursFmt(v.formal)}</b>
                      {v.gift > 0 && <span className="text-emerald-600">+{hoursFmt(v.gift)}赠</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </Card>

      <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        <RefreshCcw size={12} />
        续费后到学生详情里「新增课包」录入缴费，名单会自动移出。
      </div>
    </Layout>
  )
}
