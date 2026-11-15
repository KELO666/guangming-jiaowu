import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { hoursBetween, hoursFmt, WEEK_CN, todayStr, addDays, isoWeekday, isCompetitionName } from '../lib/core'
import { sessionsOverlap, expandParsedToSessions } from '../lib/logic'
import { Badge, Button, Field, Input, Modal, Select, cn } from '../ui'
import RosterPicker from './RosterPicker'

const WD = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, label: WEEK_CN[n % 7] }))

// 手动新建/编辑班课
export default function GroupFormModal({ open, onClose, initial }) {
  const { db, create, createMany, update, updateGroup, toast, confirm } = useApp()
  const [form, setForm] = useState(null)
  const [newCourseName, setNewCourseName] = useState('')
  const [roster, setRoster] = useState([])
  const [poolTouched, setPoolTouched] = useState(false) // 用户手动改过消课池后，不再自动切换

  useEffect(() => {
    if (!open) return
    if (initial) {
      setForm({
        name: initial.name,
        courseId: initial.courseId || '',
        type: initial.type,
        weekdays: initial.weekdays || [],
        startDate: initial.startDate || todayStr(),
        endDate: initial.endDate || '',
        startTime: initial.startTime || '18:00',
        endTime: initial.endTime || '20:00',
        hours: initial.hours || 2,
        defaultPool: initial.defaultPool || 'formal',
        location: initial.location || '',
        notes: initial.notes || '',
        active: initial.active ?? true,
      })
      setRoster(db.groupStudents.filter((r) => r.groupId === initial.id).map((r) => r.studentId))
    } else {
      setForm({
        name: '',
        courseId: db.courses[0]?.id || '',
        type: 'recurring',
        weekdays: [],
        startDate: todayStr(),
        endDate: '',
        startTime: '18:00',
        endTime: '20:00',
        hours: 2,
        defaultPool: 'formal',
        location: '',
        notes: '',
        active: true,
      })
      setRoster([])
    }
    setNewCourseName('')
    setPoolTouched(false)
  }, [open, initial, db.courses, db.groupStudents])

  if (!open || !form) return null
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const calcHours = hoursBetween(form.startTime, form.endTime)

  const submit = async () => {
    if (!form.name.trim()) return toast('请填写班课名称', 'error')
    if (!form.courseId && !newCourseName.trim()) return toast('请选择或输入课程', 'error')
    if (form.type !== 'single' && form.weekdays.length === 0) return toast('请选择上课星期', 'error')
    if (form.type === 'limited' && (!form.startDate || !form.endDate)) return toast('请填写起止日期', 'error')
    if (!form.startTime || !form.endTime) return toast('请填写上课时间', 'error')

    // 冲突检测：该班课将生成的课次与现有课次重叠
    const pseudo = {
      type: form.type,
      name: form.name,
      startTime: form.startTime,
      endTime: form.endTime,
      weekdays: form.weekdays,
      startDate: form.type === 'single' ? form.startDate : form.startDate,
      endDate: form.endDate,
      course: { name: form.name },
    }
    const newRows = expandParsedToSessions(pseudo, todayStr())
    const ownIds = new Set(initial ? db.sessions.filter((s) => s.groupId === initial.id).map((s) => s.id) : [])
    const conflicts = []
    for (const r of newRows) {
      for (const s of db.sessions) {
        if (s.status === 'cancelled' || ownIds.has(s.id)) continue
        if (sessionsOverlap(r, s)) {
          const g2 = db.groups.find((x) => x.id === s.groupId)
          conflicts.push(`${r.date.slice(5)} ${r.startTime || '全天'} 与已排《${g2?.name || s.content || '课程'}》${s.date.slice(5)} ${s.startTime}-${s.endTime} 冲突`)
          break
        }
      }
    }
    if (conflicts.length > 0) {
      const ok = await confirm(
        '存在时间冲突',
        `${conflicts.slice(0, 8).join('\n')}${conflicts.length > 8 ? `\n…等共 ${conflicts.length} 处冲突` : ''}\n\n同一个老师同一时段上两节课，确定仍要这样排吗？`,
        true
      )
      if (!ok) return
    }

    try {
      let courseId = form.courseId
      if (!courseId) {
        const c = await create('courses', { name: newCourseName.trim(), color: '#2563eb' })
        courseId = c.id
      }
      const hours = Number(form.hours) || calcHours || 2
      if (initial) {
        await updateGroup(initial.id, { ...form, courseId, hours }, roster)
        toast('班课已更新，未来未点名的课次已同步')
      } else {
        const g = await create('groups', { ...form, courseId, hours })
        if (roster.length) await createMany('groupStudents', roster.map((sid) => ({ groupId: g.id, studentId: sid })))
        if (form.type === 'single') {
          await createMany('sessions', [
            {
              groupId: g.id,
              courseId,
              date: form.startDate,
              startTime: form.startTime,
              endTime: form.endTime,
              hours,
              content: form.name,
              location: form.location,
              status: 'scheduled',
            },
          ])
        }
        toast('班课已创建，课表已生成')
      }
      onClose()
    } catch (e) {
      toast(e.message || '保存失败', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑班课' : '新建班课'}
      width="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="班课名称 *" className="col-span-2">
          <Input
            value={form.name}
            onChange={(e) => {
              const v = e.target.value
              setForm((f) => ({
                ...f,
                name: v,
                // 比赛课自动识别：名字含"城市赛/华南赛/国赛/世锦赛…"→ 默认扣赠送池（用户手动改过则不覆盖）
                defaultPool: !poolTouched && isCompetitionName(v) ? 'gift' : f.defaultPool,
              }))
            }}
            placeholder="如：VEX IQ 周四班 / 11月华南赛"
          />
          {isCompetitionName(form.name) && (
            <div className="mt-1 text-[11px] text-emerald-600">
              🏆 识别为比赛课，消课池已自动选「赠送池」（可手动改回正式池）
            </div>
          )}
        </Field>
        <Field label="课程">
          <Select value={form.courseId} onChange={(e) => set('courseId', e.target.value)}>
            <option value="">＋ 新课程</option>
            {db.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {form.courseId === '' && (
          <Field label="新课程名称">
            <Input value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} placeholder="如：Scratch" />
          </Field>
        )}
        <Field label="班课类型" className="col-span-2">
          <div className="flex gap-2">
            {[
              { v: 'recurring', t: '长期循环', d: '每周固定上' },
              { v: 'limited', t: '限时班课', d: '集训/周期课' },
              { v: 'single', t: '单次课', d: '只上一次' },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => set('type', o.v)}
                className={cn(
                  'flex-1 rounded-xl border p-2.5 text-left transition',
                  form.type === o.v ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <div className="text-sm font-medium">{o.t}</div>
                <div className="text-[11px] text-slate-400">{o.d}</div>
              </button>
            ))}
          </div>
        </Field>

        {form.type !== 'single' && (
          <Field label="上课星期 *" className="col-span-2">
            <div className="flex gap-1.5">
              {WD.map((w) => (
                <button
                  key={w.n}
                  onClick={() =>
                    set('weekdays', form.weekdays.includes(w.n) ? form.weekdays.filter((x) => x !== w.n) : [...form.weekdays, w.n].sort())
                  }
                  className={cn(
                    'h-10 flex-1 rounded-xl border text-sm font-medium transition',
                    form.weekdays.includes(w.n) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        {form.type === 'limited' && (
          <>
            <Field label="开始日期 *">
              <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="结束日期 *">
              <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          </>
        )}
        {form.type === 'single' && (
          <Field label="上课日期 *">
            <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
        )}
        <Field label="开始时间 *">
          <Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
        </Field>
        <Field label="结束时间 *">
          <Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
        </Field>
        <Field label="消课课时（小时）" hint={`按时间自动计算：${hoursFmt(calcHours)} 小时`}>
          <Input type="number" step="0.5" min="0.5" value={form.hours} onChange={(e) => set('hours', e.target.value)} />
        </Field>
        <Field label="默认消课池">
          <Select
            value={form.defaultPool}
            onChange={(e) => {
              setPoolTouched(true)
              set('defaultPool', e.target.value)
            }}
          >
            <option value="formal">正式池</option>
            <option value="gift">赠送池（比赛/集训）</option>
          </Select>
        </Field>
        <Field label="地点" className="col-span-2">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="如：奥创星图-光明校区" />
        </Field>
        <div className="col-span-2">
          <div className="mb-1.5 text-[13px] font-medium text-slate-500">
            班级学生名单（{roster.length} 人）
          </div>
          <RosterPicker value={roster} onChange={setRoster} />
        </div>
      </div>
    </Modal>
  )
}
