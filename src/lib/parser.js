import dayjs from 'dayjs'
import { addDays, todayStr, isCompetitionName } from './core'

// ============================================================
// 文字排课解析器
// 支持示例：
//   每周四 18:00-20:00 vexIQ：王小明、Alina、Eason
//   每周六 9:00-11:00 vexgo：何远航、高晓菲、谢浩然、林志强
//   10.1~10.19 每周五、周六 18:00-20:00 vexiq 赛前集训：张三、李四
//   未来3周 每周五 17:20-19:20 vexiq 集训：张三
//   10.15 17:20-19:20 vexiq 加课：张三
//   每周四 晚上6点到8点 python：张三 和 李四
// ============================================================

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const WD_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
const STOP_WORDS = new Set([
  '加课', '补课', '临时课', '临时', '体验课', '试听', '试听课', '课', '上课', '正式课',
  '训练', '集训', '集训课', '比赛', '模拟赛', '模拟比赛', '班', '课包', '赠送', '赠送课',
])

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '')

const ampmShift = (w, h) => {
  h = +h
  if (!w) return h
  if (w === '晚上' || w === '下午' || w === '中午') return h < 12 ? h + 12 : h
  return h // 早上/上午/凌晨
}

// —— 时间解析（在日期之后执行）——
export function parseTime(text) {
  // 形式1：H:MM-H:MM（可带时段词）
  let m = text.match(
    /([上下]午|早上|中午|晚上|凌晨)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[~～\-–—至到]\s*([上下]午|早上|中午|晚上|凌晨)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2}))?/
  )
  if (m && m[2] != null) {
    const seg = (w, h, min) => ampmShift(w, h) * 60 + (+min || 0)
    const start = seg(m[1], m[2], m[3])
    const end = m[5] != null ? seg(m[4] || m[1], m[5], m[6]) : null
    return { start, end, consumed: m[0] }
  }
  // 形式2：X点[半|MM][到Y点[半|MM]]（可带时段词）
  m = text.match(
    /([上下]午|早上|中午|晚上|凌晨)?\s*(\d{1,2})\s*点\s*(半|\d{1,2})?\s*分?(?:\s*[~～\-–—至到]\s*([上下]午|早上|中午|晚上|凌晨)?\s*(\d{1,2})\s*点\s*(半|\d{1,2})?\s*分?)?/
  )
  if (m && /点/.test(m[0])) {
    const minOf = (x) => (x === '半' ? 30 : +x || 0)
    const start = ampmShift(m[1], m[2]) * 60 + minOf(m[3])
    const end = m[5] != null ? ampmShift(m[4] || m[1], m[5]) * 60 + minOf(m[6]) : null
    return { start, end, consumed: m[0] }
  }
  // 形式3：裸数字区间 9-11 / 18~20（仅当整行没有冒号和"点"）
  if (!/[:：点]/.test(text)) {
    m = text.match(/(\d{1,2})\s*[~～\-–—]\s*(\d{1,2})/)
    if (m) {
      const a = +m[1]
      const b = +m[2]
      if (a >= 6 && a <= 23 && b >= 6 && b <= 23 && b > a) {
        return { start: a * 60, end: b * 60, consumed: m[0] }
      }
    }
  }
  return null
}

