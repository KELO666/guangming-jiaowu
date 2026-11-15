import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Wand2, X, Trash2, Check, Loader2, AlertTriangle, Info } from 'lucide-react'
import { useApp } from '../store'
import { parseAssistantInput, resolveLLMCommands } from '../lib/nlu'
import { getLLMConf, parseWithLLM, buildDict, LLM_PROVIDERS, logNluMisses } from '../lib/llm'
import { createScheduleLine, packageRowsFor } from '../lib/actions'
import { renewalList, expandParsedToSessions, sessionsOverlap } from '../lib/logic'
import { hoursFmt, money, remaining, round2, unitPrice, addDays, isoWeekday, todayStr, fmtDate, WEEK_CN } from '../lib/core'
import { Badge, Button, Card, Field, Input, Select, cn } from '../ui'
import { LineCard } from './TextScheduleModal'

const EXAMPLES = [
  '新报了学生小琳，G5，vexiq，36100元，100课时+20赠送比赛课时，加入周三17:20-19:20的班级',
  '周三的 vexiq 班，加入陈大明 Eason 和刘小华 Alina，以后长期一起上课',
  '每周二 18:30-20:30 Python：张伟杰、孙昊然',
  '今天VEX GO周六班全到，林志强请假',
  '10.29的课程全员到齐，全部点名签到',
  '孙昊然明天请假',
  '小琳还剩多少课时',
  '谁该续费了',
]

const INTENT_LABEL = {
  enroll: '报名建档 + 课包 + 入班',
  payment: '缴费 / 续费',
  schedule: '排课',
  attendance: '点名',
  leave: '请假登记',
  join: '学生入班',
  query: '查询',
  unknown: '未识别',
}

const countSessions = (p) => {
  if (p.type === 'single') return 1
  if (p.type === 'limited' && p.startDate && p.endDate) {
    let n = 0
    for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1)) {
      if ((p.weekdays || []).includes(isoWeekday(d))) n++
    }
    return n
  }
  return null
}

