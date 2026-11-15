import dayjs from 'dayjs'

// ---------- 基础常量 ----------
export const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
export const DEFAULT_SETTINGS = {
  orgName: '光明教务',
  renewalThreshold: 20,   // 剩余课时低于该值提醒续费
  deductOnLeave: false,   // 请假是否扣课时
  deductOnAbsent: false,  // 缺席是否扣课时
  defaultHours: 2,        // 默认单节课时长
}
export const STATUS_LABEL = { present: '到课', leave: '请假', absent: '缺席', makeup: '补课' }
export const GROUP_TYPE_LABEL = { recurring: '长期循环', limited: '限时班课', single: '单次课' }

// 比赛课识别：名字/内容命中即默认扣赠送池（可手动改）
export const COMPETITION_RE =
  /(城市赛|华南赛|国赛|省赛|全国赛|地区赛|区域赛|世锦赛|世界赛|锦标赛|公开赛|邀请赛|对抗赛|友谊赛|精英赛|大师赛|比赛日|全天比赛|正式比赛)/
export const isCompetitionName = (s) => COMPETITION_RE.test(s || '')

// ---------- 日期 ----------
export const todayStr = () => dayjs().format('YYYY-MM-DD')
export const nowHM = () => dayjs().format('HH:mm')

export const fmtDate = (d) => {
  const dd = dayjs(d)
  return `${dd.month() + 1}.${dd.date()} 周${WEEK_CN[dd.day()]}`
}
export const fmtDateFull = (d) => {
  const dd = dayjs(d)
  return `${dd.year()}年${dd.month() + 1}月${dd.date()}日 周${WEEK_CN[dd.day()]}`
}
export const fmtMonth = (d) => dayjs(d).format('YYYY-MM')

// ISO 周几：1=周一 ... 7=周日
export const isoWeekday = (d) => (dayjs(d).day() + 6) % 7 + 1
// 本周周一
export const weekStart = (d) => {
  const dd = dayjs(d)
  return dd.add(-((dd.day() + 6) % 7), 'day').format('YYYY-MM-DD')
}
export const addDays = (d, n) => dayjs(d).add(n, 'day').format('YYYY-MM-DD')
export const weekdayLabel = (nums) =>
  (nums || []).map((n) => '周' + WEEK_CN[n % 7]).join('、')

// ---------- 时间 / 课时 ----------
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '')
export const parseHM = (t) => {
  if (!t) return 0
  const [h, m] = String(t).split(':').map((x) => parseInt(x, 10) || 0)
  return h * 60 + (m || 0)
}
export const minutesToHM = (mins) => {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const hoursBetween = (start, end) => Math.max(0, (parseHM(end) - parseHM(start)) / 60)
export const hoursFmt = (n) => {
  const r = Math.round((Number(n) || 0) * 100) / 100
  return Number.isInteger(r) ? String(r) : String(r)
}
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ---------- 金额 ----------
export const money = (n) => {
  const v = round2(n)
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
export const unitPrice = (pkg) => {
  if (!pkg || pkg.kind !== 'formal') return 0
  const total = Number(pkg.totalHours) || 0
  return total > 0 ? round2((Number(pkg.price) || 0) / total) : 0
}

// ---------- 通用 ----------
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2))
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
export const remaining = (pkg) => (Number(pkg?.totalHours) || 0) - (Number(pkg?.usedHours) || 0)
