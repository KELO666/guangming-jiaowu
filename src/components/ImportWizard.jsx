import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, ClipboardPaste, ArrowLeft, Check, Info, AlertTriangle } from 'lucide-react'
import { useApp } from '../store'
import { parseSheetRows, tsvToRows } from '../lib/sheet'
import { hoursFmt, round2, isCompetitionName } from '../lib/core'
import { sessionsOverlap } from '../lib/logic'
import { Badge, Button, Field, Input, Modal, Select, cn } from '../ui'
import RosterPicker from './RosterPicker'

// ============================================================
// 表格导入向导：粘贴 Excel 区域 或 上传 xlsx/csv → 预览确认 → 生成班课
// ============================================================
export default function ImportWizard({ open, onClose }) {
  const { db, create, createMany, toast, confirm } = useApp()
  const [step, setStep] = useState('input') // input | preview
  const [pasteText, setPasteText] = useState('')
  const [parsed, setParsed] = useState(null) // parseSheetRows 结果
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ name: '', courseId: '', newCourseName: '', pool: 'formal' })
  const [roster, setRoster] = useState([])
  const fileRef = useRef(null)

  const reset = () => {
    setStep('input')
    setPasteText('')
    setParsed(null)
    setError('')
    setRows([])
    setMeta({ name: '', courseId: '', newCourseName: '', pool: 'formal' })
    setRoster([])
  }

  const runParse = (rows2d) => {
    const r = parseSheetRows(rows2d)
    if (!r.ok) {
      setError(r.error)
      setParsed(null)
      return
    }
    setError('')
    setParsed(r)
    setRows(
      r.rows.map((x) => {
        const row = { ...x }
        // 比赛课自动识别：内容命中（全天比赛/城市赛…）→ 赠送池
        row.pool = isCompetitionName(row.content) ? 'gift' : 'formal'
        return row
      })
    )
    const giftRows = r.rows.filter((x) => isCompetitionName(x.content)).length
    if (giftRows > 0) r.warnings.push(`已自动把 ${giftRows} 场比赛课（内容含"比赛/XX赛"）设为赠送池，可在表格中修改`)
    setMeta((m) => ({
      ...m,
      name: r.title || '集训班课',
      courseId: db.courses[0]?.id || '',
    }))
    setStep('preview')
  }

  const onPaste = () => {
    if (!pasteText.trim()) return setError('请先从 Excel/WPS 复制表格区域，再粘贴到这里')
    runParse(tsvToRows(pasteText))
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows2d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      runParse(rows2d)
    } catch (err) {
      setError('文件解析失败：' + (err.message || err))
    }
    e.target.value = ''
  }

  // 合并格区块检测：连续的 hoursFilled 行
  const blocks = useMemo(() => {
    const out = []
    let cur = null
    rows.forEach((r, i) => {
      if (!r.include) return
      if (r.hoursFilled) {
        if (!cur) cur = { start: i, end: i, hours: r.hours }
        else cur.end = i
      } else {
        if (cur) out.push(cur)
        cur = null
      }
    })
    if (cur) out.push(cur)
    return out
  }, [rows])

  const mergeBlock = (b) => {
    setRows((rs) =>
      rs.map((r, i) =>
        i >= b.start && i <= b.end
          ? i === b.start
            ? { ...r, hours: b.hours, merged: true, content: r.content + (r.content ? '' : '（合并自连续多行）') }
            : { ...r, include: false, mergedInto: b.start }
          : r
      )
    )
  }
  const unmergeBlock = (b) => {
    setRows((rs) =>
      rs.map((r, i) =>
        i >= b.start && i <= b.end ? { ...r, include: true, merged: false, mergedInto: null } : r
      )
    )
  }

  const includeRows = rows.filter((r) => r.include)
  const sumHours = round2(includeRows.reduce((a, r) => a + (Number(r.hours) || 0), 0))
  const pastCount = includeRows.filter((r) => r.date < new Date().toISOString().slice(0, 10)).length

  // 冲突检测：导入的课与已排课次重叠
  const conflicts = useMemo(() => {
    const existing = db.sessions
      .filter((s) => s.status !== 'cancelled')
      .map((s) => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        label: db.groups.find((g) => g.id === s.groupId)?.name || s.content || '课程',
      }))
    const out = []
    for (const r of includeRows) {
      const row = { date: r.date, startTime: r.startTime, endTime: r.endTime, label: meta.name }
      for (const e of existing) {
        if (sessionsOverlap(row, e)) {
          out.push(`${r.date.slice(5)} ${r.startTime || '全天'} 与已排《${e.label}》${e.date.slice(5)} ${e.startTime}-${e.endTime} 冲突`)
          break
        }
      }
    }
    return out
  }, [includeRows, db.sessions, db.groups, meta.name])

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const submit = async () => {
    if (!includeRows.length) return toast('没有可生成的课次', 'error')
    if (conflicts.length > 0) {
      const ok = await confirm(
        '存在时间冲突',
        `${conflicts.slice(0, 8).join('\n')}${conflicts.length > 8 ? `\n…等共 ${conflicts.length} 处冲突` : ''}\n\n同一个老师同一时段上两节课，确定仍要这样排吗？`,
        true
      )
      if (!ok) return
    }
    try {
      let courseId = meta.courseId
      if (!courseId && meta.newCourseName.trim()) {
        const c = await create('courses', { name: meta.newCourseName.trim(), color: '#7c3aed' })
        courseId = c.id
      }
      if (!courseId) return toast('请选择课程', 'error')
      const dates = includeRows.map((r) => r.date).sort()
      const g = await create('groups', {
        name: meta.name.trim() || '集训班课',
        courseId,
        type: 'limited',
        weekdays: [],
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        startTime: includeRows[0].startTime || '09:00',
        endTime: includeRows[0].endTime || '11:00',
        hours: includeRows[0].hours || 2,
        defaultPool: meta.pool,
        location: includeRows[0].location || '',
        notes: '',
        active: true,
      })
      if (roster.length) await createMany('groupStudents', roster.map((sid) => ({ groupId: g.id, studentId: sid })))
      await createMany(
        'sessions',
        includeRows.map((r) => ({
          groupId: g.id,
          courseId,
          date: r.date,
          startTime: r.startTime || '09:00',
          endTime: r.endTime || '11:00',
          hours: Number(r.hours) || 2,
          content: r.content,
          location: r.location,
          pool: r.pool || meta.pool,
          status: 'scheduled',
        }))
      )
      toast(`已生成「${g.name}」：${includeRows.length} 节课${pastCount ? `（${pastCount} 节已过期，可补点名）` : ''}`)
      onClose()
      reset()
    } catch (e) {
      toast(e.message || '生成失败', 'error')
    }
  }

  return (
    <Modal open={open} onClose={() => { onClose(); reset() }} title="导入课程表格" width="max-w-3xl">
      {step === 'input' && (
        <div>
          <div className="rounded-2xl bg-blue-50/70 p-3.5 text-[13px] leading-relaxed text-blue-800">
            <Info size={14} className="mr-1 inline" />
            直接打开你的集训计划 Excel，框选表格区域复制，粘贴到下面即可。识别「日期 / 时间 / 课时 / 课程内容 / 地点」，
            合并单元格会自动向下填充，生成前可逐行修改。
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={7}
            className="mt-3 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder={'节数\t日期\t星期\t时间\t课时\t课程内容\t地点\n1\t2026-10-15\t星期四\t17:20-19:20\t2\t新机型操作训练\t光明校区\n2\t...'}
          />
          {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={onPaste}>
              <ClipboardPaste size={16} /> 解析粘贴内容
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> 上传 .xlsx / .csv
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </div>
        </div>
      )}

      {step === 'preview' && parsed && (
        <div>
          <button onClick={() => setStep('input')} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
            <ArrowLeft size={15} /> 重新导入
          </button>

          {/* 基础设置 */}
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-4">
            <Field label="班课名称 *" className="col-span-2">
              <Input value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
            </Field>
            <Field label="课程 *">
              <Select value={meta.courseId} onChange={(e) => setMeta((m) => ({ ...m, courseId: e.target.value }))}>
                <option value="">＋ 新课程</option>
                {db.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {meta.courseId === '' ? (
              <Field label="新课程名称">
                <Input value={meta.newCourseName} onChange={(e) => setMeta((m) => ({ ...m, newCourseName: e.target.value }))} />
              </Field>
            ) : (
              <Field label="默认消课池">
                <Select value={meta.pool} onChange={(e) => setMeta((m) => ({ ...m, pool: e.target.value }))}>
                  <option value="formal">正式池</option>
                  <option value="gift">赠送池</option>
                </Select>
              </Field>
            )}
            <div className="col-span-2 sm:col-span-4">
              <div className="mb-1.5 text-[13px] font-medium text-slate-500">
                学员名单（这批课都扣这些学生的课包，{roster.length} 人）
              </div>
              <RosterPicker value={roster} onChange={setRoster} />
            </div>
          </div>

          {/* 合并格提示 */}
          {blocks.length > 0 && (
            <div className="mt-3 space-y-2">
              {blocks.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  <span>
                    第 {b.start + 1}~{b.end + 1} 行课时是合并格（每行 {hoursFmt(b.hours)}，共{' '}
                    {hoursFmt(round2(b.hours * (b.end - b.start + 1)))}）
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button size="xs" variant="outline" onClick={() => unmergeBlock(b)}>
                      每天各 {hoursFmt(b.hours)}
                    </Button>
                    <Button size="xs" variant="soft" onClick={() => mergeBlock(b)}>
                      合并为一次课（共 {hoursFmt(b.hours)}）
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 课次表格 */}
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-2 py-2">日期</th>
                  <th className="px-2 py-2">开始</th>
                  <th className="px-2 py-2">结束</th>
                  <th className="px-2 py-2">课时</th>
                  <th className="px-2 py-2">内容</th>
                  <th className="px-2 py-2">地点</th>
                  <th className="px-2 py-2">消课池</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => r.include).map((r) => (
                  <tr key={r.key} className="border-b border-slate-50">
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={r.date}
                        onChange={(e) => setRow(r.key, { date: e.target.value })}
                        className="h-8 w-[130px] rounded-lg border border-slate-200 px-2 text-xs"
                      />
                      {r.date < new Date().toISOString().slice(0, 10) && (
                        <Badge tone="gray" className="ml-1">
                          已过
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="time"
                        value={r.startTime}
                        onChange={(e) => setRow(r.key, { startTime: e.target.value })}
                        className="h-8 w-[100px] rounded-lg border border-slate-200 px-2 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="time"
                        value={r.endTime}
                        onChange={(e) => setRow(r.key, { endTime: e.target.value })}
                        className="h-8 w-[100px] rounded-lg border border-slate-200 px-2 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={r.hours}
                        onChange={(e) => setRow(r.key, { hours: e.target.value, hoursFilled: false })}
                        className={cn('h-8 w-16 rounded-lg border px-2 text-center text-xs', r.hoursFilled ? 'border-amber-300 bg-amber-50' : 'border-slate-200')}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.content}
                        onChange={(e) => setRow(r.key, { content: e.target.value })}
                        className="h-8 w-full min-w-[120px] rounded-lg border border-slate-200 px-2 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.location}
                        onChange={(e) => setRow(r.key, { location: e.target.value })}
                        className="h-8 w-full min-w-[100px] rounded-lg border border-slate-200 px-2 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={r.pool || meta.pool}
                        onChange={(e) => setRow(r.key, { pool: e.target.value })}
                        className="h-8 rounded-lg border border-slate-200 px-1.5 text-xs"
                      >
                        <option value="formal">正式池</option>
                        <option value="gift">赠送池</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {parsed.warnings?.length > 0 && (
            <div className="mt-3 space-y-1">
              {parsed.warnings.map((w, i) => (
                <div key={i} className="text-xs text-amber-600">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3.5">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-red-600">
                <AlertTriangle size={14} /> 检测到 {conflicts.length} 处时间冲突
              </div>
              <div className="space-y-0.5 text-xs text-red-500">
                {conflicts.slice(0, 6).map((d, i) => (
                  <div key={i}>{d}</div>
                ))}
                {conflicts.length > 6 && <div>…等共 {conflicts.length} 处</div>}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-500">
              共 <b>{includeRows.length}</b> 节 · 合计 <b className="text-blue-600">{hoursFmt(sumHours)}</b> 课时
            </span>
            {parsed.totalHoursCell != null && Math.abs(sumHours - parsed.totalHoursCell) > 0.01 && (
              <span className="text-xs text-amber-600">（表尾标注总课时 {hoursFmt(parsed.totalHoursCell)}，与逐行合计不一致，请核对）</span>
            )}
            {pastCount > 0 && <span className="text-xs text-slate-400">其中 {pastCount} 节已过期，生成后可补点名</span>}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep('input')}>
              上一步
            </Button>
            <Button onClick={submit} disabled={!includeRows.length}>
              <Check size={16} /> 确认生成 {includeRows.length} 节课
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