export const minutesToText = (mins) => {
  if (mins == null || isNaN(mins)) return ''
  if (mins >= 1440) return '23:59'
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// —— 日期解析 ——
function ymd({ y, m, d }) {
  const now = dayjs()
  let year = y ? parseInt(y, 10) : now.year()
  if (!y && m < now.month() + 1) year += 1 // 没写年份且月份已过 → 按明年
  const dd = dayjs(new Date(year, m - 1, d))
  return dd.isValid() ? dd.format('YYYY-MM-DD') : null
}

function parseDates(text) {
  // 未来N周
  let m = text.match(/(?:未来|接下来|今后)\s*([0-9一二两三四五六七八九十]+)\s*周/)
  if (m) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : CN_NUM[m[1]] || 1
    return { kind: 'range', start: todayStr(), end: addDays(todayStr(), n * 7 - 1), consumed: m[0] }
  }
  // 区间：10.1~10.19 / 10月1日到10月19日 / 2026-10-1 至 2026-10-19
  m = text.match(
    /(?:(\d{4})\s*[-./年]\s*)?(\d{1,2})\s*[.月]\s*(\d{1,2})\s*日?\s*[~～\-–—至到]\s*(?:(\d{4})\s*[-./年]\s*)?(\d{1,2})\s*[.月]\s*(\d{1,2})\s*日?/
  )
  if (m) {
    const start = ymd({ y: m[1], m: +m[2], d: +m[3] })
    const end = ymd({ y: m[4] || m[1], m: +m[5], d: +m[6] })
    if (start && end && start <= end) return { kind: 'range', start, end, consumed: m[0] }
  }
  // 完整日期 2026-10-15
  m = text.match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*日?/)
  if (m) {
    const d = ymd({ y: m[1], m: +m[2], d: +m[3] })
    if (d) return { kind: 'single', date: d, consumed: m[0] }
  }
  // 短日期 10.15 / 10月15日
  m = text.match(/(\d{1,2})\s*[.月]\s*(\d{1,2})\s*日?/)
  if (m) {
    const d = ymd({ m: +m[1], d: +m[2] })
    if (d) return { kind: 'single', date: d, consumed: m[0] }
  }
  return null
}

function parseWeekdays(text) {
  const isRecurring = /每\s*(周|星期|礼拜)/.test(text)
  const re = /(周|星期|礼拜)\s*([一二三四五六日天])/g
  const set = new Set()
  let hit
  while ((hit = re.exec(text))) set.add(WD_MAP[hit[2]])
  return { isRecurring, weekdays: [...set] }
}

// —— 课程解析 ——
const COURSE_ALIAS = [
  { re: /vex\s*-?\s*iq/i, name: 'VEX IQ' },
  { re: /vex\s*-?\s*go/i, name: 'VEX GO' },
  { re: /vex\s*-?\s*v5/i, name: 'VEX V5' },
  { re: /python/i, name: 'Python' },
  { re: /scratch/i, name: 'Scratch' },
  { re: /c\+\+|cpp/i, name: 'C++' },
  { re: /\bev3\b|ev3/i, name: 'EV3' },
  { re: /spike/i, name: 'Spike' },
  { re: /we-?do|wedo/i, name: 'WeDo' },
  { re: /arduino/i, name: 'Arduino' },
]
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function matchCourse(rest, courses) {
  for (const c of courses) {
    if (!c.name) continue
    const re = new RegExp(escapeRe(c.name).replace(/\s+/g, '\\s*'), 'i')
    const m = rest.match(re)
    if (m) return { course: { id: c.id, name: c.name }, consumed: m[0] }
  }
  for (const a of COURSE_ALIAS) {
    const m = rest.match(a.re)
    if (m) {
      const exist = courses.find((c) => norm(c.name) === norm(a.name))
      return {
        course: exist ? { id: exist.id, name: exist.name } : { id: null, name: a.name, __new: true },
        consumed: m[0],
      }
    }
  }
  return null
}

// —— 学生解析 ——
export function matchStudents(text, students) {
  const cleaned = String(text || '').replace(/[和及与]/g, '、')
  const parts = cleaned.split(/[,，、\/\s]+/).map((s) => s.trim()).filter(Boolean)
  const matched = []
  const unmatched = []
  for (const p of parts) {
    if (/^\d+$/.test(p) || STOP_WORDS.has(p)) continue
    const pl = p.toLowerCase()
    const hit = students.find(
      (s) =>
        (s.name && s.name === p) ||
        (s.enName && s.enName.toLowerCase() === pl) ||
        (s.name && p.length >= 2 && s.name.includes(p)) ||
        (s.enName && pl.length >= 2 && s.enName.toLowerCase().includes(pl))
    )
    if (hit) {
      if (!matched.find((x) => x.id === hit.id)) matched.push(hit)
    } else unmatched.push(p)
  }
  return { matched, unmatched }
}

