import dayjs from 'dayjs'
import { addDays, isoWeekday, todayStr, parseHM, hhmm, WEEK_CN, hoursBetween, isCompetitionName } from './core'
import { matchCourse, matchStudents, parseLine, minutesToText } from './parser'

// ============================================================
// 智能助手 NLU（规则式解析，无需联网）
// 每行一句话 = 一条指令。支持：
//  ① 报名学生+课包+入班：新报了学生小琳，G5，vexiq，36100元，100课时+20赠送比赛课时，加入周三17:20-19:20的班级
//  ② 缴费/续费：小琳续费 vexiq 9800元 100课时+20赠
//  ③ 排课：每周四 17:20-19:20 vexIQ：王小明、Alina（同文字排课）
//  ④ 点名：今天VEX GO周六班全到，林志强请假
//  ⑤ 请假登记：孙昊然明天请假
//  ⑥ 查询：小琳还剩多少课时 / 谁该续费了 / 明天几节课
// ============================================================

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '')
const normalizeLine = (s) =>
  String(s || '')
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .trim()

function parseNum(s) {
  if (s == null) return null
  const n = parseFloat(String(s).replace(/[,，]/g, ''))
  return isNaN(n) ? null : n
}

// 学生名匹配（先精确后模糊）
function findStudent(token, students) {
  if (!token) return null
  const t = token.trim()
  const tl = t.toLowerCase()
  return (
    students.find((s) => s.name === t || (s.enName || '').toLowerCase() === tl) ||
    students.find((s) => (s.name && s.name.includes(t) && t.length >= 2) || ((s.enName || '') && plincludes(s.enName, tl))) ||
    null
  )
}
const plincludes = (en, tl) => en && tl.length >= 2 && en.toLowerCase().includes(tl)

// 从句子里找课程
function findCourseIn(line, courses) {
  const mc = matchCourse(line, courses)
  return mc ? mc.course : null
}

// 周几 + 时间
function findWeekdayTime(line) {
  const wd = line.match(/周([一二三四五六日天])|星期([一二三四五六日天])/)
  const wdChar = wd ? wd[1] || wd[2] : null
  const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
  const time = line.match(/(\d{1,2}):(\d{2})/g)
  return {
    weekday: wdChar ? WD[wdChar] : null,
    weekdayLabel: wdChar ? `周${wdChar}` : '',
    times: time || [],
  }
}

// 价格 / 课时
function findPriceHours(line) {
  const price = line.match(/([0-9][0-9,，.]*)\s*元|([0-9][0-9,，.]*)\s*块/)
  const priceNum = price ? parseNum(price[1] || price[2]) : null
  // 赠送课时：+20赠送 / 赠20课时 / 20赠送比赛课时
  let gift = null
  let m = line.match(/\+\s*([0-9]{1,3})\s*(?:个)?\s*(?:课时)?\s*(?:赠|比赛)/)
  if (!m) m = line.match(/赠\s*([0-9]{1,3})/)
  if (!m) m = line.match(/([0-9]{1,3})\s*(?:个)?\s*(?:课时)?\s*(?:赠送|比赛课时)/)
  if (m) gift = parseNum(m[1])
  // 正式课时：第一个"数字课时"且不在赠送语境里
  let formal = null
  m = line.match(/([0-9]{1,4})\s*[个节]?\s*课时/)
  if (m) formal = parseNum(m[1])
  if (formal == null) {
    m = line.match(/([0-9]{1,3})\s*\+\s*[0-9]{1,3}/)
    if (m) formal = parseNum(m[1])
  }
  return { price: priceNum, formalHours: formal, giftHours: gift }
}

function findGrade(line) {
  const m = line.match(/\b[Gg]\s*(\d{1,2})\b/) || line.match(/([一二三四五六七八九]年级)/) || line.match(/(学前|幼儿|初一|初二|初三|高一|高二|高三)/)
  if (!m) return ''
  return m[0].replace(/\s/g, '')
}

// 班课匹配：按 周几+时间 → 周几+课程 → 名词
// matched=false 表示句子里没有指向具体班课的信息（此时 candidates 是全部班课，仅作备选）
function findGroups(line, groups, courses) {
  const { weekday, times } = findWeekdayTime(line)
  const course = findCourseIn(line, courses)
  let matched = false
  let cands = groups.filter((g) => g.active)
  if (weekday != null) {
    cands = cands.filter((g) => (g.weekdays || []).includes(weekday))
    matched = true
  }
  if (course?.id) {
    const byCourse = cands.filter((g) => g.courseId === course.id)
    if (byCourse.length) {
      cands = byCourse
      matched = true
    }
  }
  if (times.length && cands.length > 1) {
    const target = parseHM(times[0].replace('：', ':'))
    const near = cands.filter((g) => Math.abs(parseHM(g.startTime) - target) <= 30)
    if (near.length) {
      cands = near
      matched = true
    }
  }
  // 班课名称词匹配兜底
  if (!matched) {
    const byName = groups.filter((g) => {
      const n = norm(g.name)
      return n.length >= 3 && norm(line).includes(n)
    })
    if (byName.length) {
      cands = byName
      matched = true
    }
  }
  return { weekday, times, matched, candidates: cands }
}

