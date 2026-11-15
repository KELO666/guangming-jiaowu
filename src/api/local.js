import { DEFAULT_SETTINGS, uid } from '../lib/core'

// ============================================================
// 本地模式数据层：数据存浏览器 localStorage，打开即用（演示/单机）
// ============================================================
const LS_KEY = 'gm_local_db_v1'

// 逻辑表名 → 存储键名（与云端 Supabase 表名对齐）
const TKEY = {
  students: 'students',
  courses: 'courses',
  packages: 'packages',
  groups: 'class_groups',
  groupStudents: 'class_group_students',
  sessions: 'sessions',
  attendance: 'attendance',
}

const empty = () => ({
  students: [],
  courses: [],
  packages: [],
  class_groups: [],
  class_group_students: [],
  sessions: [],
  attendance: [],
  settings: {},
})

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...empty(), ...JSON.parse(raw) }
  } catch (e) {
    console.warn('本地数据读取失败', e)
  }
  return empty()
}

function persist(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db))
}

export function createLocalApi() {
  let db = load()
  const save = () => persist(db)

  const api = {
    mode: 'local',
    // —— 认证（本地模式跳过）——
    async getSession() {
      return { user: { email: 'local@demo' } }
    },
    onAuthChange() {
      return () => {}
    },
    async signUp() {
      return { ok: true }
    },
    async signIn() {
      return { ok: true }
    },
    async signOut() {},

    // —— 读取 ——
    async fetchAll() {
      return {
        students: [...db.students],
        courses: [...db.courses],
        packages: [...db.packages],
        groups: [...db.class_groups],
        groupStudents: [...db.class_group_students],
        sessions: [...db.sessions],
        attendance: [...db.attendance],
        settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) },
      }
    },

    // —— 写入 ——
    async insert(table, row) {
      const k = TKEY[table] || table
      const r = { ...row, id: row.id || uid(), createdAt: row.createdAt || new Date().toISOString() }
      db[k] = [...(db[k] || []), r]
      save()
      return r
    },
    async insertMany(table, rows) {
      const k = TKEY[table] || table
      const made = rows.map((row) => ({ ...row, id: row.id || uid(), createdAt: row.createdAt || new Date().toISOString() }))
      db[k] = [...(db[k] || []), ...made]
      save()
      return made
    },
    async update(table, id, patch) {
      const k = TKEY[table] || table
      db[k] = (db[k] || []).map((r) => (r.id === id ? { ...r, ...patch } : r))
      save()
    },
    async remove(table, id) {
      const k = TKEY[table] || table
      db[k] = (db[k] || []).filter((r) => r.id !== id)
      save()
    },
    async updateSettings(patch) {
      db.settings = { ...(db.settings || {}), ...patch }
      save()
      return db.settings
    },

    // —— 点名批处理（本地直接改）——
    async saveAttendanceBatch({ sessionId, sessionPatch, upserts, deltas }) {
      if (sessionPatch) {
        db.sessions = db.sessions.map((s) => (s.id === sessionId ? { ...s, ...sessionPatch } : s))
      }
      for (const u of upserts) {
        const exist = db.attendance.find((a) => a.sessionId === u.sessionId && a.studentId === u.studentId)
        if (exist) Object.assign(exist, u)
        else db.attendance.push({ ...u, id: uid() })
      }
      for (const d of deltas || []) {
        const pkg = db.packages.find((p) => p.id === d.id)
        if (pkg) pkg.usedHours = Math.round(((Number(pkg.usedHours) || 0) + d.hours) * 100) / 100
      }
      save()
    },
    async resetAttendance({ sessionId, deltas }) {
      db.attendance = db.attendance.filter((a) => a.sessionId !== sessionId)
      db.sessions = db.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'scheduled' } : s))
      for (const d of deltas || []) {
        const pkg = db.packages.find((p) => p.id === d.id)
        if (pkg) pkg.usedHours = Math.round(((Number(pkg.usedHours) || 0) + d.hours) * 100) / 100
      }
      save()
    },

    // —— 备份 ——
    async exportJson() {
      return JSON.stringify({ ...db, settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) } }, null, 2)
    },
    async importJson(text) {
      const data = JSON.parse(text)
      db = { ...empty(), ...data }
      save()
    },
    async resetDemo(seedFn) {
      db = empty()
      if (seedFn) await seedFn(api)
      save()
    },
    _db: () => db,
  }
  return api
}
