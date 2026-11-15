import dayjs from 'dayjs'
import { addDays, isoWeekday, unitPrice, remaining, round2, hoursBetween } from './core'

// ============================================================
// 业务算法：排课生成 / 消课计算 / 续费名单 / 统计
// ============================================================

// 给一个班课生成 [from, to] 区间内缺失的课次
export function generateSessionsForGroup(group, from, to, existingKeys) {
  if (!group.active) return []
  if (group.type === 'single') return []
  const rows = []
  let d = dayjs(from)
  const end = dayjs(to)
  while (d.isBefore(end) || d.isSame(end, 'day')) {
    const date = d.format('YYYY-MM-DD')
    const wd = isoWeekday(date)
    let hit = false
    if (group.type === 'recurring') hit = (group.weekdays || []).includes(wd)
    if (group.type === 'limited') {
      hit =
        (group.weekdays || []).includes(wd) &&
        (!group.startDate || date >= group.startDate) &&
        (!group.endDate || date <= group.endDate)
    }
    if (hit && !existingKeys.has(`${group.id}|${date}`)) {
      rows.push({
        groupId: group.id,
        courseId: group.courseId,
        date,
        startTime: group.startTime,
        endTime: group.endTime,
        hours: group.hours,
        content: '',
        location: group.location || '',
        status: 'scheduled',
      })
    }
    d = d.add(1, 'day')
  }
  return rows
}

// 在整个生成窗口 [today-21, today+35] 补齐缺失课次
export const GEN_FROM_OFFSET = -21
export const GEN_TO_OFFSET = 35

export function missingSessions(groups, sessions, today) {
  const from = addDays(today, GEN_FROM_OFFSET)
  const to = addDays(today, GEN_TO_OFFSET)
  const keys = new Set(sessions.map((s) => `${s.groupId}|${s.date}`))
  const rows = []
  for (const g of groups) rows.push(...generateSessionsForGroup(g, from, to, keys))
  return rows
}

// —— 消课时选哪个课包 ——
// 优先：指定 override > 学生该课程对应池的课包（按购买时间，先用旧的，可扣负）> 该课程任意池
export function pickPackage(packages, { studentId, courseId, pool = 'formal', overrideId }) {
  if (overrideId) return packages.find((p) => p.id === overrideId) || null
  const mine = packages.filter((p) => p.studentId === studentId && p.courseId === courseId)
  const byOld = (a, b) => ((a.purchasedAt || '') < (b.purchasedAt || '') ? -1 : 1)
  const ofPool = mine.filter((p) => p.kind === pool).sort(byOld)
  if (ofPool.length) {
    const hasRem = ofPool.find((p) => remaining(p) > 0)
    return hasRem || ofPool[ofPool.length - 1]
  }
  const any = mine.sort(byOld)
  if (any.length) {
    const hasRem = any.find((p) => remaining(p) > 0)
    return hasRem || any[any.length - 1]
  }
  return null
}

// 计算一次点名保存的完整结果（含编辑时的回冲）
export function computeAttendanceSave({ session, group, prevRows, entries, packages, settings }) {
  const deltas = new Map() // packageId -> ±hours
  const addDelta = (id, h) => {
    if (!id || !h) return
    deltas.set(id, round2((deltas.get(id) || 0) + h))
  }

  // 1. 回冲上一次已保存的记录
  for (const prev of prevRows) {
    if (prev.marked && prev.packageId) addDelta(prev.packageId, -(Number(prev.hours) || 0))
  }

  // 2. 计算本次
  const upserts = []
  const noPkg = []
  for (const e of entries) {
    const deductive = e.status === 'present' || e.status === 'makeup'
    const ruleDeduct =
      e.status === 'leave' ? !!settings.deductOnLeave : e.status === 'absent' ? !!settings.deductOnAbsent : false
    const shouldDeduct = deductive || ruleDeduct
    let pkg = null
    let hours = 0
    let amount = 0
    if (shouldDeduct) {
      pkg = pickPackage(packages, {
        studentId: e.studentId,
        courseId: session.courseId || group?.courseId,
        pool: session.pool || group?.defaultPool || 'formal',
        overrideId: e.packageIdOverride,
      })
      if (!pkg) {
        noPkg.push(e.studentId)
        upserts.push({
          sessionId: session.id,
          studentId: e.studentId,
          status: e.status,
          packageId: null,
          hours: 0,
          amount: 0,
          marked: true,
          markedAt: new Date().toISOString(),
        })
        continue
      }
      hours = Number(session.hours) || 2
      amount = pkg.kind === 'gift' ? 0 : round2(unitPrice(pkg) * hours)
      addDelta(pkg.id, hours)
    }
    upserts.push({
      sessionId: session.id,
      studentId: e.studentId,
      status: e.status,
      packageId: pkg ? pkg.id : null,
      hours,
      amount,
      marked: true,
      markedAt: new Date().toISOString(),
    })
  }
  return { upserts, deltas: [...deltas.entries()].map(([id, h]) => ({ id, hours: h })), noPkg }
}

