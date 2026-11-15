import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Cloud,
  HardDrive,
  Download,
  Upload,
  RefreshCcw,
  LogOut,
  Plus,
  Trash2,
  Check,
  Smartphone,
  Database,
  Sparkles,
  Loader2,
  Copy,
} from 'lucide-react'
import { useApp } from '../store'
import { getApi } from '../api'
import { seedDemo } from '../api/seed'
import { getLLMConf, setLLMConf, testLLM, fetchModelList, LLM_PROVIDERS, getNluMisses, clearNluMisses } from '../lib/llm'
import { Badge, Button, Card, Field, Input, Select, Switch, cn } from '../ui'
import Layout from '../components/Layout'

export default function Settings() {
  const { db, settings, saveSettings, mode, chooseMode, signOut, refresh, toast, confirm, create, remove, update } = useApp()
  const nav = useNavigate()
  const [org, setOrg] = useState(settings.orgName || '光明教务')
  const [threshold, setThreshold] = useState(Number(settings.renewalThreshold) || 20)
  const [newCourse, setNewCourse] = useState('')
  const fileRef = useRef(null)
  // 大模型理解引擎配置
  const [llm, setLlm] = useState(() => {
    const c = getLLMConf()
    return {
      provider: c?.provider || 'siliconflow',
      key: c?.key || '',
      model: c?.model || LLM_PROVIDERS[c?.provider || 'siliconflow'].defaultModel,
    }
  })
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmReady, setLlmReady] = useState(!!getLLMConf()?.key)
  const [misses, setMisses] = useState(() => getNluMisses())
  const [modelList, setModelList] = useState([])
  const [fetchingModels, setFetchingModels] = useState(false)

  const pullModels = async () => {
    if (!llm.key.trim()) {
      toast('请先粘贴 API Key，再拉取模型列表', 'error')
      return
    }
    setFetchingModels(true)
    try {
      const list = await fetchModelList({ provider: llm.provider, key: llm.key.trim() })
      setModelList(list)
      toast(`已拉取 ${list.length} 个模型，在"模型名"框里直接选`)
    } catch (e) {
      toast('拉取失败：' + (e.message || e), 'error')
    } finally {
      setFetchingModels(false)
    }
  }

  const saveLLM = async () => {
    if (!llm.key.trim()) {
      toast('请先粘贴 API Key', 'error')
      return
    }
    const provider = LLM_PROVIDERS[llm.provider]
    const model = llm.model.trim() || provider.defaultModel
    setLlmTesting(true)
    let conf = { provider: llm.provider, key: llm.key.trim(), model }
    let r = await testLLM(conf)
    // 模型名不可用时自动回退到该服务商的推荐模型
    if (!r.ok && provider.knownModels && model !== provider.defaultModel && /模型名不存在|404|not.*exist/i.test(r.message)) {
      const retryConf = { ...conf, model: provider.defaultModel }
      const r2 = await testLLM(retryConf)
      if (r2.ok) {
        conf = retryConf
        r = r2
        setLlm((f) => ({ ...f, model: provider.defaultModel }))
        toast(`模型名「${model}」不可用，已自动改用「${provider.defaultModel}」`)
      }
    }
    setLlmTesting(false)
    if (!r.ok) {
      toast(r.message, 'error')
      return
    }
    setLLMConf(conf)
    setLlmReady(true)
    toast(r.message)
  }

  const stopLLM = () => {
    setLLMConf(null)
    setLlmReady(false)
    setLlm((f) => ({ ...f, key: '' }))
    toast('已停用大模型，助手回到内置规则理解')
  }

  const exportJson = async () => {
    const text = await getApi().exportJson()
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `光明教务备份_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('备份已导出，建议每月存一次到本地')
  }

  const importJson = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ok = await confirm('导入备份', '导入会覆盖当前全部数据（学生/课包/排课/点名记录）。确定继续？', true)
    if (!ok) return
    try {
      await getApi().importJson(await file.text())
      await refresh()
      toast('备份已导入')
    } catch (err) {
      toast('导入失败：' + (err.message || err), 'error')
    }
  }

  const resetDemo = async () => {
    const ok = await confirm('重置演示数据', '将清空本地数据并重新灌入示例数据。确定？', true)
    if (!ok) return
    await getApi().resetDemo(seedDemo)
    await refresh()
    toast('已重置为演示数据')
  }

  const addCourse = async () => {
    if (!newCourse.trim()) return
    await create('courses', { name: newCourse.trim(), color: '#2563eb' })
    setNewCourse('')
    toast('课程已添加')
  }

  const delCourse = async (c) => {
    const used = db.packages.some((p) => p.courseId === c.id) || db.sessions.some((s) => s.courseId === c.id)
    if (used) return toast('该课程已有课包或课次，不能删除（可改名）', 'error')
    const ok = await confirm('删除课程', `确定删除「${c.name}」？`, true)
    if (!ok) return
    await remove('courses', c.id)
  }

  return (
    <Layout title="设置">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">设置</h1>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 基础 */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-slate-700">基础设置</h3>
          <div className="space-y-4">
            <Field label="机构名称（显示在标题和首页）">
              <div className="flex gap-2">
                <Input value={org} onChange={(e) => setOrg(e.target.value)} />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await saveSettings({ orgName: org })
                    toast('已保存')
                  }}
                >
                  保存
                </Button>
              </div>
            </Field>
            <Field label="续费预警线（剩余课时低于该值提醒）">
              <div className="flex gap-2">
                <Input type="number" min="1" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await saveSettings({ renewalThreshold: threshold })
                    toast('已保存，预警线立即生效')
                  }}
                >
                  保存
                </Button>
              </div>
            </Field>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <div>
                <div className="text-sm font-medium">请假扣课时</div>
                <div className="text-xs text-slate-400">开启后，点名选「请假」也会消课</div>
              </div>
              <Switch
                checked={!!settings.deductOnLeave}
                onChange={async (v) => {
                  await saveSettings({ deductOnLeave: v })
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <div>
                <div className="text-sm font-medium">缺席扣课时</div>
                <div className="text-xs text-slate-400">开启后，点名选「缺席」也会消课</div>
              </div>
              <Switch
                checked={!!settings.deductOnAbsent}
                onChange={async (v) => {
                  await saveSettings({ deductOnAbsent: v })
                }}
              />
            </div>
          </div>
        </Card>

        {/* 课程 */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-slate-700">课程管理</h3>
          <div className="space-y-2">
            {db.courses.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2.5">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <input
                  className="flex-1 bg-transparent text-sm font-medium outline-none"
                  value={c.name}
                  onChange={(e) => update('courses', c.id, { name: e.target.value })}
                />
                <button className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500" onClick={() => delCourse(c)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input placeholder="新课程名称，如：Scratch" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCourse()} />
              <Button variant="outline" onClick={addCourse}>
                <Plus size={15} />
              </Button>
            </div>
          </div>
        </Card>

        {/* 智能助手 · 大模型理解 */}
        <Card className="p-5 md:col-span-2">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles size={16} className="text-blue-500" />
            <h3 className="font-semibold text-slate-700">智能助手 · 大模型理解</h3>
            <Badge tone={llmReady ? 'green' : 'gray'}>{llmReady ? '已接入' : '未接入（用内置规则）'}</Badge>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            接入后，助手能听懂任意说法（一句话报班、调课、点名……），而不再局限于内置句式。
            大模型只负责"听懂"，所有操作仍会先给你确认卡片；发送内容仅限那句话和学生/班课名单，
            不含电话和缴费数据。没配 Key 时助手自动用内置规则。
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="服务商">
              <Select
                value={llm.provider}
                onChange={(e) => {
                  const p = e.target.value
                  setLlm((f) => ({ ...f, provider: p, model: LLM_PROVIDERS[p].defaultModel }))
                }}
              >
                {Object.entries(LLM_PROVIDERS).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="API Key" hint={LLM_PROVIDERS[llm.provider].keyHint}>
              <Input
                type="password"
                value={llm.key}
                onChange={(e) => setLlm((f) => ({ ...f, key: e.target.value }))}
                placeholder="粘贴你的 API Key"
              />
            </Field>
            <Field label="模型名" hint={LLM_PROVIDERS[llm.provider].modelHint}>
              <Input
                value={llm.model}
                onChange={(e) => setLlm((f) => ({ ...f, model: e.target.value }))}
                list="llm-model-options"
              />
            </Field>
            <datalist id="llm-model-options">
              {modelList.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={saveLLM} disabled={llmTesting}>
              {llmTesting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 保存并测试连接
            </Button>
            <Button variant="outline" onClick={pullModels} disabled={fetchingModels}>
              {fetchingModels ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />} 拉取可用模型
            </Button>
            {llmReady && (
              <Button variant="outline" onClick={stopLLM}>
                停用
              </Button>
            )}
            <a
              href={LLM_PROVIDERS[llm.provider].keyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              去获取 {LLM_PROVIDERS[llm.provider].label.split('（')[0]} 的 API Key ↗
            </a>
          </div>

          {/* 未听懂收集 */}
          <div className="mt-5 rounded-xl bg-slate-50 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[13px] font-medium text-slate-500">
                没听懂的句子（{misses.length} 条，自动收集，攒着一次性反馈给开发者）
              </div>
              {misses.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(misses.map((m) => `- ${m.text}`).join('\n'))
                        toast('已复制')
                      } catch {
                        toast('复制失败', 'error')
                      }
                    }}
                  >
                    <Copy size={12} /> 复制全部
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      clearNluMisses()
                      setMisses([])
                    }}
                  >
                    清空
                  </Button>
                </div>
              )}
            </div>
            {misses.length === 0 ? (
              <div className="text-xs text-slate-400">暂无。助手听不懂的句子会出现在这里</div>
            ) : (
              <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-slate-500">
                {misses.map((m, i) => (
                  <div key={i}>· {m.text}</div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* 数据 */}
        <Card className="p-5">
          <h3 className="mb-1 font-semibold text-slate-700">数据与备份</h3>
          <p className="mb-4 text-xs text-slate-400">
            {mode === 'cloud'
              ? '云端数据自动保存。建议每月导出一份 JSON 备份存到本地，双保险。'
              : '本地模式数据只存在这台设备的浏览器里，清除浏览器数据会丢失！务必定期导出备份。'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportJson}>
              <Download size={15} /> 导出备份
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> 导入备份
            </Button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importJson} />
            {mode === 'local' && (
              <Button variant="ghost" onClick={resetDemo}>
                <RefreshCcw size={15} /> 重置演示数据
              </Button>
            )}
          </div>
        </Card>

        {/* 账号 / 模式 */}
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-slate-700">账号与同步</h3>
          <div className="mb-4 flex items-center gap-2">
            <Badge tone={mode === 'cloud' ? 'green' : 'amber'}>
              {mode === 'cloud' ? <Cloud size={12} /> : <HardDrive size={12} />}
              {mode === 'cloud' ? '云端模式 · 多设备同步' : '本地演示模式 · 仅本设备'}
            </Badge>
          </div>
          {mode === 'local' ? (
            <>
              <p className="mb-3 text-sm text-slate-500">
                连接免费的 Supabase 云端后，电脑和手机数据实时同步，换设备也不丢数据。
              </p>
              <Button onClick={() => nav('/setup')}>
                <Cloud size={16} /> 连接云端（免费）
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={signOut}>
              <LogOut size={15} /> 退出登录
            </Button>
          )}
          <div className="mt-5 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-400">
            <div className="mb-1 font-medium text-slate-500">
              <Smartphone size={12} className="mr-1 inline" />
              手机怎么用？
            </div>
            用手机浏览器打开系统网址 → 分享/菜单 → 「添加到主屏幕」，之后像 App 一样点开即用：
            打开就是今日课程，下课自动弹出点名提醒。
          </div>
        </Card>
      </div>
    </Layout>
  )
}