const groupLabel = (g, courses) => {
  if (!g) return ''
  const c = courses.find((x) => x.id === g.courseId)
  const wd = (g.weekdays || []).map((n) => '周' + WEEK_CN[n % 7]).join('')
  return `${g.name}（${c?.name || ''} ${wd} ${g.startTime || ''}${g.type === 'limited' ? ' 限时' : ''}）`.replace(/\s+/g, ' ').trim()
}

// —— 日期短语（取离今天最近的同月日理解：11月说"10.29"是今年，说"1.20"是明年）——
function resolveDatePhrase(line, today) {
  if (/明天/.test(line)) return { date: addDays(today, 1), label: '明天' }
  if (/后天/.test(line)) return { date: addDays(today, 2), label: '后天' }
  if (/昨天/.test(line)) return { date: addDays(today, -1), label: '昨天' }
  if (/今天|今晚|现在/.test(line)) return { date: today, label: '今天' }
  const m = line.match(/(\d{1,2})[.月](\d{1,2})日?/)
  if (m) {
    const now = dayjs(today)
    const thisYear = dayjs(new Date(now.year(), +m[1] - 1, +m[2]))
    const nextYear = dayjs(new Date(now.year() + 1, +m[1] - 1, +m[2]))
    const chosen = Math.abs(thisYear.diff(now, 'day')) <= Math.abs(nextYear.diff(now, 'day')) ? thisYear : nextYear
    return { date: chosen.format('YYYY-MM-DD'), label: `${+m[1]}.${+m[2]}` }
  }
  return null
}

// ============================================================
// 各意图解析
// ============================================================

function parseEnroll(line0, ctx) {
  const { students, courses, groups, today } = ctx
  const line = normalizeLine(line0)
  // 名字：去掉套话后取第一个像姓名的词
  const cleaned = line.replace(/新报了?|报了?名|新生|一个|一名|学生|孩子|小朋友|来了?/g, ',')
  const segs = cleaned.split(/[,，、\s]+/).filter(Boolean)
  let name = ''
  let existingStudent = null
  for (const s of segs) {
    if (/^[Gg]\d+$/.test(s) || /^[0-9.,]+$/.test(s) || /年级/.test(s)) continue
    if (matchCourse(s, courses)) continue
    const hit = findStudent(s, students)
    if (hit) {
      existingStudent = hit
      name = hit.name
      break
    }
    if (!name && /[一-龥a-zA-Z]{2,6}/.test(s)) {
      name = s.replace(/[^一-龥a-zA-Z]/g, '')
      break
    }
  }
  if (!name && !existingStudent) {
    return { intent: 'enroll', ok: false, raw: line0, warnings: ['没识别到学生姓名'], enroll: null }
  }
  const { price, formalHours, giftHours } = findPriceHours(line)
  const course = findCourseIn(line, courses)
  const grade = findGrade(line)
  const gm = findGroups(line, groups, courses)
  const addToGroup = gm.candidates.length === 1 ? gm.candidates[0].id : null

  const cmd = {
    intent: 'enroll',
    ok: true,
    raw: line0,
    warnings: [],
    enroll: {
      name: existingStudent ? existingStudent.name : name,
      grade: grade || existingStudent?.grade || '',
      existingStudent: !!existingStudent,
      studentId: existingStudent?.id || null,
      courseId: course?.id || null,
      courseName: course?.name || '',
      courseNew: !course,
      price: price ?? null,
      formalHours: formalHours ?? 100,
      giftHours: giftHours ?? 0,
      weekday: gm.weekday,
      weekdayLabel: gm.weekdayLabel,
      time: gm.times[0] || '',
      groupId: addToGroup,
      groupCandidates: gm.candidates,
      groupCandidatesAll: groups.filter((g) => g.active),
    },
  }
  if (!course) cmd.warnings.push('没识别到课程，将新建课程（可在下方改名）')
  if (price == null) cmd.warnings.push('没识别到缴费金额')
  if (formalHours == null) cmd.warnings.push('没识别到课时数，默认按100')
  if (gm.candidates.length === 0) cmd.warnings.push(gm.weekday ? `没找到${gm.weekdayLabel}的班课，可不加入或先排课` : '没识别到要加入的班级')
  if (gm.candidates.length > 1) cmd.warnings.push(`匹配到 ${gm.candidates.length} 个班课，请在下方选择`)
  return cmd
}

