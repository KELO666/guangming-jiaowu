import { addDays, hoursBetween, isoWeekday, todayStr } from './core'

// ============================================================
// 共享业务动作：排课创建（文字排课弹窗与智能助手共用）
// ============================================================

// 把一行解析结果落库：建课程（如需）→ 建班课 → 建名单 → 建课次
// p: parser.parseLine 的结果（可经用户编辑）
// 返回 { groupId, courseCreated, sessionsCreated }
export async function createScheduleLine(p, { create, createMany }) {
  let courseId = p.course?.id
  let courseCreated = false
  if (!courseId && p.course?.name) {
    const c = await create('courses', { name: p.course.name, color: '#2563eb' })
    courseId = c.id
    courseCreated = true
  }
  if (!courseId) throw new Error('有班课未选择课程')

  const hours = p.hours || hoursBetween(p.startTime, p.endTime) || 2
  const g = await create('groups', {
    name: p.name || p.course?.name || '班课',
    courseId,
    type: p.type,
    weekdays: p.weekdays || [],
    startDate: p.type === 'recurring' ? p.startDate || todayStr() : p.startDate,
    endDate: p.type === 'limited' ? p.endDate : '',
    startTime: p.startTime,
    endTime: p.endTime,
    hours,
    defaultPool: p.defaultPool || 'formal',
    location: '',
    notes: '',
    active: true,
  })
  if (p.students?.length) {
    await createMany('groupStudents', p.students.map((s) => ({ groupId: g.id, studentId: s.id })))
  }
  let sessionsCreated = 0
  if (p.type === 'limited' || p.type === 'single') {
    // 限时/单次：显式生成全部课次（可能超出常规生成窗口）
    const rows = []
    const end = p.type === 'single' ? p.date || p.startDate : p.endDate
    for (let d = p.startDate; d <= end; d = addDays(d, 1)) {
      if (p.type === 'single' || (p.weekdays || []).includes(isoWeekday(d))) {
        rows.push({
          groupId: g.id,
          courseId,
          date: d,
          startTime: p.startTime,
          endTime: p.endTime,
          hours,
          content: '',
          location: '',
          status: 'scheduled',
        })
      }
    }
    if (rows.length) {
      await createMany('sessions', rows)
      sessionsCreated = rows.length
    }
  }
  return { groupId: g.id, courseCreated, sessionsCreated }
}

// 学生课包：一次缴费 = 正式 + 赠送两个池
export function packageRowsFor({ studentId, courseId, formalHours, giftHours, price, purchasedAt, note }) {
  const bundleId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
  const rows = []
  if (Number(formalHours) > 0) {
    rows.push({
      studentId,
      courseId,
      kind: 'formal',
      bundleId,
      totalHours: Number(formalHours),
      usedHours: 0,
      price: Number(price) || 0,
      purchasedAt: purchasedAt || todayStr(),
      note: note || '',
    })
  }
  if (Number(giftHours) > 0) {
    rows.push({
      studentId,
      courseId,
      kind: 'gift',
      bundleId,
      totalHours: Number(giftHours),
      usedHours: 0,
      price: 0,
      purchasedAt: purchasedAt || todayStr(),
      note: note ? note + '（赠送）' : '报名赠送·比赛课时',
    })
  }
  return rows
}
