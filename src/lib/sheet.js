import dayjs from 'dayjs'
import { hhmm } from './core'

// ============================================================
// 表格导入解析（Excel/WPS 集训计划表）
// 支持：粘贴 TSV（从 Excel 复制）、上传 .xlsx / .csv
// 识别列：节数 / 日期 / 星期 / 时间 / 课时 / 课程内容 / 地点
// ============================================================

const normHeader = (s) => String(s || '').toLowerCase().replace(/[\s:：()（）]/g, '')

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(normHeader)
    if (cells.some((c) => c === '日期' || c === 'date')) return i
  }
  return -1
}

function mapColumns(headerCells) {
  const map = {}
  headerCells.forEach((raw, idx) => {
    const c = normHeader(raw)
    if (!c) return
    if (map.date == null && ['日期', 'date'].includes(c)) map.date = idx
    else if (map.time == null && ['时间', 'time'].includes(c)) map.time = idx
    else if (map.hours == null && ['课时', '节数时', '小时', 'hours', '时长'].includes(c)) map.hours = idx
    else if (map.no == null && ['序号', '节数2', 'no', '#', '次数'].includes(c)) map.no = idx
    else if (map.no == null && /^节数$/.test(c)) map.no = idx
    else if (map.content == null && ['课程内容', '内容', '训练内容', 'content'].includes(c)) map.content = idx
    else if (map.location == null && ['地点', '位置', 'location'].includes(c)) map.location = idx
  })
  return map
}

function findTitle(rows, headerIdx) {
  for (let i = 0; i < headerIdx; i++) {
    const joined = rows[i].filter(Boolean).join(' ')
    if (joined && joined.length >= 4) return joined.trim()
  }
  return ''
}

function findTotalHours(rows, headerIdx) {
  for (let i = headerIdx + 1; i < rows.length; i++) {
    for (const cell of rows[i]) {
      const m = String(cell || '').match(/总课时[:：]?\s*([0-9.]+)/)
      if (m) return parseFloat(m[1])
    }
  }
  return null
}

// Excel 日期序列号 → YYYY-MM-DD
function excelSerialToYMD(v) {
  // Excel epoch 1899-12-30
  const d = dayjs('1899-12-30').add(Math.round(v), 'day')
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}

export function parseDateCell(v) {
  if (v == null || v === '') return { date: '', text: '' }
  if (v instanceof Date && !isNaN(v)) {
    return { date: dayjs(v).format('YYYY-MM-DD'), text: dayjs(v).format('YYYY-MM-DD') }
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = excelSerialToYMD(v)
    return { date: d, text: d || String(v) }
  }
  const s = String(v).trim()
  let m = s.match(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})\s*日?/)
  if (m) {
    const d = dayjs(new Date(+m[1], +m[2] - 1, +m[3]))
    return { date: d.format('YYYY-MM-DD'), text: s }
  }
  m = s.match(/(\d{1,2})\s*[.月]\s*(\d{1,2})\s*日?/)
  if (m) {
    const now = dayjs()
    let y = now.year()
    if (+m[1] < now.month() + 1) y += 1
    const d = dayjs(new Date(y, +m[1] - 1, +m[2]))
    return { date: d.format('YYYY-MM-DD'), text: s }
  }
  return { date: '', text: s }
}

// 时间格："17:20-19:20" / "9:00~11:00" / "16：00—18：00" / "全天比赛"
export function parseTimeCell(v) {
  const s = String(v || '').trim()
  if (!s) return { startTime: '', endTime: '', text: '' }
  const m = s.match(/(\d{1,2})\s*[:：点]\s*(\d{1,2})?\s*[~～\-–—至到]\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?/)
  if (m) {
    const pad = (n) => String(n).padStart(2, '0')
    const start = `${pad(+m[1])}:${pad(+(m[2] ?? 0))}`
    const end = `${pad(+m[3])}:${pad(+(m[4] ?? 0))}`
    return { startTime: start, endTime: end, text: s }
  }
  const single = s.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/)
  if (single) {
    const pad = (n) => String(n).padStart(2, '0')
    return { startTime: `${pad(+single[1])}:${pad(+single[2])}`, endTime: '', text: s }
  }
  return { startTime: '', endTime: '', text: s } // 如"全天比赛"
}

export function parseHoursCell(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v > 0 ? v : null
  const m = String(v).match(/([0-9]+(?:\.[0-9]+)?)/)
  return m ? parseFloat(m[1]) : null
}

// —— 主入口：rows 为二维数组 ——
export function parseSheetRows(rows) {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { ok: false, error: '没找到表头行（需要包含"日期"列）', rows: [] }

  const cols = mapColumns(rows[headerIdx])
  if (cols.date == null) return { ok: false, error: '表头中未识别到"日期"列', rows: [] }

  const title = findTitle(rows, headerIdx)
  const totalHoursCell = findTotalHours(rows, headerIdx)

  const out = []
  let last = { hours: null, content: '', location: '', timeText: '', startTime: '', endTime: '' }
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const dateInfo = parseDateCell(row[cols.date])
    if (!dateInfo.date) continue // 空行/合计行
    // 时间
    let timeInfo = cols.time != null ? parseTimeCell(row[cols.time]) : { startTime: '', endTime: '', text: '' }
    const timeEmpty = !timeInfo.startTime && !timeInfo.text
    if (timeEmpty && last.startTime) timeInfo = { ...last, text: last.timeText } // 合并格向下填充
    // 课时（合并格向下填充并做标记）
    let hours = cols.hours != null ? parseHoursCell(row[cols.hours]) : null
    let hoursFilled = false
    if (hours == null && last.hours != null) {
      hours = last.hours
      hoursFilled = true
    }
    // 内容 / 地点（向下填充）
    let content = cols.content != null ? String(row[cols.content] || '').trim() : ''
    if (!content && last.content) content = last.content
    let location = cols.location != null ? String(row[cols.location] || '').trim() : ''
    if (!location && last.location) location = last.location

    const no = cols.no != null ? String(row[cols.no] || '').trim() : String(out.length + 1)
    out.push({
      key: `${i}`,
      no,
      date: dateInfo.date,
      startTime: timeInfo.startTime || '',
      endTime: timeInfo.endTime || '',
      timeText: timeInfo.text || '',
      hours: hours ?? 2,
      hoursFilled,
      content: content || '',
      location: location || '',
      include: true,
    })
    last = { hours, content, location, timeText: timeInfo.text, startTime: timeInfo.startTime, endTime: timeInfo.endTime }
  }

  if (!out.length) return { ok: false, error: '表格里没有解析到有效课次（检查日期列）', rows: [] }

  const sum = out.reduce((acc, r) => acc + (Number(r.hours) || 0), 0)
  return {
    ok: true,
    title,
    rows: out,
    totalHoursCell,
    sumHours: Math.round(sum * 100) / 100,
    warnings: hoursFilledNote(out),
  }
}

function hoursFilledNote(rows) {
  const w = []
  const filled = rows.filter((r) => r.hoursFilled).length
  if (filled > 0) w.push(`有 ${filled} 行的课时是沿用上一行填写的（原表可能是合并单元格），请在预览中核对`)
  const noTime = rows.filter((r) => !r.startTime && r.timeText).length
  if (noTime > 0) w.push(`有 ${noTime} 行未识别到具体时间（如"全天比赛"），生成后可手动补充`)
  return w
}

// TSV → 二维数组（处理引号包裹）
export function tsvToRows(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l, i, arr) => l.trim() !== '' || i < arr.length - 1)
  return lines.map((line) => {
    const cells = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
        } else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === '\t') { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    return cells
  })
}