function parsePayment(line0, ctx) {
  const { students, courses } = ctx
  const line = normalizeLine(line0)
  const { price, formalHours, giftHours } = findPriceHours(line)
  const course = findCourseIn(line, courses)
  // 学生：优先取非课程/非数字的中文词
  const ms = matchStudents(line.replace(/[0-9.,+元个课时赠送比赛报名缴费续费]/g, ' '), students)
  const stu = ms.matched[0] || null
  const cmd = {
    intent: 'payment',
    ok: !!stu,
    raw: line0,
    warnings: [],
    payment: {
      studentId: stu?.id || null,
      studentName: stu?.name || '',
      courseId: course?.id || null,
      courseName: course?.name || '',
      courseNew: !course,
      price: price ?? null,
      formalHours: formalHours ?? 100,
      giftHours: giftHours ?? 0,
    },
  }
  if (!stu) cmd.warnings.push('没识别到学生姓名（需已在系统里建档）')
  if (!course) cmd.warnings.push('没识别到课程')
  if (price == null) cmd.warnings.push('没识别到缴费金额')
  return cmd
}

function parseAttendance(line0, ctx) {
  const { students, groups, sessions, today } = ctx
  const line = normalizeLine(line0)
  const dp = resolveDatePhrase(line, today) || { date: today, label: '今天' }
  const gm = findGroups(line, groups, ctx.courses)

  // 例外名单
  const exceptions = []
  for (const stu of students) {
    if (!stu.name && !stu.enName) continue
    const n = stu.name || ''
    const en = stu.enName || ''
    const re = new RegExp(`(${n || en})[^,。]{0,6}?(请假|告假|缺席|没来|没到|不到|不来|病了)|除了[^,。]*?(${n || en})`)
    if ((n || en) && re.test(line)) {
      const absent = /缺席|没来|没到|不到|不来/.test(RegExp.lastMatch || line)
      exceptions.push({ studentId: stu.id, name: n || en, status: absent ? 'absent' : 'leave' })
    }
  }

  // 模式一：句子里明确指向某个班课（周X/课程名/班课名）
  if (gm.matched) {
    const groupId = gm.candidates.length === 1 ? gm.candidates[0].id : null
    const session = groupId
      ? sessions.find((s) => s.groupId === groupId && s.date === dp.date && s.status !== 'cancelled') || null
      : null
    const cmd = {
      intent: 'attendance',
      ok: !!(groupId && session),
      raw: line0,
      warnings: [],
      attendance: {
        mode: 'single',
        date: dp.date,
        dateLabel: dp.label,
        groupId,
        groupCandidates: gm.candidates,
        groupCandidatesAll: groups.filter((g) => g.active),
        sessionId: session?.id || null,
        sessionTime: session ? `${session.startTime}-${session.endTime}` : '',
        exceptions,
      },
    }
    if (gm.candidates.length === 0) cmd.warnings.push('没找到对应的班课（试试写班课全名或 周X+课程）')
    else if (gm.candidates.length > 1) cmd.warnings.push(`匹配到 ${gm.candidates.length} 个班课，请选择`)
    else if (!session) cmd.warnings.push(`该班课${dp.label}（${dp.date}）没有排课`)
    if (!exceptions.length) cmd.warnings.push('没识别到请假/缺席的学生，将默认全员到课')
    return cmd
  }

  // 模式二：没指名班课 → 该日期的全部课次一起点名
  const daySessions = sessions.filter((s) => s.date === dp.date && s.status !== 'cancelled')
  const cmd = {
    intent: 'attendance',
    ok: daySessions.length > 0,
    raw: line0,
    warnings: [],
    attendance: {
      mode: 'date_all',
      date: dp.date,
      dateLabel: dp.label,
      excludeIds: [],
      exceptions,
    },
  }
  if (!daySessions.length) cmd.warnings.push(`${dp.label}（${dp.date}）没有排课`)
  if (!exceptions.length) cmd.warnings.push('没识别到请假/缺席的学生，将默认全员到课')
  return cmd
}

