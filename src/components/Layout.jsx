import React from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  CalendarRange,
  Users,
  ClipboardList,
  BarChart3,
  Settings as SettingsIcon,
  Bot,
  ChevronLeft,
  Cloud,
  HardDrive,
} from 'lucide-react'
import { useApp, useIsMobile } from '../store'
import { cn, Badge } from '../ui'

const NAV = [
  { to: '/', label: '今日课表', icon: CalendarDays },
  { to: '/schedule', label: '课表排课', icon: CalendarRange },
  { to: '/students', label: '学生管理', icon: Users },
  { to: '/records', label: '上课记录', icon: ClipboardList },
  { to: '/stats', label: '统计看板', icon: BarChart3 },
]

// 手机底部导航
const MOBILE_NAV = [
  { to: '/', label: '今日', icon: CalendarDays },
  { to: '/schedule', label: '课表', icon: CalendarRange },
  { to: '/students', label: '学生', icon: Users },
  { to: '/records', label: '记录', icon: ClipboardList },
  { to: '/stats', label: '统计', icon: BarChart3 },
]

function Logo({ compact }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm shadow-blue-600/30">
        <Bot size={20} />
      </div>
      {!compact && <span className="text-[17px] font-bold tracking-tight">光明教务</span>}
    </div>
  )
}

export default function Layout({ children, title }) {
  const { mode, pendingToday, renewal, endedPending } = useApp()
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const loc = useLocation()
  const settings = useApp().settings

  const badgeFor = (to) => {
    if (to === '/' && endedPending.length) return endedPending.length
    if (to === '/stats' && renewal.length) return null
    return null
  }

  return (
    <div className="flex min-h-full">
      {/* PC 侧边栏 */}
      {!isMobile && (
        <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-slate-200/70 bg-white px-3 py-5">
          <div className="px-2 pb-6">
            <Logo />
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {NAV.map((n) => {
              const active = n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)
              const badge = badgeFor(n.to)
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
                    active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <n.icon size={19} className={active ? 'text-blue-600' : 'text-slate-400'} />
                  {n.label}
                  {badge && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                      {badge}
                    </span>
                  )}
                </NavLink>
              )
            })}
            <NavLink
              to="/settings"
              className={cn(
                'mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
                loc.pathname.startsWith('/settings') ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <SettingsIcon size={19} className={loc.pathname.startsWith('/settings') ? 'text-blue-600' : 'text-slate-400'} />
              设置
            </NavLink>
          </nav>
          <div className="px-2 pt-3">
            <Badge tone={mode === 'cloud' ? 'green' : 'amber'}>
              {mode === 'cloud' ? <Cloud size={12} /> : <HardDrive size={12} />}
              {mode === 'cloud' ? '云端已连接' : '本地演示模式'}
            </Badge>
          </div>
        </aside>
      )}

      {/* 手机顶栏 */}
      {isMobile && (
        <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <Logo compact />
            <span className="text-[16px] font-bold">{title || settings.orgName || '光明教务'}</span>
          </div>
          <button onClick={() => nav('/settings')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <SettingsIcon size={20} />
          </button>
        </header>
      )}

      <main
        className={cn(
          'flex-1',
          !isMobile && 'ml-56',
          isMobile ? 'pb-[calc(72px+env(safe-area-inset-bottom))] pt-14' : 'p-8'
        )}
      >
        <div className={cn('mx-auto w-full', !isMobile && 'max-w-5xl')}>{children}</div>
      </main>

      {/* 手机底部导航 */}
      {isMobile && (
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          {MOBILE_NAV.map((n) => {
            const active = n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)
            const badge = badgeFor(n.to)
            return (
              <NavLink key={n.to} to={n.to} className="relative flex flex-1 flex-col items-center gap-0.5 py-2">
                <span className="relative">
                  <n.icon size={22} className={active ? 'text-blue-600' : 'text-slate-400'} />
                  {badge ? (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className={cn('text-[11px]', active ? 'font-semibold text-blue-600' : 'text-slate-400')}>
                  {n.label}
                </span>
              </NavLink>
            )
          })}
        </nav>
      )}
    </div>
  )
}

export { Logo }