// ============================================================
// 智能助手：一句话，办好事（先解析预览，确认后执行）
// ============================================================
export default function Assistant() {
  const { db, create, createMany, update, toast, confirm, refresh, saveAttendance, updateGroup, settings } = useApp()
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [commands, setCommands] = useState([])
  const [busy, setBusy] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [engine, setEngine] = useState('') // 'llm' | 'rules'
  const [showExamples, setShowExamples] = useState(false)

  const ctx = useMemo(
    () => ({
      students: db.students,
      courses: db.courses,
      groups: db.groups,
      groupStudents: db.groupStudents,
      sessions: db.sessions,
      today: todayStr(),
    }),
    [db]
  )

  const updateCmd = (i, patch) => setCommands((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const answerQuery = (cmd) => {
    const q = cmd.query
    const threshold = Number(settings.renewalThreshold) || 20
    if (q.kind === 'renewal') {
      const list = renewalList(db.students, db.packages, db.courses, threshold)
      if (!list.length) return '课时都很充足，暂时没有人需要续费 ✅'
      return (
        `待续费 ${list.length} 人（按紧急程度排序）：\n` +
        list
          .map((r) => `· ${r.student.name}｜${r.course?.name || ''} 正式池剩 ${hoursFmt(r.formalRem)}${r.formalRem < 0 ? '（已超扣⚠）' : ''}${r.giftRem > 0 ? `，赠送剩 ${hoursFmt(r.giftRem)}` : ''}${r.student.phone ? `，电话 ${r.student.phone}` : ''}`)
          .join('\n')
      )
    }
    if (q.kind === 'hours') {
      const stu = db.students.find((s) => s.id === q.studentId)
      if (!stu) return '没找到这个学生'
      const byCourse = new Map()
      for (const p of db.packages.filter((p) => p.studentId === stu.id)) {
        if (!byCourse.has(p.courseId)) byCourse.set(p.courseId, { formal: 0, gift: 0 })
        const cell = byCourse.get(p.courseId)
        cell[p.kind] = round2((cell[p.kind] || 0) + remaining(p))
      }
      if (!byCourse.size) return `「${stu.name}」名下还没有课包`
      return (
        `「${stu.name}」的课时余额：\n` +
        [...byCourse.entries()]
          .map(([courseId, v]) => {
            const c = db.courses.find((x) => x.id === courseId)
            return `· ${c?.name}：正式剩 ${hoursFmt(v.formal)}${v.gift ? `，赠送剩 ${hoursFmt(v.gift)}` : ''}${v.formal < threshold ? ' ⚠ 该续费了' : ''}`
          })
          .join('\n')
      )
    }
    if (q.kind === 'schedule') {
      const list = db.sessions
        .filter((s) => s.date === q.date && s.status !== 'cancelled')
        .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
      if (!list.length) return `${q.dateLabel}（${q.date}）没有排课 🎉`
      return (
        `${q.dateLabel}（${fmtDate(q.date)}）共 ${list.length} 节课：\n` +
        list
          .map((s) => {
            const g = db.groups.find((x) => x.id === s.groupId)
            const n = db.groupStudents.filter((r) => r.groupId === s.groupId).length
            return `· ${s.startTime}-${s.endTime} ${g?.name || s.content || '临时课'}（${n} 人${s.status === 'completed' ? '，已点名' : ''}）`
          })
          .join('\n')
      )
    }
    return ''
  }

  const run = async () => {
    if (!text.trim() || runBusy) return
    setRunBusy(true)
    try {
      let cmds
      const conf = getLLMConf()
      if (conf?.key) {
        try {
          const raw = await parseWithLLM(text, buildDict(ctx))
          cmds = resolveLLMCommands(raw, ctx)
          setEngine('llm')
        } catch (e) {
          toast('大模型理解失败（' + (e.message || '网络问题') + '），已改用内置规则', 'error')
          cmds = parseAssistantInput(text, ctx)
          setEngine('rules')
        }
      } else {
        cmds = parseAssistantInput(text, ctx)
        setEngine('rules')
      }
      logNluMisses(cmds)
      const withState = cmds.map((c) => {
        const base = { ...c, status: 'ready', result: '' }
        if (c.intent === 'query' && c.ok) {
          base.status = 'answered'
          base.result = answerQuery(c)
        }
        return base
      })
      setCommands(withState)
      if (!withState.length) toast('没有解析到内容', 'error')
    } finally {
      setRunBusy(false)
    }
  }

  const executeAll = async () => {
    const todo = commands
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.ok && c.status !== 'answered' && ['enroll', 'payment', 'schedule', 'attendance', 'leave'].includes(c.intent))
    if (!todo.length) return
    // 冲突预检（排课类）
    const scheduleCmds = todo.filter(({ c }) => c.intent === 'schedule')
    if (scheduleCmds.length) {
      const details = []
      const existing = db.sessions
        .filter((s) => s.status !== 'cancelled')
        .map((s) => ({
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          label: db.groups.find((g) => g.id === s.groupId)?.name || s.content || '课程',
        }))
      for (const { c } of scheduleCmds) {
        for (const r of expandParsedToSessions(c.parsed, todayStr())) {
          for (const e of existing) {
            if (sessionsOverlap(r, e)) {
              details.push(`${r.date.slice(5)} ${r.startTime || '全天'}「${c.parsed.name}」与已排《${e.label}》冲突`)
              break
            }
          }
        }
      }
      if (details.length) {
        const ok = await confirm('存在时间冲突', `${details.slice(0, 8).join('\n')}\n\n确定仍要这样排吗？`, true)
        if (!ok) return
      }
    }
    setBusy(true)
    let okCount = 0
    for (const { c, i } of todo) {
      updateCmd(i, { status: 'running' })
      try {
        const msg = await executeCommand(c)
        okCount++
        updateCmd(i, { status: 'done', result: msg })
      } catch (e) {
        updateCmd(i, { status: 'error', result: e.message || String(e) })
      }
    }
    await refresh()
    setBusy(false)
    toast(`执行完成：${okCount}/${todo.length} 条成功`)
  }

  const executeCommand = async (cmd) => {
    if (cmd.intent === 'enroll') return doEnroll(cmd.enroll)
    if (cmd.intent === 'payment') return doPayment(cmd.payment)
    if (cmd.intent === 'join') return doJoinGroup(cmd.join)
    if (cmd.intent === 'schedule') {
      const r = await createScheduleLine(cmd.parsed, { create, createMany })
      return `已创建班课「${cmd.parsed.name}」${r.courseCreated ? '（新课程）' : ''}${r.sessionsCreated ? `，生成 ${r.sessionsCreated} 节课` : '，周课表已自动生成'}`
    }
    if (cmd.intent === 'attendance') return doAttendance(cmd.attendance)
    if (cmd.intent === 'leave') return doLeave(cmd.leave)
    throw new Error('该指令类型无法执行')
  }

  const doEnroll = async (e) => {
    let studentId = e.studentId
    let created = false
    if (!studentId) {
      if (!e.name?.trim()) throw new Error('学生姓名为空')
      const s = await create('students', {
        name: e.name.trim(),
        enName: '',
        grade: e.grade || '',
        gender: '',
        birthDate: '',
        school: '',
        parentName: '',
        phone: '',
        wechat: '',
        notes: '智能助手录入',
        status: 'active',
      })
      studentId = s.id
      created = true
    }
    let courseId = e.courseId
    let courseCreated = false
    if (!courseId && e.courseName?.trim()) {
      const c = await create('courses', { name: e.courseName.trim(), color: '#7c3aed' })
      courseId = c.id
      courseCreated = true
    }
    if (!courseId) throw new Error('未选择课程')
    if (!(Number(e.formalHours) > 0) && !(Number(e.giftHours) > 0)) throw new Error('课时数不对')
    await createMany(
      'packages',
      packageRowsFor({ studentId, courseId, formalHours: e.formalHours, giftHours: e.giftHours, price: e.price || 0 })
    )
    let groupMsg = ''
    if (e.groupId) {
      const dup = db.groupStudents.find((r) => r.groupId === e.groupId && r.studentId === studentId)
      if (!dup) await create('groupStudents', { groupId: e.groupId, studentId })
      groupMsg = `，已加入「${db.groups.find((g) => g.id === e.groupId)?.name || ''}」`
    }
    const course = db.courses.find((c) => c.id === courseId)
    return `${created ? '新建学生' : '学生'}「${e.name}」${e.grade ? `(${e.grade})` : ''}：${course?.name} 课包 正式${hoursFmt(e.formalHours)}+赠${hoursFmt(e.giftHours)} ${e.price ? money(e.price) : ''}${courseCreated ? '，新建了课程' : ''}${groupMsg}`
  }

  const doPayment = async (p) => {
    if (!p.studentId) throw new Error('未选择学生')
    let courseId = p.courseId
    if (!courseId && p.courseName?.trim()) {
      const c = await create('courses', { name: p.courseName.trim(), color: '#7c3aed' })
      courseId = c.id
    }
    if (!courseId) throw new Error('未选择课程')
    await createMany('packages', packageRowsFor({ studentId: p.studentId, courseId, formalHours: p.formalHours, giftHours: p.giftHours, price: p.price || 0 }))
    const stu = db.students.find((s) => s.id === p.studentId)
    const course = db.courses.find((c) => c.id === courseId)
    return `「${stu?.name}」${course?.name} 课包：正式${hoursFmt(p.formalHours)}+赠${hoursFmt(p.giftHours)} ${p.price ? money(p.price) : ''} 已录入`
  }

  const doAttendance = async (a) => {
    // 模式一：单节课点名
    if (a.mode !== 'date_all') {
      const session = db.sessions.find((s) => s.id === a.sessionId)
      if (!session) throw new Error('该班课当天没有排课')
      if (session.status === 'completed') throw new Error('这节课已经点过名了（可去点名页修改）')
      const roster = db.groupStudents.filter((r) => r.groupId === a.groupId).map((r) => r.studentId)
      const excMap = new Map(a.exceptions.map((x) => [x.studentId, x.status]))
      const entries = roster.map((sid) => ({ studentId: sid, status: excMap.get(sid) || 'present' }))
      for (const [sid, st] of excMap) {
        if (!roster.includes(sid)) entries.push({ studentId: sid, status: st })
      }
      const r = await saveAttendance(session, entries, { complete: true })
      if (!r.ok) throw new Error('有学生缺少课包，请先到学生详情建档课包')
      const present = entries.filter((e) => e.status === 'present' || e.status === 'makeup').length
      const leave = entries.filter((e) => e.status === 'leave').length
      const absent = entries.filter((e) => e.status === 'absent').length
      const g = db.groups.find((x) => x.id === a.groupId)
      return `「${g?.name || ''}」${a.dateLabel}已点名：到课${present} 请假${leave} 缺席${absent}，消课 ${present * (Number(session.hours) || 2)} 课时`
    }

    // 模式二：这一天全部课次点名
    const list = db.sessions
      .filter((s) => s.date === a.date && s.status !== 'cancelled' && !(a.excludeIds || []).includes(s.id))
      .sort((x, y) => String(x.startTime).localeCompare(String(y.startTime)))
    if (!list.length) throw new Error('这一天没有可点名的课次')
    const excMap = new Map(a.exceptions.map((x) => [x.studentId, x.status]))
    const notes = []
    let done = 0
    let totalPresent = 0
    let totalHours = 0
    for (const sess of list) {
      const g = db.groups.find((x) => x.id === sess.groupId)
      const label = `《${g?.name || sess.content || '课程'}》${String(sess.startTime).slice(0, 5)}`
      if (sess.status === 'completed') {
        notes.push(`${label}已点过名，跳过`)
        continue
      }
      const roster = db.groupStudents.filter((r) => r.groupId === sess.groupId).map((r) => r.studentId)
      if (!roster.length) {
        notes.push(`${label}名单为空，跳过`)
        continue
      }
      const entries = roster.map((sid) => ({ studentId: sid, status: excMap.get(sid) || 'present' }))
      const r = await saveAttendance(sess, entries, { complete: true })
      if (!r.ok) {
        notes.push(`${label}有学生缺少课包，未保存`)
        continue
      }
      const present = entries.filter((e) => e.status === 'present' || e.status === 'makeup').length
      done++
      totalPresent += present
      totalHours += present * (Number(sess.hours) || 2)
      notes.push(`${label}到课${present}人`)
    }
    if (!done && !totalPresent) {
      if (notes.length) return `${a.dateLabel}没有需要点名的课次：${notes.join('；')}`
      throw new Error('没有可点名的课次')
    }
    return `${a.dateLabel}（${a.date}）点名完成 ${done} 节，到课 ${totalPresent} 人次，消课 ${totalHours} 课时。${notes.join('；')}`
  }

  const doJoinGroup = async (j) => {
    if (!j.groupId) throw new Error('未选择班课')
    if (!j.students.length) throw new Error('没有学生')
    const group = db.groups.find((g) => g.id === j.groupId)
    const results = []
    for (const s of j.students) {
      let studentId
      let desc
      if (s.existing) {
        studentId = s.existing.id
        if (s.rename && s.renameApply !== false && s.name && s.existing.name !== s.name) {
          await update('students', studentId, { name: s.name, enName: s.enName || s.existing.enName || '' })
          desc = `「${s.existing.name}」已更名为「${s.name}${s.enName ? ' ' + s.enName : ''}」`
        } else {
          desc = `已有学生「${s.existing.name}」`
        }
      } else {
        if (!s.name?.trim()) throw new Error('有学生姓名为空')
        const stu = await create('students', {
          name: s.name.trim(),
          enName: s.enName || '',
          grade: '',
          gender: '',
          birthDate: '',
          school: '',
          parentName: '',
          phone: '',
          wechat: '',
          notes: '智能助手录入',
          status: 'active',
        })
        studentId = stu.id
        desc = `新建学生「${s.name.trim()}${s.enName ? ' ' + s.enName : ''}」`
      }
      const dup = db.groupStudents.find((r) => r.groupId === j.groupId && r.studentId === studentId)
      if (!dup) await create('groupStudents', { groupId: j.groupId, studentId })
      results.push(desc)
    }
    let gMsg = ''
    if (j.toRecurring && group && group.type !== 'recurring') {
      await updateGroup(j.groupId, { type: 'recurring', endDate: '', active: true })
      gMsg = `；「${group.name}」已转为长期循环（${(group.weekdays || []).map((n) => '周' + WEEK_CN[n % 7]).join('')}），未来课次已重新生成`
    }
    return `已加入「${group?.name || ''}」：${results.join('；')}${gMsg}`
  }

  const doLeave = async (l) => {
    const session = db.sessions.find((s) => s.id === l.sessionId)
    if (!session) throw new Error('没找到该学生 upcoming 的课次')
    const r = await saveAttendance(session, [{ studentId: l.studentId, status: 'leave' }], { complete: false })
    if (!r.ok) throw new Error('保存失败')
    const g = db.groups.find((x) => x.id === session.groupId)
    return `「${l.studentName}」已在 ${fmtDate(session.date)}《${g?.name || ''}》登记请假（上课时不扣课时）`
  }

  const okCount = commands.filter((c) => c.ok && c.status !== 'answered' && ['enroll', 'payment', 'schedule', 'attendance', 'leave', 'join'].includes(c.intent)).length

  return (
    <Card className="mb-6 overflow-hidden border-blue-200/60">
      <div className="bg-gradient-to-br from-blue-50/90 to-indigo-50/50 p-4">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
            <Sparkles size={17} />
          </span>
          <div>
            <div className="font-bold">智能助手</div>
            <div className="text-xs text-slate-400">一句话，办好事：报名、缴费、排课、点名、请假、查询</div>
          </div>
          <button className="ml-auto text-xs text-blue-500 hover:underline" onClick={() => setShowExamples((v) => !v)}>
            {showExamples ? '收举示例' : '看示例'}
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={EXAMPLES[0]}
          className="w-full rounded-xl border border-blue-100 bg-white p-3 text-[15px] leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        {showExamples && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setText((t) => (t ? t + '\n' : '') + ex)}
                className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 transition hover:bg-blue-50 hover:text-blue-700"
              >
                {ex.length > 26 ? ex.slice(0, 26) + '…' : ex}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="min-w-0 text-xs text-slate-400">
            <div>每行一句话 · 说过之后先给你确认，不会乱动数据</div>
            {engine && (
              <div className="mt-0.5">
                理解引擎：{engine === 'llm' ? `大模型（${LLM_PROVIDERS[getLLMConf()?.provider || 'siliconflow']?.label || '已接入'}）` : '内置规则'}
                {engine === 'rules' && !getLLMConf()?.key && (
                  <button className="ml-1 text-blue-500 hover:underline" onClick={() => nav('/settings')}>
                    接入大模型，听懂任意说法 →
                  </button>
                )}
              </div>
            )}
          </div>
          <Button onClick={run} disabled={!text.trim() || runBusy} className="shrink-0">
            {runBusy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} 理解一下
          </Button>
        </div>
      </div>

      {commands.length > 0 && (
        <div className="space-y-3 border-t border-blue-100 bg-white p-4">
          {commands.map((cmd, i) => (
            <CommandCard
              key={i}
              idx={i}
              cmd={cmd}
              updateCmd={updateCmd}
              onRemove={() => setCommands((cs) => cs.filter((_, j) => j !== i))}
            />
          ))}
          {okCount > 0 ? (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-400">确认无误后执行，执行完自动刷新数据</div>
              <Button onClick={executeAll} disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                执行 {okCount} 条指令
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-amber-600">
              <Info size={13} />
              {commands.some((c) => c.status === 'answered')
                ? '查询类指令已直接给出答案，无需执行；有新指令就在上面继续输入'
                : '黄色提示处理完（选班课/改字段）后，这里会出现执行按钮'}
            </div>
          )}
          <div className="text-right">
            <button className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600" onClick={() => setCommands([])}>
              <Trash2 size={12} /> 清空结果
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// —— 单条指令卡片 ——
function CommandCard({ idx, cmd, updateCmd, onRemove }) {
  const { db } = useApp()
  const label = INTENT_LABEL[cmd.intent] || cmd.intent
  const tone = cmd.intent === 'query' ? 'blue' : cmd.intent === 'unknown' ? 'gray' : 'purple'
  return (
    <div className={cn('rounded-2xl border p-3.5', cmd.ok ? 'border-slate-200' : 'border-amber-200 bg-amber-50/40')}>
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
        {cmd.status === 'done' && <Badge tone="green"><Check size={11} /> 已执行</Badge>}
        {cmd.status === 'error' && <Badge tone="red">失败</Badge>}
        {cmd.status === 'running' && <Badge tone="blue"><Loader2 size={11} className="animate-spin" /> 执行中</Badge>}
        <button className="ml-auto rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500" onClick={onRemove}>
          <X size={15} />
        </button>
      </div>

      {/* 查询：直接显示答案 */}
      {cmd.intent === 'query' && (
        <div className="whitespace-pre-line rounded-xl bg-blue-50/70 p-3 text-sm leading-relaxed text-slate-700">{cmd.result}</div>
      )}

      {/* 报名建档 */}
      {cmd.intent === 'enroll' && cmd.enroll && (
        <EnrollFields e={cmd.enroll} update={(patch) => updateCmd(idx, { enroll: { ...cmd.enroll, ...patch } })} />
      )}
      {cmd.intent === 'payment' && cmd.payment && (
        <PaymentFields p={cmd.payment} update={(patch) => updateCmd(idx, { payment: { ...cmd.payment, ...patch } })} />
      )}
      {cmd.intent === 'schedule' && cmd.parsed && (
        <LineCard
          idx={idx}
          p={cmd.parsed}
          setP={(j, patch) => updateCmd(idx, { parsed: { ...cmd.parsed, ...patch }, ok: recheckOk({ ...cmd.parsed, ...patch }) })}
          countSessions={countSessions}
        />
      )}
      {cmd.intent === 'attendance' && cmd.attendance && (
        <AttendanceFields a={cmd.attendance} update={(patch) => updateCmd(idx, { attendance: { ...cmd.attendance, ...patch } })} />
      )}
      {cmd.intent === 'join' && cmd.join && (
        <JoinGroupFields j={cmd.join} update={(patch) => updateCmd(idx, { join: { ...cmd.join, ...patch } })} />
      )}
      {cmd.intent === 'leave' && cmd.leave && (
        <div className="text-sm text-slate-600">
          「{cmd.leave.studentName}」→ {cmd.leave.date ? `${fmtDate(cmd.leave.date)} ${cmd.leave.startTime}` : ''}
          {cmd.leave.mode === 'next' ? ' 下次课' : ''} 登记请假（不扣课时）
        </div>
      )}
      {cmd.intent === 'unknown' && <div className="text-sm text-slate-500">{cmd.raw}</div>}

      {/* 警告 / 结果 */}
      {cmd.warnings?.length > 0 && cmd.status === 'ready' && (
        <div className="mt-2 space-y-0.5 text-xs text-amber-600">
          {cmd.warnings.map((w, j) => (
            <div key={j}>
              <Info size={11} className="mr-0.5 inline" />
              {w}
            </div>
          ))}
        </div>
      )}
      {cmd.result && cmd.status !== 'answered' && (
        <div className={cn('mt-2 whitespace-pre-line rounded-xl p-2.5 text-[13px]', cmd.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>
          {cmd.result}
        </div>
      )}
    </div>
  )
}

const recheckOk = (p) => !!(p.startTime && p.type && (p.type === 'single' ? p.date : (p.weekdays || []).length > 0))

// —— 报名建档字段 ——
function EnrollFields({ e, update }) {
  const { db } = useApp()
  const groupOptions = [
    ...(e.groupCandidates || []),
    ...(e.groupCandidatesAll || []).filter((g) => !(e.groupCandidates || []).some((c) => c.id === g.id)),
  ]
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Field label="学生">
          {e.existingStudent ? (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">已有：{e.name}</div>
          ) : (
            <Input value={e.name} onChange={(ev) => update({ name: ev.target.value })} className="h-9" />
          )}
        </Field>
        <Field label="年级">
          <Input value={e.grade || ''} onChange={(ev) => update({ grade: ev.target.value })} placeholder="G5" className="h-9" />
        </Field>
        <Field label="课程">
          <Select
            value={e.courseId || (e.courseNew && e.courseName ? '__new' : '')}
            onChange={(ev) => {
              const v = ev.target.value
              if (v === '__new') update({ courseId: null, courseName: e.courseName || '新课程', courseNew: true })
              else update({ courseId: v || null, courseName: db.courses.find((c) => c.id === v)?.name || '', courseNew: false })
            }}
            className="h-9"
          >
            <option value="">＋ 新课程</option>
            {db.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {e.courseNew && e.courseName && <option value="__new">新建：{e.courseName}</option>}
          </Select>
        </Field>
        <Field label="金额（元）">
          <Input type="number" value={e.price ?? ''} onChange={(ev) => update({ price: ev.target.value === '' ? null : Number(ev.target.value) })} className="h-9" />
        </Field>
        <Field label="正式课时">
          <Input type="number" value={e.formalHours ?? ''} onChange={(ev) => update({ formalHours: ev.target.value })} className="h-9" />
        </Field>
        <Field label="赠送课时">
          <Input type="number" value={e.giftHours ?? ''} onChange={(ev) => update({ giftHours: ev.target.value })} className="h-9" />
        </Field>
        <Field label="加入班课" className="col-span-2">
          <Select value={e.groupId || ''} onChange={(ev) => update({ groupId: ev.target.value || null })} className="h-9">
            <option value="">不加入班课</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {groupOptionLabel(g, db.courses)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500">
        将执行：{e.existingStudent ? '找到已有学生' : '新建学生'} {e.name}
        {e.grade ? `（${e.grade}）` : ''} → 录入课包（正式 {hoursFmt(e.formalHours)} + 赠送 {hoursFmt(e.giftHours)}，{money(e.price || 0)}）
        {e.groupId ? ' → 加入所选班课' : '，不加入班课'}
      </div>
    </div>
  )
}

function PaymentFields({ p, update }) {
  const { db } = useApp()
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Field label="学生">
          <Select value={p.studentId || ''} onChange={(ev) => update({ studentId: ev.target.value || null })} className="h-9">
            <option value="">选择学生</option>
            {db.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="课程">
          <Select
            value={p.courseId || (p.courseNew && p.courseName ? '__new' : '')}
            onChange={(ev) => {
              const v = ev.target.value
              if (v === '__new') update({ courseId: null, courseName: p.courseName || '新课程', courseNew: true })
              else update({ courseId: v || null, courseName: db.courses.find((c) => c.id === v)?.name || '', courseNew: false })
            }}
            className="h-9"
          >
            <option value="">＋ 新课程</option>
            {db.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {p.courseNew && p.courseName && <option value="__new">新建：{p.courseName}</option>}
          </Select>
        </Field>
        <Field label="金额（元）">
          <Input type="number" value={p.price ?? ''} onChange={(ev) => update({ price: ev.target.value === '' ? null : Number(ev.target.value) })} className="h-9" />
        </Field>
        <Field label="正式课时">
          <Input type="number" value={p.formalHours ?? ''} onChange={(ev) => update({ formalHours: ev.target.value })} className="h-9" />
        </Field>
        <Field label="赠送课时">
          <Input type="number" value={p.giftHours ?? ''} onChange={(ev) => update({ giftHours: ev.target.value })} className="h-9" />
        </Field>
      </div>
      <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500">
        将执行：给「{db.students.find((s) => s.id === p.studentId)?.name || '?'}」录入 {p.courseName || '所选课程'} 课包（正式 {hoursFmt(p.formalHours)} + 赠送 {hoursFmt(p.giftHours)}，{money(p.price || 0)}）
      </div>
    </div>
  )
}

// —— 学生入班字段 ——
function JoinGroupFields({ j, update }) {
  const { db } = useApp()
  const groupOptions = [
    ...(j.groupCandidates || []),
    ...(j.groupCandidatesAll || []).filter((g) => !(j.groupCandidates || []).some((c) => c.id === g.id)),
  ]
  const group = db.groups.find((g) => g.id === j.groupId)
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        {j.students.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-sm">
            {s.existing ? (
              <>
                <span className="font-medium">
                  已有学生「{s.existing.name}」{s.enName ? `（${s.enName}）` : ''}
                </span>
                {s.rename && (
                  <label className="inline-flex items-center gap-1 text-xs text-blue-700">
                    <input
                      type="checkbox"
                      checked={s.renameApply !== false}
                      onChange={(ev) => {
                        const arr = [...j.students]
                        arr[i] = { ...s, renameApply: ev.target.checked }
                        update({ students: arr })
                      }}
                      className="h-3.5 w-3.5"
                    />
                    更新姓名为「{s.name}」
                  </label>
                )}
              </>
            ) : (
              <>
                <span className="font-medium">
                  新建学生「{s.name}{s.enName ? ' ' + s.enName : ''}」
                </span>
                <input
                  value={s.name}
                  onChange={(ev) => {
                    const arr = [...j.students]
                    arr[i] = { ...s, name: ev.target.value }
                    update({ students: arr })
                  }}
                  placeholder="姓名"
                  className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-xs"
                />
                <input
                  value={s.enName || ''}
                  onChange={(ev) => {
                    const arr = [...j.students]
                    arr[i] = { ...s, enName: ev.target.value }
                    update({ students: arr })
                  }}
                  placeholder="英文名"
                  className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-xs"
                />
              </>
            )}
            <button
              className="ml-auto rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              onClick={() => update({ students: j.students.filter((_, k) => k !== i) })}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="加入班课">
          <Select value={j.groupId || ''} onChange={(ev) => update({ groupId: ev.target.value || null })} className="h-9">
            <option value="">选择班课</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {groupOptionLabel(g, db.courses)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {j.toRecurringAvailable && (
        <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-800">
          <input
            type="checkbox"
            checked={!!j.toRecurring}
            onChange={(ev) => update({ toRecurring: ev.target.checked })}
            className="h-4 w-4"
          />
          把该班课转为长期循环
          {group && (group.weekdays || []).length > 0 && (
            <span className="text-xs text-amber-600">
              （每周{(group.weekdays || []).map((n) => WEEK_CN[n % 7]).join('、')} {group.startTime}，未来课次自动重新生成）
            </span>
          )}
        </label>
      )}
      <div className="rounded-xl bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-500">
        将执行：
        {j.students
          .map((s) =>
            s.existing
              ? `${s.rename && s.renameApply !== false ? `更新「${s.existing.name}」为「${s.name}」` : `已有「${s.existing.name}」`}`
              : `新建「${s.name}${s.enName ? ' ' + s.enName : ''}」`
          )
          .join('、')}
        → 加入「{group?.name || '?'}」
        {j.toRecurring ? '，并将该班课转为长期循环' : ''}
      </div>
    </div>
  )
}

// —— 点名字段 ——
function AttendanceFields({ a, update }) {
  const { db } = useApp()
  const daySessions = db.sessions
    .filter((s) => s.date === a.date && s.status !== 'cancelled')
    .sort((x, y) => String(x.startTime).localeCompare(String(y.startTime)))

  // 按日期全部点名模式：列出当天课次，可点击取消某节
  if (a.mode === 'date_all') {
    const include = daySessions.filter((s) => !(a.excludeIds || []).includes(s.id) && s.status !== 'completed')
    return (
      <div className="space-y-2.5">
        <Field label={`这一天要点名的课（${a.dateLabel} ${a.date}，共 ${include.length} 节，点击可剔除）`}>
          <div className="space-y-1.5">
            {daySessions.map((s) => {
              const g = db.groups.find((x) => x.id === s.groupId)
              const excluded = (a.excludeIds || []).includes(s.id)
              const done = s.status === 'completed'
              const n = db.groupStudents.filter((r) => r.groupId === s.groupId).length
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    update({
                      excludeIds: excluded
                        ? (a.excludeIds || []).filter((id) => id !== s.id)
                        : [...(a.excludeIds || []), s.id],
                    })
                  }
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl border p-2.5 text-left text-sm transition',
                    excluded
                      ? 'border-slate-200 bg-slate-50 text-slate-300 line-through'
                      : done
                        ? 'border-emerald-200 bg-emerald-50/60 text-slate-500'
                        : 'border-blue-200 bg-blue-50/60 text-slate-700'
                  )}
                >
                  <span className="font-bold tabular-nums">{String(s.startTime).slice(0, 5)}</span>
                  <span className="truncate font-medium">{g?.name || s.content || '课程'}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {done ? '已点名' : `${n} 人`}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>
        <ExceptionEditor a={a} update={update} />
        <div className="rounded-xl bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-500">
          将执行：{a.date} 的 {include.length} 节课全部到课点名（已点名的自动跳过）
          {a.exceptions.length ? `，${a.exceptions.map((x) => x.name).join('、')} 不扣课时` : ''}。
          每节课按各自名单和课包扣课时。
        </div>
      </div>
    )
  }

  // 单节课模式
  const roster = db.groupStudents.filter((r) => r.groupId === a.groupId).map((r) => db.students.find((s) => s.id === r.studentId)).filter(Boolean)
  const excIds = new Set(a.exceptions.map((x) => x.studentId))
  const groupOptions = [...(a.groupCandidates || []), ...(a.groupCandidatesAll || []).filter((g) => !(a.groupCandidates || []).some((c) => c.id === g.id))]
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="班课">
          <Select
            value={a.groupId || ''}
            onChange={(ev) => {
              const gid = ev.target.value || null
              const sess = db.sessions.find((s) => s.groupId === gid && s.date === a.date && s.status !== 'cancelled')
              update({ groupId: gid, sessionId: sess?.id || null, sessionTime: sess ? `${sess.startTime}-${sess.endTime}` : '' })
            }}
            className="h-9"
          >
            <option value="">选择班课</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {groupOptionLabel(g, db.courses)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="日期">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">{a.dateLabel}（{a.date}）{a.sessionTime || '— 无课次'}</div>
        </Field>
      </div>
      <ExceptionEditor a={a} update={update} roster={roster} />
      <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500">
        将执行：「{db.groups.find((g) => g.id === a.groupId)?.name || '?'}」{a.date} 点名，
        到课 {roster.length - excIds.size} 人
        {excIds.size ? `，${excIds.size} 人不扣课时` : ''}
        {(() => {
          const sess = db.sessions.find((s) => s.id === a.sessionId)
          return sess ? `，消课 ${(roster.length - excIds.size) * (Number(sess.hours) || 2)} 课时` : ''
        })()}
      </div>
    </div>
  )
}

// 例外学生编辑（两种模式共用）
function ExceptionEditor({ a, update, roster }) {
  const { db } = useApp()
  const excIds = new Set(a.exceptions.map((x) => x.studentId))
  const candidates = roster
    ? roster.filter((s) => !excIds.has(s.id))
    : db.students.filter((s) => s.status !== 'archived' && !excIds.has(s.id))
  return (
    <div>
      <div className="mb-1 text-[13px] font-medium text-slate-500">
        默认全员到课，以下学生标记为请假/缺席（点 ✕ 恢复到课）：
      </div>
      <div className="flex flex-wrap gap-1.5">
        {a.exceptions.map((x) => (
          <span key={x.studentId} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            {x.name} · {x.status === 'absent' ? '缺席' : '请假'}
            <button onClick={() => update({ exceptions: a.exceptions.filter((y) => y.studentId !== x.studentId) })}>
              <X size={11} />
            </button>
          </span>
        ))}
        {!a.exceptions.length && <span className="text-xs text-slate-400">无例外，全员到课</span>}
      </div>
      {candidates.length > 0 && (
        <Select
          className="mt-2 h-9 w-full sm:w-64"
          value=""
          onChange={(ev) => {
            const sid = ev.target.value
            if (!sid) return
            const stu = db.students.find((s) => s.id === sid)
            update({ exceptions: [...a.exceptions, { studentId: sid, name: stu?.name, status: 'leave' }] })
          }}
        >
          <option value="">＋ 添加例外学生…</option>
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}

function groupOptionLabel(g, courses) {
  const c = courses.find((x) => x.id === g.courseId)
  const wd = (g.weekdays || []).map((n) => '周' + WEEK_CN[n % 7]).join('')
  return `${g.name}｜${c?.name || ''} ${wd} ${g.startTime || ''}`.replace(/\s+/g, ' ').trim()
}