function parseLeave(line0, ctx) {
  const { students, groups, sessions, groupStudents, today } = ctx
  const line = normalizeLine(line0)
  const ms = matchStudents(line.replace(/请假|告假|明天|后天|今天|下次课|下次|这节/g, ' '), students)
  const stu = ms.matched[0]
  const dp = resolveDatePhrase(line, today)
  let session = null
  let mode = 'next'
  if (stu) {
    const myGroupIds = groups.filter((g) => groupStudents.some((r) => r.groupId === g.id && r.studentId === stu.id)).map((g) => g.id)
    if (dp) {
      session =
        sessions.find((s) => myGroupIds.includes(s.groupId) && s.date === dp.date && s.status !== 'cancelled') || null
      mode = 'date'
    }
    if (!session) {
      session = sessions
        .filter((s) => myGroupIds.includes(s.groupId) && s.date >= today && s.status !== 'cancelled' && s.status !== 'completed')
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0]
      mode = 'next'
    }
  }
  const cmd = {
    intent: 'leave',
    ok: !!(stu && session),
    raw: line0,
    warnings: [],
    leave: {
      studentId: stu?.id || null,
      studentName: stu?.name || '',
      sessionId: session?.id || null,
      date: session?.date || '',
      startTime: session?.startTime || '',
      mode,
    },
  }
  if (!stu) cmd.warnings.push('没识别到学生姓名')
  else if (!session) cmd.warnings.push('没找到该学生 upcoming 的课次')
  return cmd
}

// —— 学生名单对（中文名 + 英文名 可成对出现）——
// "加入了陈大明 Eason 和刘小华 Alina" → [{name:'陈大明',enName:'Eason',existing,rename}, ...]
const JOIN_STOP = /长期|以后|未来|每周|一起|上课|试听|体验|开始|结束|停课|转出/        // 整句级：直接跳过
const JOIN_PART_STOP = /班|课|长期|以后|每周|一起|上课|试听|体验/                        // 片段级：像班课描述，不是学生
function parseStudentPairs(text, students) {
  const out = []
  const clauses = String(text || '').split(/[,，。;；]+/)
  for (const clause of clauses) {
    if (JOIN_STOP.test(clause)) continue
    for (let part of clause.split(/[和及与、]+/)) {
      part = part.replace(/^(?:把|将|让|给|加入|加入了?|插班?|进班|转到?|调到?)+/, '').trim()
      if (!part || JOIN_PART_STOP.test(part)) continue
      const toks = part.split(/\s+/).filter(Boolean)
      let name = ''
      let enName = ''
      for (const t of toks) {
        if (!enName && /^[A-Za-z][A-Za-z0-9.\-]*$/.test(t)) enName = t
        else if (!name && /[一-龥]/.test(t)) name = t.replace(/学生|同学|的$/g, '')
      }
      if (!name && !enName) continue
      if (name && name.length > 5) continue
      // 匹配已有学生：精确中文名 → 包含中文名 → 英文名(enName/name 字段)
      let existing = null
      if (name) {
        existing =
          students.find((s) => s.name === name) ||
          students.find((s) => s.name && name.length >= 2 && s.name.includes(name))
      }
      if (!existing && enName) {
        const el = enName.toLowerCase()
        existing =
          students.find((s) => s.enName && s.enName.toLowerCase() === el) ||
          students.find((s) => s.name && s.name.toLowerCase() === el) ||
          (el.length >= 3
            ? students.find((s) => s.enName && s.enName.toLowerCase().includes(el))
            : null)
      }
      const rename = !!(existing && name && /[一-龥]/.test(name) && existing.name !== name)
      out.push({
        name: name || existing?.name || '',
        enName: enName || existing?.enName || '',
        existing: existing || null,
        rename,
      })
    }
  }
  return out
}

// —— 意图：学生入班（可含新建学生 / 中文名补全 / 限时班转长期）——
function parseJoinGroup(line0, ctx) {
  const { groups, courses, today } = ctx
  const line = normalizeLine(line0)
  const students = parseStudentPairs(line, ctx.students)
  if (!students.length) return null
  const gm = findGroups(line, groups, courses)
  const groupId = gm.candidates.length === 1 ? gm.candidates[0].id : null
  const group = groupId ? groups.find((g) => g.id === groupId) : null
  const wantsLongTerm = /长期|以后|一直|每周都|固定/.test(line)
  const expired = group && group.type === 'limited' && group.endDate && group.endDate < today
  const toRecurring = !!(wantsLongTerm && group && group.type !== 'recurring' && (group.weekdays || []).length > 0)

  const cmd = {
    intent: 'join',
    ok: !!(students.length && groupId),
    raw: line0,
    warnings: [],
    join: {
      students,
      groupId,
      groupCandidates: gm.candidates,
      groupCandidatesAll: groups.filter((g) => g.active),
      toRecurring,
      toRecurringAvailable: !!(group && group.type !== 'recurring' && (group.weekdays || []).length > 0),
    },
  }
  if (!gm.candidates.length) cmd.warnings.push('没识别到要加入的班课（试试写 班课名 或 周X+课程）')
  else if (gm.candidates.length > 1) cmd.warnings.push(`匹配到 ${gm.candidates.length} 个班课，请选择`)
  if (expired && !toRecurring) cmd.warnings.push(`该班课是限时班课（${group.endDate} 已结束），加入后不会生成新课次；可勾选"转为长期循环"`)
  return cmd
}

