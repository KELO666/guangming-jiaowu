import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getApi, initApi } from './api'
import { seedDemo } from './api/seed'
import { DEFAULT_SETTINGS, todayStr, remaining, round2 } from './lib/core'
import { missingSessions, computeAttendanceSave, computeAttendanceReset, renewalList, monthStats } from './lib/logic'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const MODE_KEY = 'gm_mode'
const CLOUD_KEY = 'gm_cloud_conf'

// 生产构建固化的云端配置（.env.production）：存在时跳过欢迎页/试用模式，直达登录
export const BAKED_CONF = import.meta.env.VITE_SUPABASE_URL
  ? { url: import.meta.env.VITE_SUPABASE_URL, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY }
  : null

export function AppProvider({ children }) {
  const [phase, setPhase] = useState('boot') // boot | setup | login | ready | error
  const [bootError, setBootError] = useState('')
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || null)
  const [db, setDb] = useState(null)
  const [user, setUser] = useState(null)
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)
  const bootedRef = useRef(false)

  // —— Toast / Confirm ——
  const toast = useCallback((text, tone = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])
  const confirm = useCallback((title, message, danger = false) => {
    return new Promise((resolve) => setConfirmState({ title, message, danger, resolve }))
  }, [])
  const answerConfirm = useCallback((v) => {
    setConfirmState((s) => {
      s?.resolve(v)
      return null
    })
  }, [])

  const cloudConf = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(CLOUD_KEY) || 'null')
    } catch {
      return null
    }
  }, [])

  // —— 启动 ——
  const loadAll = useCallback(async () => {
    const api = getApi()
    const data = await api.fetchAll()
    // 补齐缺失课次
    const miss = missingSessions(data.groups, data.sessions, todayStr())
    if (miss.length) {
      await api.insertMany('sessions', miss)
      const again = await api.fetchAll()
      setDb(again)
    } else {
      setDb(data)
    }
    return true
  }, [])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    ;(async () => {
      try {
        if (BAKED_CONF) {
          // 生产部署：永远走云端，未登录则进登录页
          const api = initApi('cloud', BAKED_CONF)
          const session = await api.getSession()
          if (!session?.user) {
            setPhase('login')
            return
          }
          setUser(session.user)
          await loadAll()
          setPhase('ready')
          return
        }
        if (!mode) {
          setPhase('setup')
          return
        }
        const api = initApi(mode, cloudConf)
        if (mode === 'cloud') {
          const session = await api.getSession()
          if (!session?.user) {
            setPhase('login')
            return
          }
          setUser(session.user)
        } else {
          setUser({ email: 'local' })
          // 本地模式空库 → 灌入示例数据
          const data = await api.fetchAll()
          if (data.students.length === 0) await seedDemo(api)
        }
        await loadAll()
        setPhase('ready')
      } catch (e) {
        setBootError(e.message || String(e))
        setPhase('error')
      }
    })()
  }, [mode, cloudConf, loadAll])

  // —— 切换模式 ——
  const chooseMode = useCallback(async (m, conf) => {
    localStorage.setItem(MODE_KEY, m)
    if (conf) localStorage.setItem(CLOUD_KEY, JSON.stringify(conf))
    else localStorage.removeItem(CLOUD_KEY)
    setMode(m)
    bootedRef.current = false
    setPhase('boot')
    setBootError('')
  }, [])

  const refresh = useCallback(async () => {
    try {
      await loadAll()
    } catch (e) {
      toast(e.message || '刷新失败', 'error')
    }
  }, [loadAll, toast])

  const signOut = useCallback(async () => {
    const api = getApi()
    await api.signOut?.()
    setUser(null)
    setPhase('login')
  }, [])

  const saveSettings = useCallback(
    async (patch) => {
      await getApi().updateSettings(patch)
      await refresh()
    },
    [refresh]
  )

  // —— CRUD 快捷 ——
  const create = useCallback(
    async (table, row) => {
      const r = await getApi().insert(table, row)
      await refresh()
      return r
    },
    [refresh]
  )
  const createMany = useCallback(
    async (table, rows) => {
      const r = await getApi().insertMany(table, rows)
      await refresh()
      return r
    },
    [refresh]
  )
  const update = useCallback(
    async (table, id, patch) => {
      await getApi().update(table, id, patch)
      await refresh()
    },
    [refresh]
  )
  const remove = useCallback(
    async (table, id) => {
      await getApi().remove(table, id)
      await refresh()
    },
    [refresh]
  )

  // —— 班课：更新后重建未来未点名课次 ——
  const updateGroup = useCallback(
    async (groupId, patch, studentIds) => {
      const api = getApi()
      await api.update('groups', groupId, patch)
      if (studentIds) {
        const old = db.groupStudents.filter((r) => r.groupId === groupId)
        const oldSet = new Set(old.map((r) => r.studentId))
        for (const sid of studentIds) {
          if (!oldSet.has(sid)) await api.insert('groupStudents', { groupId, studentId: sid })
        }
        for (const r of old) {
          if (!studentIds.includes(r.studentId)) await api.remove('groupStudents', r.id)
        }
      }
      // 删除未来未点名的课次后重新生成
      const today = todayStr()
      const sess = db.sessions.filter(
        (s) => s.groupId === groupId && s.date >= today && !db.attendance.some((a) => a.sessionId === s.id)
      )
      for (const s of sess) await api.remove('sessions', s.id)
      await refresh()
    },
    [db, refresh]
  )

  // —— 班课：删除（历史记录保留，课次脱离班课）——
  const deleteGroup = useCallback(
    async (groupId) => {
      const api = getApi()
      const sess = db.sessions.filter((s) => s.groupId === groupId)
      for (const s of sess) {
        if (!db.attendance.some((a) => a.sessionId === s.id)) await api.remove('sessions', s.id)
        else await api.update('sessions', s.id, { groupId: null })
      }
      await api.remove('groups', groupId)
      await refresh()
    },
    [db, refresh]
  )

  // —— 点名保存 / 撤销 ——
  // options.complete=false 时用于课前登记（如请假），不把整节课标记为已完成
  const saveAttendance = useCallback(
    async (session, entries, options = {}) => {
      const complete = options.complete !== false
      const api = getApi()
      const group = db.groups.find((g) => g.id === session.groupId) || null
      const prevRows = db.attendance.filter((a) => a.sessionId === session.id)
      const { upserts, deltas, noPkg } = computeAttendanceSave({
        session,
        group,
        prevRows,
        entries,
        packages: db.packages,
        settings: db.settings,
      })
      if (noPkg.length) return { ok: false, noPkg }
      // 课时若被修改，合并进 sessionPatch 一次写入（省一次往返）
      const stored = db.sessions.find((s) => s.id === session.id)
      const hoursChanged = stored && session.hours != null && Number(session.hours) !== Number(stored.hours)
      await api.saveAttendanceBatch({
        sessionId: session.id,
        sessionPatch: {
          ...(complete ? { status: 'completed' } : {}),
          ...(hoursChanged ? { hours: session.hours } : {}),
        },
        upserts,
        deltas,
      })
      await refresh()
      return { ok: true }
    },
    [db, refresh]
  )

  const resetAttendance = useCallback(
    async (sessionId) => {
      const api = getApi()
      const prevRows = db.attendance.filter((a) => a.sessionId === sessionId)
      const { deltas } = computeAttendanceReset(prevRows)
      await api.resetAttendance({ sessionId, deltas })
      await refresh()
    },
    [db, refresh]
  )

  // —— 派生数据 ——
  const derived = useMemo(() => {
    if (!db) return {}
    const {
      students,
      courses,
      packages,
      groups,
      groupStudents,
      sessions,
      attendance,
      settings,
    } = db
    const studentById = new Map(students.map((s) => [s.id, s]))
    const courseById = new Map(courses.map((c) => [c.id, c]))
    const groupById = new Map(groups.map((g) => [g.id, g]))
    const rosterOf = (groupId) =>
      groupStudents
        .filter((r) => r.groupId === groupId)
        .map((r) => studentById.get(r.studentId))
        .filter(Boolean)
    const groupsOfStudent = (studentId) =>
      groups.filter((g) => groupStudents.some((r) => r.groupId === g.id && r.studentId === studentId))

    // 学生在某课程下的课包（正式/赠送）
    const pkgsOf = (studentId, courseId) =>
      packages.filter((p) => p.studentId === studentId && p.courseId === courseId)

    const renewal = renewalList(students, packages, courses, settings.renewalThreshold ?? 20)
    const month = todayStr().slice(0, 7)
    const stats = monthStats(attendance, sessions, packages, month)

    const today = todayStr()
    const todaySessions = sessions
      .filter((s) => s.date === today && s.status !== 'cancelled')
      .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    const pendingToday = todaySessions.filter((s) => s.status !== 'completed')
    const endedPending = pendingToday.filter((s) => {
      const now = new Date()
      const [h, m] = String(s.endTime || '23:59').split(':').map(Number)
      return now.getHours() * 60 + now.getMinutes() > h * 60 + m
    })

    return {
      studentById,
      courseById,
      groupById,
      rosterOf,
      groupsOfStudent,
      pkgsOf,
      renewal,
      stats,
      today,
      month,
      todaySessions,
      pendingToday,
      endedPending,
    }
  }, [db])

  const value = {
    phase,
    bootError,
    mode,
    cloudConf,
    bakedConf: BAKED_CONF,
    db,
    user,
    settings: db?.settings || DEFAULT_SETTINGS,
    ...derived,
    toast,
    confirm,
    answerConfirm,
    confirmState,
    toasts,
    chooseMode,
    refresh,
    signOut,
    saveSettings,
    create,
    createMany,
    update,
    remove,
    updateGroup,
    deleteGroup,
    saveAttendance,
    resetAttendance,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// —— 手机端判定 ——
export function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const fn = (e) => setM(e.matches)
    mq.addEventListener?.('change', fn)
    return () => mq.removeEventListener?.('change', fn)
  }, [])
  return m
}