// 撤销一次点名：返回需要回冲的包和删除范围
export function computeAttendanceReset(prevRows) {
  const deltas = new Map()
  for (const prev of prevRows) {
    if (prev.marked && prev.packageId) {
      deltas.set(prev.packageId, round2((deltas.get(prev.packageId) || 0) - (Number(prev.hours) || 0)))
    }
  }
  return { deltas: [...deltas.entries()].map(([id, hours]) => ({ id, hours })) }
}

// —— 续费名单 ——
// 以「正式池剩余」为续费判断标准（赠送池是比赛课时，不计入续费判断），负数最前
export function renewalList(students, packages, courses, threshold) {
  const rows = []
  for (const stu of students) {
    if (stu.status === 'archived') continue
    const mine = packages.filter((p) => p.studentId === stu.id)
    const byCourse = new Map()
    for (const p of mine) {
      if (!byCourse.has(p.courseId)) byCourse.set(p.courseId, [])
      byCourse.get(p.courseId).push(p)
    }
    for (const [courseId, list] of byCourse) {
      const formalRem = list.filter((p) => p.kind === 'formal').reduce((a, p) => a + remaining(p), 0)
      const giftRem = list.filter((p) => p.kind === 'gift').reduce((a, p) => a + remaining(p), 0)
      const total = round2(formalRem + giftRem)
      if (round2(formalRem) < threshold) {
        rows.push({
          student: stu,
          course: courses.find((c) => c.id === courseId),
          courseId,
          formalRem: round2(formalRem),
          giftRem: round2(giftRem),
          total,
        })
      }
    }
  }
  rows.sort((a, b) => a.formalRem - b.formalRem) // 负数最前，欠得最多排第一
  return rows
}

// —— 月度统计 ——
export function monthStats(attendance, sessions, packages, month) {
  const sessById = new Map(sessions.map((s) => [s.id, s]))
  const pkgKind = new Map(packages.map((p) => [p.id, p.kind]))
  let formalHours = 0
  let giftHours = 0
  let amount = 0
  let count = 0
  for (const a of attendance) {
    if (!a.marked) continue
    const sess = sessById.get(a.sessionId)
    if (!sess || !String(sess.date).startsWith(month)) continue
    if (a.status !== 'present' && a.status !== 'makeup') continue
    const h = Number(a.hours) || 0
    amount += Number(a.amount) || 0 // 赠送池 amount 恒为 0，不影响收入
    count += 1
    if (a.packageId && pkgKind.get(a.packageId) === 'gift') giftHours += h
    else formalHours += h
  }
  return {
    formalHours: round2(formalHours),
    giftHours: round2(giftHours),
    amount: round2(amount),
    count,
  }
}

// 课次排序
export const sortSessions = (list) =>
  [...list].sort((a, b) =>
    a.date === b.date ? String(a.startTime).localeCompare(String(b.startTime)) : String(a.date).localeCompare(String(b.date))
  )

// ============================================================
// 冲突检测：同一个老师，同一天时间段重叠即冲突
// ============================================================
const toMin = (t) => {
  if (!t) return null
  const [h, m] = String(t).split(':').map(Number)
  if (isNaN(h)) return null
  return h * 60 + (m || 0)
}

// 两个课次是否时间重叠（缺时间的按"全天"处理，与同日任何课冲突）
export function sessionsOverlap(a, b) {
  if (!a || !b || a.date !== b.date) return false
  const aStart = toMin(a.startTime)
  const aEnd = toMin(a.endTime)
  const bStart = toMin(b.startTime)
  const bEnd = toMin(b.endTime)
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return true // 全天/缺时间
  return aStart < bEnd && bStart < aEnd
}

// 在一组课次里找出所有冲突对
export function findSessionConflicts(list) {
  const out = []
  const arr = list.filter((s) => s && s.date && s.status !== 'cancelled')
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (sessionsOverlap(arr[i], arr[j])) out.push([arr[i], arr[j]])
    }
  }
  return out
}

// 新增课次与已有课次的冲突（newRows/existing 均为 {date,startTime,endTime,label} 形状）
export function conflictsForNew(newRows, existing) {
  const out = []
  for (const n of newRows) {
    for (const e of existing) {
      if (sessionsOverlap(n, e)) out.push({ new: n, old: e })
    }
  }
  return out
}

// 把解析结果展开为具体课次（用于冲突预览；recurring 展开到生成窗口）
export function expandParsedToSessions(p, today, windowDays = 35) {
  const rows = []
  const push = (date) =>
    rows.push({ date, startTime: p.startTime, endTime: p.endTime, label: p.name || p.course?.name || '' })
  if (!p.startTime || !p.type) return rows
  if (p.type === 'single') {
    if (p.date) push(p.date)
  } else if (p.type === 'limited' && p.startDate && p.endDate) {
    for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1)) {
      if ((p.weekdays || []).includes(isoWeekday(d))) push(d)
    }
  } else if (p.type === 'recurring') {
    const start = p.startDate || today
    for (let i = 0; i <= windowDays; i++) {
      const d = addDays(start, i)
      if ((p.weekdays || []).includes(isoWeekday(d))) push(d)
    }
  }
  return rows
}
