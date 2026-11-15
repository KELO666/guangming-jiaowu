import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AlertTriangle, RefreshCcw, Download, CalendarClock } from 'lucide-react'
import { useApp } from './store'
import { getApi } from './api'
import Today from './pages/Today'
import Schedule from './pages/Schedule'
import Students, { StudentDetail } from './pages/Students'
import Attendance from './pages/Attendance'
import Records from './pages/Records'
import Stats from './pages/Stats'
import SettingsPage from './pages/Settings'
import Setup from './pages/Setup'
import Login from './pages/Login'
import { Button, Card, Modal, cn, Spinner } from './ui'

function GlobalOverlays() {
  const { toasts, confirmState, answerConfirm } = useApp()
  return (
    <>
      {/* Toast */}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'fade-up rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg',
              t.tone === 'error' ? 'bg-red-500' : 'bg-slate-800'
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
      {/* Confirm */}
      <Modal
        open={!!confirmState}
        onClose={() => answerConfirm(false)}
        title={confirmState?.title}
        width="max-w-sm"
        footer={
          <>
            <Button variant="outline" onClick={() => answerConfirm(false)}>
              取消
            </Button>
            <Button variant={confirmState?.danger ? 'dangerSolid' : 'primary'} onClick={() => answerConfirm(true)}>
              确定
            </Button>
          </>
        }
      >
        <div className="text-[15px] leading-relaxed text-slate-600">{confirmState?.message}</div>
      </Modal>
    </>
  )
}

// —— 每月备份提醒：超 30 天自动弹窗，一键下载到本地 ——
const BACKUP_KEY = 'gm_last_backup'
function BackupReminder() {
  const { toast } = useApp()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(BACKUP_KEY) || 0)
      if (!last) {
        localStorage.setItem(BACKUP_KEY, String(Date.now()))
        return
      }
      if (Date.now() - last > 30 * 864e5) setOpen(true)
    } catch {}
  }, [])
  const markBackup = () => localStorage.setItem(BACKUP_KEY, String(Date.now()))
  const doBackup = async () => {
    try {
      const text = await getApi().exportJson()
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `光明教务备份_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      markBackup()
      setOpen(false)
      toast('备份已下载，建议转发到微信收藏或网盘保存')
    } catch (e) {
      toast(e.message || '备份失败', 'error')
    }
  }
  const later = () => {
    // 三天后再提醒
    localStorage.setItem(BACKUP_KEY, String(Date.now() - 27 * 864e5))
    setOpen(false)
  }
  return (
    <Modal
      open={open}
      onClose={later}
      title="该做月度备份啦"
      width="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={later}>
            <CalendarClock size={15} /> 三天后再说
          </Button>
          <Button onClick={doBackup}>
            <Download size={15} /> 一键备份到本机
          </Button>
        </>
      }
    >
      <div className="text-[15px] leading-relaxed text-slate-600">
        距离上次备份已超过 30 天。点一下确认，备份文件会自动下载到你电脑的「下载」文件夹，建议转发到微信收藏或网盘保存一份。
      </div>
    </Modal>
  )
}

export default function App() {
  const { phase, bootError } = useApp()

  if (phase === 'boot') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50">
        <Spinner className="h-8 w-8" />
        <div className="text-sm text-slate-400">正在加载…</div>
      </div>
    )
  }
  if (phase === 'setup') return <Setup />
  if (phase === 'login') return <Login />
  if (phase === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <AlertTriangle size={40} className="mx-auto mb-3 text-amber-500" />
          <div className="font-semibold">启动出错了</div>
          <div className="mt-2 break-all text-sm text-slate-500">{bootError}</div>
          <Button className="mt-5" onClick={() => location.reload()}>
            <RefreshCcw size={16} /> 重试
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/students" element={<Students />} />
        <Route path="/students/:id" element={<StudentDetail />} />
        <Route path="/session/:id" element={<Attendance />} />
        <Route path="/records" element={<Records />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalOverlays />
      <BackupReminder />
    </>
  )
}