function parseQuery(line0, ctx) {
  const line = normalizeLine(line0)
  if (/谁.{0,6}续费|续费名单|该续费|待续费|预警/.test(line)) {
    return { intent: 'query', ok: true, raw: line0, query: { kind: 'renewal' }, warnings: [] }
  }
  // 查学生课时：必须带查询类关键词，避免"加入了Eason"被误判为查询
  if (/(还剩|剩余|剩多少|剩几节|多少课时|课时余额|余额|查一下|查询|看看|有多少)/.test(line)) {
    const ms = matchStudents(line.replace(/[还剩剩多多少少余课时节问下我看看查余额]/g, ' '), ctx.students)
    if (ms.matched[0]) {
      return { intent: 'query', ok: true, raw: line0, query: { kind: 'hours', studentId: ms.matched[0].id }, warnings: [] }
    }
  }
  // 查课表
  const dp = resolveDatePhrase(line, todayStr())
  if (/几节|什么课|课表|排了/.test(line)) {
    return {
      intent: 'query',
      ok: true,
      raw: line0,
      query: { kind: 'schedule', date: dp?.date || todayStr(), dateLabel: dp?.label || '今天' },
      warnings: [],
    }
  }
  return null
}

// —— 主入口 ——
export function parseAssistantInput(text, ctx) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const l = normalizeLine(line)
      // 1. 请假（先于点名，"请假"是关键词）
      if (/请假|告假/.test(l) && !/点名|全到|都到/.test(l)) {
        const c = parseLeave(line, ctx)
        if (c) return c
      }
      // 2. 点名
      if (/点名|全到|都到了?|都来了?|没来|没到|缺席/.test(l)) return parseAttendance(line, ctx)
      // 3. 学生入班（加入/插班 + 学生名单；含课时/元时优先按报名建档处理）
      if (/(加入|入班|插班|进班|一起上课)/.test(l) && !/(课时|元|赠送)/.test(l)) {
        const c = parseJoinGroup(line, ctx)
        if (c) return c
      }
      // 4. 查询
      const q = parseQuery(line, ctx)
      if (q) return q
      // 5. 报名学生（新报/报名/加入班 + 课时/金额）
      if (/(新报|新生|报名|入班|加入)/.test(l) && /(课时|元|赠)/.test(l)) return parseEnroll(line, ctx)
      // 6. 缴费/续费
      if (/(缴费|续费|课包|报了|购买)/.test(l) && /(课时|元|赠)/.test(l)) return parsePayment(line, ctx)
      // 7. 排课（复用文字排课解析）
      if (/每\s*(周|星期|礼拜)|周[一二三四五六日天]|星期[一二三四五六日天]|[0-9]{1,2}[.月][0-9]{1,2}/.test(l)) {
        const p = parseLine(line, { courses: ctx.courses, students: ctx.students, today: ctx.today })
        return { intent: 'schedule', ok: p.ok, raw: line, parsed: p, warnings: p.warnings }
      }
      // 8. 兜底：尝试按报班解析
      if (/(课时|元)/.test(l)) return parseEnroll(line, ctx)
      return {
        intent: 'unknown',
        ok: false,
        raw: line,
        warnings: ['没看懂这句话，试试：排课 / 报名学生 / 缴费 / 点名 / 请假 / 查课时'],
      }
    })
}

// ============================================================
// 大模型语义指令 → 内部指令对象（实体对号全在本地代码完成）
// LLM 只产出语义字段（名字/周几/时间/金额），这里复用既有的
// 学生/课程/班课匹配逻辑，产出与规则解析完全相同的指令结构，
// 因此确认卡片和执行器无需任何改动。
// ============================================================

