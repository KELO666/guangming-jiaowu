import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SETTINGS, uid } from '../lib/core'

// ============================================================
// 云端模式数据层（Supabase）
// ============================================================

const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())

// 日期/时间戳/数值/ID 类列不接受空字符串（Postgres 会报 invalid input syntax），
// 统一在数据层边界把 '' 归一为 null，任何表单/路径不再触发此类错误。
const NULLABLE_EMPTY = /(^date$|_date$|_at$|^hours$|_hours$|^price$|^amount$|_id$)/

const toRow = (obj) =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([k, v]) => v !== undefined)
      .map(([k, v]) => [snake(k), v])
      .map(([k, v]) => [k, v === '' && NULLABLE_EMPTY.test(k) ? null : v])
  )
const fromRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]))

const TABLES = {
  students: 'students',
  courses: 'courses',
  packages: 'packages',
  groups: 'class_groups',
  groupStudents: 'class_group_students',
  sessions: 'sessions',
  attendance: 'attendance',
}

export function createCloudApi({ url, anonKey }) {
  const sb = createClient(url, anonKey)
  let rpcOk = null // null=未探测 / true=消课函数可用 / false=缺失（走兼容路径）

  async function all(table, order) {
    let q = sb.from(table).select('*')
    if (order) q = q.order(order)
    const { data, error } = await q
    if (error) throw new Error(friendly(error))
    return (data || []).map(fromRow)
  }

  function friendly(err) {
    const msg = err?.message || String(err)
    if (/relation .* does not exist|schema cache|42P01/i.test(msg))
      return '数据表还没创建：请先到 Supabase 控制台 SQL Editor 执行建表 SQL（向导第2步可复制）'
    if (/JWT|apikey|Invalid API key/i.test(msg)) return 'anon key 不正确，请检查'
    if (/Failed to fetch|NetworkError/i.test(msg)) return '网络连接失败，请检查 Supabase 地址是否正确'
    return msg
  }

  // 数据库里还没创建消课函数（42883=undefined function / PGRST202=PostgREST 找不到 RPC）
  function isMissingRpc(err) {
    return (
      err?.code === '42883' ||
      err?.code === 'PGRST202' ||
      /function .* does not exist|Could not find the function|schema cache/i.test(err?.message || '')
    )
  }

  return {
    mode: 'cloud',
    client: sb,

    async getSession() {
      const { data } = await sb.auth.getSession()
      return data.session
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session))
      return () => data.subscription.unsubscribe()
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) throw new Error(friendly(error))
      return data
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error) {
        if (/Email not confirmed/i.test(error.message))
          throw new Error('邮箱还未确认：请去邮箱点确认链接，或到 Supabase 后台 Authentication 关闭"Confirm email"')
        if (/Invalid login credentials/i.test(error.message)) throw new Error('邮箱或密码不对')
        throw new Error(friendly(error))
      }
      return data
    },
    async signOut() {
      await sb.auth.signOut()
    },

    async fetchAll() {
      const [students, courses, packages, groups, groupStudents, sessions, attendance, settingsRows] =
        await Promise.all([
          all('students', 'created_at'),
          all('courses', 'created_at'),
          all('packages', 'created_at'),
          all('class_groups', 'created_at'),
          all('class_group_students'),
          all('sessions', 'date'),
          all('attendance'),
          sb.from('settings').select('*').then(({ data, error }) => {
            if (error) throw new Error(friendly(error))
            return data || []
          }),
        ])
      const settings = { ...DEFAULT_SETTINGS }
      for (const r of settingsRows) settings[r.key] = r.value
      return {
        students: students.map((r) => ({ ...r, id: r.id })),
        courses,
        packages,
        groups,
        groupStudents,
        sessions,
        attendance,
        settings,
      }
    },

    async insert(table, row) {
      const t = TABLES[table] || table
      const r = { ...row, id: row.id || uid() }
      const { data, error } = await sb.from(t).insert(toRow(r)).select().single()
      if (error) throw new Error(friendly(error))
      return fromRow(data)
    },
    async insertMany(table, rows) {
      if (!rows.length) return []
      const t = TABLES[table] || table
      const made = rows.map((row) => ({ ...row, id: row.id || uid() }))
      const { error } = await sb.from(t).insert(made.map(toRow))
      if (error) throw new Error(friendly(error))
      return made
    },
    async update(table, id, patch) {
      const t = TABLES[table] || table
      const { error } = await sb.from(t).update(toRow(patch)).eq('id', id)
      if (error) throw new Error(friendly(error))
    },
    async remove(table, id) {
      const t = TABLES[table] || table
      const { error } = await sb.from(t).delete().eq('id', id)
      if (error) throw new Error(friendly(error))
    },
    async updateSettings(patch) {
      await Promise.all(
        Object.entries(patch).map(async ([key, value]) => {
          const { error } = await sb.from('settings').upsert({ key, value }, { onConflict: 'key' })
          if (error) throw new Error(friendly(error))
        })
      )
    },

    // —— 消课保存：优先走数据库函数（1 次往返 + 事务原子）；未建函数时自动回退并行路径 ——
    async saveAttendanceBatch({ sessionId, sessionPatch, upserts, deltas }) {
      const patch = sessionPatch && Object.keys(sessionPatch).length ? toRow(sessionPatch) : null
      const payload = { sessionId, sessionPatch: patch, upserts: upserts.map(toRow), deltas: deltas || [] }
      if (rpcOk !== false) {
        const { error } = await sb.rpc('apply_attendance', { p: payload })
        if (!error) {
          rpcOk = true
          return
        }
        if (!isMissingRpc(error)) throw new Error(friendly(error))
        rpcOk = false // 本次会话内不再尝试，重载页面后自动重新探测
      }
      // 兼容路径：数据库尚未创建 apply_attendance 函数
      if (patch) {
        const { error } = await sb.from('sessions').update(patch).eq('id', sessionId)
        if (error) throw new Error(friendly(error))
      }
      if (upserts.length) {
        const { error } = await sb
          .from('attendance')
          .upsert(payload.upserts, { onConflict: 'session_id,student_id' })
        if (error) throw new Error(friendly(error))
      }
      await Promise.all(
        (deltas || []).map(async (d) => {
          const { data, error } = await sb.from('packages').select('used_hours').eq('id', d.id).single()
          if (error) throw new Error(friendly(error))
          const next = Math.round(((Number(data.used_hours) || 0) + d.hours) * 100) / 100
          const { error: e2 } = await sb.from('packages').update({ used_hours: next }).eq('id', d.id)
          if (e2) throw new Error(friendly(e2))
        })
      )
    },
    async resetAttendance({ sessionId, deltas }) {
      if (rpcOk !== false) {
        const { error } = await sb.rpc('reset_attendance', {
          p: { sessionId, deltas: deltas || [] },
        })
        if (!error) {
          rpcOk = true
          return
        }
        if (!isMissingRpc(error)) throw new Error(friendly(error))
        rpcOk = false
      }
      // 兼容路径
      const { error } = await sb.from('attendance').delete().eq('session_id', sessionId)
      if (error) throw new Error(friendly(error))
      const { error: e2 } = await sb.from('sessions').update({ status: 'scheduled' }).eq('id', sessionId)
      if (e2) throw new Error(friendly(e2))
      await Promise.all(
        (deltas || []).map(async (d) => {
          const { data, error } = await sb.from('packages').select('used_hours').eq('id', d.id).single()
          if (error) throw new Error(friendly(error))
          const next = Math.round(((Number(data.used_hours) || 0) + d.hours) * 100) / 100
          const { error: e3 } = await sb.from('packages').update({ used_hours: next }).eq('id', d.id)
          if (e3) throw new Error(friendly(e3))
        })
      )
    },

    // —— 备份（云端：拉全量 → JSON；导入：合并式恢复） ——
    async exportJson() {
      const data = await this.fetchAll()
      return JSON.stringify(data, null, 2)
    },
    async importJson(text) {
      const data = JSON.parse(text)
      const map = {
        students: 'students',
        courses: 'courses',
        groups: 'class_groups',
        groupStudents: 'class_group_students',
        packages: 'packages',
        sessions: 'sessions',
        attendance: 'attendance',
      }
      for (const [key, table] of Object.entries(map)) {
        const rows = (data[key] || []).map(toRow)
        if (!rows.length) continue
        const { error } = await sb.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw new Error(friendly(error))
      }
      for (const [k, v] of Object.entries(data.settings || {})) {
        const { error } = await sb.from('settings').upsert({ key: k, value: v }, { onConflict: 'key' })
        if (error) throw new Error(friendly(error))
      }
    },
  }
}

// 连接测试：验证 URL + anon key
export async function testCloudConnection(url, anonKey) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/health`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    })
    if (!res.ok) return { ok: false, message: `连接失败（HTTP ${res.status}）：请检查地址和 anon key` }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: '网络连接失败：请检查 Supabase 项目地址（应以 https:// 开头）' }
  }
}

// 判断建表 SQL 是否已执行
export async function checkSchema(sb) {
  const { error } = await sb.from('students').select('id').limit(1)
  if (!error) return { ok: true }
  if (/relation .* does not exist|schema cache|42P01/i.test(error.message || ''))
    return { ok: false, message: '数据表还没创建' }
  if (/JWT|apikey|row level security|permission denied/i.test(error.message || ''))
    return { ok: true, note: '已登录后可正常读写' }
  return { ok: false, message: error.message }
}
