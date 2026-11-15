import React from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Clock, MapPin, Users, ChevronRight, AlertCircle, PartyPopper } from 'lucide-react'
import { useApp } from '../store'
import { fmtDateFull, hhmm, hoursFmt, money, remaining } from '../lib/core'
import { Badge, Button, Card, Empty, cn } from '../ui'
import Layout from '../components/Layout'
import Assistant from '../components/Assistant'

export default function Today() {
  const { db, todaySessions, endedPending, renewal, stats, settings, courseById, groupById, rosterOf, mode } = useApp()
  const nav = useNavigate()

  const d = new Date()
  const header = (
    <div className="mb-5">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">今日课表</h1>
        <span className="text-sm text-slate-400">{fmtDateFull(d)}</span>
      </div>
      <div className="mt-1 text-[15px] text-slate-500">
        {todaySessions.length
          ? `共 ${todaySessions.length} 节课${endedPending.length ? `，${endedPending.length} 节已下课待点名` : ''}`
          : '今天没有排课'}
      </div>
    </div>
  )

  const endedBanner = endedPending.length > 0 && (
    <div className="mb-4 space-y-2">
      {endedPending.map((s) => {
        const g = groupById.get(s.groupId)
        return (
          <button
            key={s.id}
            onClick={() => nav(`/session/${s.id}`)}
            className="pulse-soft flex w-full items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-left transition hover:bg-red-100/70"
          >
            <AlertCircle size={22} className="shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-red-700">
                《{g?.name || s.content || '课程'}》已下课，待点名
              </div>
              <div className="mt-0.5 text-sm text-red-400">
                {hhmm(s.startTime)}-{hhmm(s.endTime)} · 点击完成点名消课
              </div>
            </div>
            <ChevronRight size={20} className="shrink-0 text-red-400" />
          </button>
        )
      })}
    </div>
  )

  return (
    <Layout title="今日">
      {header}
      <Assistant />
      {endedBanner}

      {todaySessions.length === 0 ? (
        <Card>
          <Empty icon={<PartyPopper size={40} />} text="今天没有排课，休息一下" />
          <div className="flex justify-center pb-8">
            <Button variant="soft" onClick={() => nav('/schedule')}>
              去排课
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {todaySessions.map((s) => {
            const g = groupById.get(s.groupId)
            const course = courseById.get(s.courseId || g?.courseId)
            const roster = rosterOf(s.groupId)
            const marked = s.status === 'completed'
            const ended = endedPending.some((x) => x.id === s.id)
            return (
              <Card key={s.id} className={cn('p-4', ended && 'border-red-200')} onClick={() => nav(`/session/${s.id}`)}>
                <div className="flex items-center gap-4">
                  <div className="w-[76px] shrink-0 text-center">
                    <div className="text-lg font-bold tabular-nums text-slate-800">{hhmm(s.startTime)}</div>
                    <div className="text-xs text-slate-400">{hoursFmt(s.hours)} 小时</div>
                  </div>
                  <div className="h-10 w-px bg-slate-100" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{g?.name || s.content || '临时课'}</span>
                      {course && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <span className="h-2 w-2 rounded-full" style={{ background: course.color }} />
                          {course.name}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} /> 至 {hhmm(s.endTime)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users size={12} /> {roster.length} 人
                      </span>
                      {s.location && (
                        <span className="hidden items-center gap-1 sm:inline-flex">
                          <MapPin size={12} /> {s.location}
                        </span>
                      )}
                    </div>
                  </div>
                  {s.status === 'cancelled' ? (
                    <Badge tone="gray">已取消</Badge>
                  ) : marked ? (
                    <Badge tone="green">已点名</Badge>
                  ) : ended ? (
                    <Badge tone="red">待点名</Badge>
                  ) : (
                    <Badge tone="blue">即将开始</Badge>
                  )}
                  <ChevronRight size={18} className="shrink-0 text-slate-300" />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* 快捷统计 */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Card className="p-4" onClick={() => nav('/stats')}>
          <div className="text-xs text-slate-400">待续费</div>
          <div className={cn('mt-1 text-xl font-bold tabular-nums', renewal.length ? 'text-amber-600' : 'text-slate-700')}>
            {renewal.length} 人
          </div>
        </Card>
        <Card className="p-4" onClick={() => nav('/records')}>
          <div className="text-xs text-slate-400">本月耗课金额</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-blue-600">{money(stats.amount)}</div>
        </Card>
        <Card className="p-4" onClick={() => nav('/records')}>
          <div className="text-xs text-slate-400">本月消课</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-slate-700">
            {hoursFmt(stats.formalHours)}
            <span className="ml-1 text-xs font-normal text-slate-400">课时</span>
          </div>
        </Card>
      </div>

      {mode === 'local' && (
        <div className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">
          当前是<b>本地演示模式</b>（示例数据，仅存这台设备的浏览器）。正式使用请到 设置 → 连接云端，手机电脑数据同步。
        </div>
      )}
    </Layout>
  )
}