const _str = (v) => (v == null ? '' : String(v).trim())
const _num = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}
const _intWeekday = (v) => {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v >= 1 && v <= 7) return v
  const m = String(v).match(/[一二三四五六日天]/)
  const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
  return m ? WD[m[0]] : null
}
const _normDate = (v, today) => {
  const s = _str(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (s) {
    const r = resolveDatePhrase(s, today)
    if (r) return r.date
  }
  return null
}
const _hm = (v) => {
  const s = _str(v)
  if (!s) return ''
  const m = s.match(/(\d{1,2})[:：](\d{2})/)
  if (!m) return ''
  return `${String(+m[1]).padStart(2, '0')}:${m[2]}`
}

function findStudentByName(name, students) {
  const t = _str(name)
  if (!t) return null
  const tl = t.toLowerCase()
  return (
    students.find((s) => s.name === t || (s.enName || '').toLowerCase() === tl) ||
    students.find((s) => s.name && t.length >= 2 && s.name.includes(t)) ||
    students.find((s) => s.enName && tl.length >= 2 && s.enName.toLowerCase().includes(tl)) ||
    null
  )
}

// 按提示（班课名/周几/时间/课程名）找班课候选
function findGroupsByHint(hint, groups, courses) {
  let cands = groups.filter((g) => g.active)
  let matched = false
  if (hint.groupName) {
    const gn = norm(hint.groupName)
    const byName = groups.filter((g) => {
      const n = norm(g.name)
      return n && (n.includes(gn) || gn.includes(n))
    })
    if (byName.length) {
      cands = byName
      matched = true
    }
  }
  if (hint.weekday != null) {
    const byWd = cands.filter((g) => (g.weekdays || []).includes(hint.weekday))
    if (byWd.length) {
      cands = byWd
      matched = true
    }
  }
  const course = hint.courseName ? matchCourse(hint.courseName, courses)?.course : null
  if (course?.id) {
    const byCourse = cands.filter((g) => g.courseId === course.id)
    if (byCourse.length) {
      cands = byCourse
      matched = true
    }
  }
  if (hint.time) {
    const t = parseHM(hint.time)
    if (t) {
      const near = cands.filter((g) => Math.abs(parseHM(g.startTime) - t) <= 30)
      if (near.length) {
        cands = near
        matched = true
      }
    }
  }
  return { matched, candidates: cands, course }
}

function matchStudentPair(name, enName, students) {
  let existing = null
  const n = _str(name)
  const en = _str(enName)
  if (n) {
    existing =
      students.find((s) => s.name === n) ||
      students.find((s) => s.name && n.length >= 2 && s.name.includes(n))
  }
  if (!existing && en) {
    const el = en.toLowerCase()
    existing =
      students.find((s) => s.enName && s.enName.toLowerCase() === el) ||
      students.find((s) => s.name && s.name.toLowerCase() === el) ||
      (el.length >= 3 ? students.find((s) => s.enName && s.enName.toLowerCase().includes(el)) : null)
  }
  const rename = !!(existing && n && /[一-龥]/.test(n) && existing.name !== n)
  return { name: n || existing?.name || '', enName: en || existing?.enName || '', existing: existing || null, rename }
}

// —— 主入口：LLM 语义指令数组 → 内部指令数组 ——
export function resolveLLMCommands(rawCommands, ctx) {
  const activeGroups = ctx.groups.filter((g) => g.active)
  return (rawCommands || []).map((c) => {
    try {
      return resolveOne(c, ctx, activeGroups)
    } catch (e) {
      return { intent: 'unknown', ok: false, raw: c?.explain || '', warnings: ['解析异常：' + (e.message || e)] }
    }
  })
}

function resolveOne(c, ctx, activeGroups) {
  const warnings = []
  const intent = _str(c.intent)

  // —— 报名建档 ——
  if (intent === 'enroll') {
    const name = _str(c.name)
    const existing = findStudentByName(name, ctx.students)
    const mc = _str(c.course) ? matchCourse(_str(c.course), ctx.courses) : null
    const course = mc?.course || null
    const weekday = _intWeekday(c.groupWeekday)
    const time = _hm(c.groupTime)
    const gm = findGroupsByHint({ weekday, time, courseName: _str(c.course) }, ctx.groups, ctx.courses)
    const price = _num(c.price)
    const formalHours = _num(c.formalHours)
    const giftHours = _num(c.giftHours)
    const cmd = {
      intent: 'enroll',
      ok: !!(name || existing),
      raw: c.explain || name,
      warnings,
      enroll: {
        name: existing ? existing.name : name,
        grade: _str(c.grade),
        existingStudent: !!existing,
        studentId: existing?.id || null,
        courseId: course?.id || null,
        courseName: course?.name || _str(c.course),
        courseNew: !course,
        price,
        formalHours: formalHours ?? 100,
        giftHours: giftHours ?? 0,
        weekday,
        weekdayLabel: weekday ? '周' + WEEK_CN[weekday % 7] : '',
        time,
        groupId: gm.candidates.length === 1 ? gm.candidates[0].id : null,
        groupCandidates: gm.candidates,
        groupCandidatesAll: activeGroups,
      },
    }
    if (!course && _str(c.course)) cmd.enroll.courseName = _str(c.course)
    if (!course) warnings.push(_str(c.course) ? '没匹配到已有课程，将新建课程' : '没识别到课程')
    if (price == null) warnings.push('没识别到缴费金额')
    if (formalHours == null) warnings.push('没识别到课时数，默认按100')
    if (!gm.candidates.length) warnings.push(weekday ? `没找到周${weekday}的班课，可不加入或先排课` : '没识别到要加入的班级')
    else if (gm.candidates.length > 1) warnings.push(`匹配到 ${gm.candidates.length} 个班课，请选择`)
    return cmd
  }

  // —— 缴费 ——
  if (intent === 'payment') {
    const stu = findStudentByName(_str(c.student), ctx.students)
    const mc = _str(c.course) ? matchCourse(_str(c.course), ctx.courses) : null
    const course = mc?.course || null
    const cmd = {
      intent: 'payment',
      ok: !!stu,
      raw: c.explain || '',
      warnings,
      payment: {
        studentId: stu?.id || null,
        studentName: stu?.name || _str(c.student),
        courseId: course?.id || null,
        courseName: course?.name || _str(c.course),
        courseNew: !course,
        price: _num(c.price),
        formalHours: _num(c.formalHours) ?? 100,
        giftHours: _num(c.giftHours) ?? 0,
      },
    }
    if (!stu) warnings.push('没识别到学生姓名（需已在系统里建档）')
    if (!course) warnings.push('没识别到课程')
    if (cmd.payment.price == null) warnings.push('没识别到缴费金额')
    return cmd
  }

  // —— 学生入班 ——
  if (intent === 'join') {
    const students = (c.students || [])
      .map((p) => matchStudentPair(_str(p?.name), _str(p?.enName), ctx.students))
      .filter((p) => p.name || p.enName)
    const gm = findGroupsByHint(
      { weekday: _intWeekday(c.groupWeekday), time: _hm(c.groupTime), groupName: _str(c.groupName), courseName: _str(c.course) },
      ctx.groups,
      ctx.courses
    )
    const groupId = gm.candidates.length === 1 ? gm.candidates[0].id : null
    const group = groupId ? ctx.groups.find((g) => g.id === groupId) : null
    const toRecurring = !!(c.toRecurring && group && group.type !== 'recurring' && (group.weekdays || []).length > 0)
    const cmd = {
      intent: 'join',
      ok: !!(students.length && groupId),
      raw: c.explain || '',
      warnings,
      join: {
        students,
        groupId,
        groupCandidates: gm.candidates,
        groupCandidatesAll: activeGroups,
        toRecurring,
        toRecurringAvailable: !!(group && group.type !== 'recurring' && (group.weekdays || []).length > 0),
      },
    }
    if (!students.length) warnings.push('没识别到学生')
    if (!gm.candidates.length) warnings.push('没识别到要加入的班课')
    else if (gm.candidates.length > 1) warnings.push(`匹配到 ${gm.candidates.length} 个班课，请选择`)
    return cmd
  }

  // —— 排课 ——
  if (intent === 'schedule') {
    const sch = c
    const type = ['recurring', 'limited', 'single'].includes(_str(sch.type)) ? _str(sch.type) : null
    const weekdays = Array.isArray(sch.weekdays)
      ? sch.weekdays.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 7)
      : []
    const startTime = _hm(sch.startTime)
    const endTime = _hm(sch.endTime)
    const ms = matchStudents(Array.isArray(sch.students) ? sch.students.join('、') : _str(sch.students), ctx.students)
    const mc = _str(sch.course) ? matchCourse(_str(sch.course), ctx.courses) : null
    const p = {
      raw: c.explain || '',
      ok: false,
      type,
      startDate: type === 'recurring' ? ctx.today : _normDate(sch.startDate, ctx.today),
      endDate: type === 'limited' ? _normDate(sch.endDate, ctx.today) : '',
      date: type === 'single' ? _normDate(sch.startDate, ctx.today) : '',
      weekdays,
      startTime,
      endTime: endTime && endTime > startTime ? endTime : minutesToText(parseHM(startTime || '18:00') + 120),
      hours: null,
      course: mc ? { id: mc.course.id, name: mc.course.name } : _str(sch.course) ? { id: null, name: _str(sch.course), __new: true } : null,
      students: ms.matched,
      unmatched: ms.unmatched,
      name: _str(sch.name),
      defaultPool: _str(sch.pool) === 'gift' ? 'gift' : 'formal',
      warnings: [],
    }
    if (p.startTime && p.endTime) {
      const h = hoursBetween(p.startTime, p.endTime)
      p.hours = h > 0 ? h : 2
    }
    // 比赛课自动识别 → 赠送池
    if (!p.defaultPool || p.defaultPool === 'formal') {
      if (isCompetitionName(p.name) || isCompetitionName(_str(sch.course))) {
        p.defaultPool = 'gift'
        p.warnings.push('🏆 识别为比赛课，消课池已自动选「赠送池」')
      }
    }
    p.ok = !!(p.startTime && p.type && (p.type === 'single' ? p.date : p.weekdays.length > 0))
    if (!p.startTime) p.warnings.push('未识别到上课时间')
    if (!p.course) p.warnings.push('未识别到课程')
    if (!p.ok) p.warnings.push('信息不完整，可在下方手动补充')
    return { intent: 'schedule', ok: p.ok, raw: c.explain || '', parsed: p, warnings: p.warnings }
  }

  // —— 点名 ——
  if (intent === 'attendance') {
    const date = _normDate(c.date, ctx.today) || ctx.today
    const dateLabel = date === ctx.today ? '今天' : date.slice(5).replace('-', '.')
    const hasGroupHint = !!(_str(c.groupName) || _intWeekday(c.groupWeekday) != null || _hm(c.groupTime))
    const exceptions = (c.exceptions || [])
      .map((e) => {
        const stu = findStudentByName(_str(e.name), ctx.students)
        return stu ? { studentId: stu.id, name: stu.name, status: _str(e.status) === 'absent' ? 'absent' : 'leave' } : null
      })
      .filter(Boolean)
    if (hasGroupHint) {
      const gm = findGroupsByHint(
        { groupName: _str(c.groupName), weekday: _intWeekday(c.groupWeekday), time: _hm(c.groupTime) },
        ctx.groups,
        ctx.courses
      )
      const groupId = gm.candidates.length === 1 ? gm.candidates[0].id : null
      const session = groupId
        ? ctx.sessions.find((s) => s.groupId === groupId && s.date === date && s.status !== 'cancelled') || null
        : null
      const cmd = {
        intent: 'attendance',
        ok: !!(groupId && session),
        raw: c.explain || '',
        warnings,
        attendance: {
          mode: 'single',
          date,
          dateLabel,
          groupId,
          groupCandidates: gm.candidates,
          groupCandidatesAll: activeGroups,
          sessionId: session?.id || null,
          sessionTime: session ? `${session.startTime}-${session.endTime}` : '',
          exceptions,
        },
      }
      if (!gm.candidates.length) warnings.push('没找到对应的班课')
      else if (gm.candidates.length > 1) warnings.push(`匹配到 ${gm.candidates.length} 个班课，请选择`)
      else if (!session) warnings.push(`该班课${dateLabel}（${date}）没有排课`)
      return cmd
    }
    const daySessions = ctx.sessions.filter((s) => s.date === date && s.status !== 'cancelled')
    const cmd = {
      intent: 'attendance',
      ok: daySessions.length > 0,
      raw: c.explain || '',
      warnings,
      attendance: { mode: 'date_all', date, dateLabel, excludeIds: [], exceptions },
    }
    if (!daySessions.length) warnings.push(`${dateLabel}（${date}）没有排课`)
    return cmd
  }

  // —— 请假 ——
  if (intent === 'leave') {
    const stu = findStudentByName(_str(c.student), ctx.students)
    const date = _normDate(c.date, ctx.today)
    let session = null
    let mode = 'next'
    if (stu) {
      const myGroupIds = ctx.groups
        .filter((g) => ctx.groupStudents.some((r) => r.groupId === g.id && r.studentId === stu.id))
        .map((g) => g.id)
      if (date) {
        session = ctx.sessions.find((s) => myGroupIds.includes(s.groupId) && s.date === date && s.status !== 'cancelled') || null
        mode = 'date'
      }
      if (!session) {
        session = ctx.sessions
          .filter((s) => myGroupIds.includes(s.groupId) && s.date >= ctx.today && s.status !== 'cancelled' && s.status !== 'completed')
          .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0]
        mode = 'next'
      }
    }
    const cmd = {
      intent: 'leave',
      ok: !!(stu && session),
      raw: c.explain || '',
      warnings,
      leave: {
        studentId: stu?.id || null,
        studentName: stu?.name || _str(c.student),
        sessionId: session?.id || null,
        date: session?.date || '',
        startTime: session?.startTime || '',
        mode,
      },
    }
    if (!stu) warnings.push('没识别到学生姓名')
    else if (!session) warnings.push('没找到该学生的课次')
    return cmd
  }

  // —— 查询 ——
  if (intent === 'query_hours') {
    const stu = findStudentByName(_str(c.student), ctx.students)
    return {
      intent: 'query',
      ok: !!stu,
      raw: c.explain || '',
      warnings: stu ? [] : ['没识别到学生姓名'],
      query: { kind: 'hours', studentId: stu?.id || null },
    }
  }
  if (intent === 'query_renewal') {
    return { intent: 'query', ok: true, raw: c.explain || '', warnings: [], query: { kind: 'renewal' } }
  }
  if (intent === 'query_schedule') {
    const date = _normDate(c.date, ctx.today) || ctx.today
    return {
      intent: 'query',
      ok: true,
      raw: c.explain || '',
      warnings: [],
      query: { kind: 'schedule', date, dateLabel: date === ctx.today ? '今天' : date.slice(5).replace('-', '.') },
    }
  }

  return { intent: 'unknown', ok: false, raw: c.explain || _str(c.intent), warnings: [c.explain || '没听懂这句话'] }
}