// —— 单行解析 ——
export function parseLine(line, { courses = [], students = [], today = todayStr() } = {}) {
  const result = {
    raw: line,
    ok: false,
    type: null, // recurring | limited | single
    startDate: '', endDate: '', date: '',
    weekdays: [],
    startTime: '', endTime: '',
    hours: null,
    course: null, // {id?, name, __new?}
    students: [],
    unmatched: [],
    name: '',
    defaultPool: 'formal',
    warnings: [],
  }
  if (!line.trim()) return result

  let rest = ' ' + line + ' '

  // 1. 日期（先于时间，避免区间里的数字被当成时刻）
  const dates = parseDates(rest)
  if (dates) {
    rest = rest.replace(dates.consumed, ' ')
    if (dates.kind === 'range') {
      result.startDate = dates.start
      result.endDate = dates.end
    } else result.date = dates.date
  }

  // 2. 星期
  const wd = parseWeekdays(rest)
  if (wd.weekdays.length) {
    result.weekdays = wd.weekdays
    rest = rest.replace(/每?\s*(周|星期|礼拜)\s*[一二三四五六日天]/g, ' ')
  }

  // 3. 时间
  const time = parseTime(rest)
  if (time && time.start != null && !isNaN(time.start)) {
    result.startTime = minutesToText(time.start)
    result.endTime =
      time.end != null && time.end > time.start
        ? minutesToText(time.end)
        : minutesToText(time.start + 120) // 未识别结束时间 → 默认2小时
    rest = rest.replace(time.consumed, ' ')
  }

  // 4. 类型
  const hasEvery = wd.isRecurring && wd.weekdays.length > 0
  if (hasEvery && result.startDate && result.endDate) result.type = 'limited'
  else if (hasEvery) {
    result.type = 'recurring'
    result.startDate = result.startDate || today
  } else if (result.startDate && result.endDate) result.type = 'limited'
  else if (result.date) result.type = 'single'

  // 5. 关键词 → 消课池 / 名称（比赛课自动扣赠送池）
  if (/赠送|赠课|赠/.test(line) || isCompetitionName(line)) result.defaultPool = 'gift'
  const nameHit = rest.match(/[\u4e00-\u9fa5A-Za-z0-9]*?(?:集训|训练营|特训|模拟赛)[\u4e00-\u9fa5A-Za-z0-9]*/)
  if (nameHit) result.name = nameHit[0]

  // 6. 课程
  const mc = matchCourse(rest, courses)
  if (mc) {
    result.course = mc.course.id
      ? { id: mc.course.id, name: mc.course.name }
      : { id: null, name: mc.course.name, __new: !!mc.course.__new }
    const idx = rest.toLowerCase().lastIndexOf(String(mc.consumed).toLowerCase())
    if (idx >= 0) rest = rest.slice(0, idx) + ' ' + rest.slice(idx + mc.consumed.length)
  }

  // 7. 学生名单
  let namePart = rest
  const colonIdx = rest.search(/[：:]/)
  let before = ''
  if (colonIdx >= 0) {
    before = rest.slice(0, colonIdx).trim()
    namePart = rest.slice(colonIdx + 1)
  }
  const ms = matchStudents(namePart, students)
  result.students = ms.matched
  result.unmatched = ms.unmatched

  // 8. 班课名称
  if (!result.name && before) {
    const b = before.replace(/[，,。、\s]+$/, '').trim()
    const sameAsCourse = result.course && norm(b) === norm(result.course.name)
    if (b && !sameAsCourse && b.length <= 30) result.name = b
  }
  if (!result.name) {
    const wdLabel = (result.weekdays || []).map((n) => '周' + '一二三四五六日'[(n - 1) % 7]).join('')
    const dateLabel = result.type === 'single' && result.date ? result.date.slice(5).replace('-', '.') : ''
    result.name = [result.course?.name || '班课', wdLabel || dateLabel].filter(Boolean).join(' · ')
  }

  // 9. 课时
  if (result.startTime && result.endTime) {
    const [sh, sm] = result.startTime.split(':').map(Number)
    const [eh, em] = result.endTime.split(':').map(Number)
    const h = (eh * 60 + em - (sh * 60 + sm)) / 60
    result.hours = h > 0 ? h : 2
  }

  result.ok =
    !!result.startTime &&
    !!result.type &&
    (result.type === 'single'
      ? !!result.date
      : result.weekdays.length > 0 && !!(result.startDate || result.type === 'recurring'))

  if (!result.startTime) result.warnings.push('未识别到上课时间')
  if (!result.course) result.warnings.push('未识别到课程')
  if (!result.ok) result.warnings.push('信息不完整，可在下方手动补充')
  return result
}

export function parseScheduleText(text, ctx) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseLine(l, ctx))
}
