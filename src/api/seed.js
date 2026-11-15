import { uid, todayStr, addDays, unitPrice, round2 } from '../lib/core'
import { missingSessions } from '../lib/logic'

// ============================================================
// 本地演示数据：来自用户真实 Excel 名单
// vexIQ 周四班（10人）、vexgo 周六班（5人），课包 100+20
// ============================================================

export async function seedDemo(api) {
  const today = todayStr()

  // 课程
  const cIq = { id: uid(), name: 'VEX IQ', color: '#2563eb', createdAt: new Date().toISOString() }
  const cGo = { id: uid(), name: 'VEX GO', color: '#059669', createdAt: new Date().toISOString() }
  const cPy = { id: uid(), name: 'Python', color: '#7c3aed', createdAt: new Date().toISOString() }
  await api.insertMany('courses', [cIq, cGo, cPy])

  // 学生（周四班 + 周六班）
  const mk = (name, enName = '', extra = {}) => ({
    id: uid(),
    name,
    enName,
    gender: '',
    birthDate: '',
    school: '',
    parentName: '',
    phone: '',
    wechat: '',
    notes: '',
    status: 'active',
    createdAt: new Date().toISOString(),
    ...extra,
  })
  const thuStudents = [
    mk('王小明'),
    mk('Alina'),
    mk('Eason'),
    mk('张伟杰'),
    mk('周子杰'),
    mk('吴佳萱'),
    mk('郑梓涵'),
    mk('赵泽宇'),
    mk('孙昊然'),
    mk('钱宇轩'),
  ]
  const satStudents = [mk('何远航'), mk('高晓菲'), mk('谢浩然'), mk('林志强'), mk('梁诗雨')]
  await api.insertMany('students', [...thuStudents, ...satStudents])

  // 班课
  const gThu = {
    id: uid(),
    name: 'VEX IQ 周四班',
    courseId: cIq.id,
    type: 'recurring',
    weekdays: [4],
    startDate: addDays(today, -90),
    endDate: '',
    startTime: '17:20',
    endTime: '19:20',
    hours: 2,
    defaultPool: 'formal',
    location: '奥创星图-光明校区',
    notes: '',
    active: true,
    createdAt: new Date().toISOString(),
  }
  const gSat = {
    id: uid(),
    name: 'VEX GO 周六班',
    courseId: cGo.id,
    type: 'recurring',
    weekdays: [6],
    startDate: addDays(today, -90),
    endDate: '',
    startTime: '09:00',
    endTime: '11:00',
    hours: 2,
    defaultPool: 'formal',
    location: '奥创星图-光明校区',
    notes: '',
    active: true,
    createdAt: new Date().toISOString(),
  }
  await api.insertMany('groups', [gThu, gSat])
  const rosterRows = []
  for (const s of thuStudents) rosterRows.push({ groupId: gThu.id, studentId: s.id })
  for (const s of satStudents) rosterRows.push({ groupId: gSat.id, studentId: s.id })
  await api.insertMany('groupStudents', rosterRows)

  // 课包（100 正式 + 20 赠送），购买时间约 3 个月前
  const price = 9800
  const purchasedAt = addDays(today, -90)
  const bundleIdIq = uid()
  const bundleIdGo = uid()
  const bundleIdPy = uid()
  const pkgRows = []
  const addBundle = (student, course, bundle, usedGift = 0) => {
    const formalId = uid()
    pkgRows.push({
      id: formalId,
      studentId: student.id,
      courseId: course.id,
      kind: 'formal',
      bundleId: bundle,
      totalHours: 100,
      usedHours: 0,
      price,
      purchasedAt,
      note: '',
      createdAt: new Date().toISOString(),
    })
    pkgRows.push({
      id: uid(),
      studentId: student.id,
      courseId: course.id,
      kind: 'gift',
      bundleId: bundle,
      totalHours: 20,
      usedHours: usedGift,
      price: 0,
      purchasedAt,
      note: '报名赠送·比赛课时',
      createdAt: new Date().toISOString(),
    })
    return formalId
  }
  // 目标用量（演示多样性：一名负数、一名接近预警线、一名 Python 双课包）
  const usedTargets = new Map()
  usedTargets.set(addBundle(thuStudents[0], cIq, bundleIdIq, 4), 102) // 王小明 → 正式剩-2，赠送剩16
  usedTargets.set(addBundle(thuStudents[1], cIq, uid()), 40) // Alina 剩60
  usedTargets.set(addBundle(thuStudents[2], cIq, uid()), 15) // Eason 剩85
  usedTargets.set(addBundle(thuStudents[3], cIq, uid()), 20) // 张伟杰 剩80
  usedTargets.set(addBundle(thuStudents[4], cIq, uid()), 88) // 周子杰 剩12（预警线内）
  usedTargets.set(addBundle(thuStudents[5], cIq, uid()), 30)
  usedTargets.set(addBundle(thuStudents[6], cIq, uid()), 36)
  usedTargets.set(addBundle(thuStudents[7], cIq, uid()), 22)
  usedTargets.set(addBundle(thuStudents[8], cIq, uid()), 44)
  usedTargets.set(addBundle(thuStudents[9], cIq, uid()), 50)
  usedTargets.set(addBundle(satStudents[0], cGo, bundleIdGo), 26)
  usedTargets.set(addBundle(satStudents[1], cGo, uid()), 12)
  usedTargets.set(addBundle(satStudents[2], cGo, uid()), 58)
  usedTargets.set(addBundle(satStudents[3], cGo, uid()), 40)
  usedTargets.set(addBundle(satStudents[4], cGo, uid()), 70)
  // 张伟杰 的 Python 课包（多课包场景）
  pkgRows.push({
    id: uid(),
    studentId: thuStudents[3].id,
    courseId: cPy.id,
    kind: 'formal',
    bundleId: bundleIdPy,
    totalHours: 50,
    usedHours: 10,
    price: 5980,
    purchasedAt: addDays(today, -40),
    note: '',
    createdAt: new Date().toISOString(),
  })
  await api.insertMany('packages', pkgRows)

  // 生成近 4 周 + 未来 5 周的课次
  const groups = [gThu, gSat]
  const sessions = missingSessions(groups, [], today)
  await api.insertMany('sessions', sessions)

  // 给过去的课补上点名记录（演示统计），最近的周六班留待点名
  const sessionRows = await api.fetchAll().then((d) => d.sessions)
  const past = sessionRows.filter((s) => s.date < today).sort((a, b) => a.date.localeCompare(b.date))
  const pkgByStudentCourse = new Map()
  for (const p of pkgRows) {
    if (p.kind === 'formal') pkgByStudentCourse.set(`${p.studentId}|${p.courseId}`, p)
  }
  const attendanceRows = []
  const deltaByPkg = new Map()
  past.forEach((sess, idx) => {
    const roster = rosterRows.filter((r) => r.groupId === sess.groupId).map((r) => r.studentId)
    const leaverId = idx === past.length - 1 ? roster[5] : null // 最近一节有一名请假
    for (const sid of roster) {
      const isLeave = sid === leaverId
      const pkg = pkgByStudentCourse.get(`${sid}|${sess.courseId}`)
      const hours = isLeave ? 0 : sess.hours
      const amount = isLeave || !pkg ? 0 : round2(unitPrice(pkg) * hours)
      attendanceRows.push({
        sessionId: sess.id,
        studentId: sid,
        status: isLeave ? 'leave' : 'present',
        packageId: isLeave ? null : pkg?.id || null,
        hours,
        amount,
        marked: true,
        markedAt: new Date().toISOString(),
      })
      if (!isLeave && pkg) deltaByPkg.set(pkg.id, (deltaByPkg.get(pkg.id) || 0) + hours)
    }
  })
  await api.insertMany('attendance', attendanceRows)

  // 应用种子消课 + 调整到目标用量（模拟更早的历史消耗）
  const allPkg = await api.fetchAll().then((d) => d.packages)
  for (const p of allPkg) {
    const target = usedTargets.get(p.id)
    if (target == null) continue
    const seeded = deltaByPkg.get(p.id) || 0
    const used = Math.max(seeded, target)
    await api.update('packages', p.id, { usedHours: used })
  }
}
