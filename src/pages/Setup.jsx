import React, { useState } from 'react'
import {
  Bot,
  Cloud,
  HardDrive,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Database,
  Loader2,
} from 'lucide-react'
import { useApp } from '../store'
import { SCHEMA_SQL } from '../lib/schema'
import { testCloudConnection, checkSchema, initApi } from '../api'
import { Button, Card, Field, Input, cn } from '../ui'
import { Logo } from '../components/Layout'

export default function Setup() {
  const { chooseMode } = useApp()
  const [step, setStep] = useState('choose') // choose | cloud
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-blue-50/60 to-slate-50 p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">欢迎使用光明教务</h1>
          <p className="mt-1 text-slate-500">学生 · 课包 · 排课 · 点名消课 · 续费提醒，一站式管理</p>
        </div>

        {step === 'choose' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => chooseMode('local')}
              className="rounded-3xl border border-slate-200 bg-white p-6 text-left transition hover:border-blue-300 hover:shadow-lg"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                <HardDrive size={24} />
              </div>
              <div className="text-lg font-bold">先试用一下</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                本地演示模式，含示例数据，马上体验全部功能。
                <br />
                数据只存这台设备，之后可随时连接云端。
              </p>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
                立即体验 <ArrowRight size={15} />
              </div>
            </button>

            <button
              onClick={() => setStep('cloud')}
              className="rounded-3xl border border-blue-200 bg-blue-50/50 p-6 text-left transition hover:border-blue-400 hover:shadow-lg"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
                <Cloud size={24} />
              </div>
              <div className="text-lg font-bold">连接云端（推荐）</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                使用免费 Supabase 云数据库，电脑和手机数据实时同步。
                <br />
                需要注册一个 Supabase 账号（免费），约 5 分钟。
              </p>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
                开始配置 <ArrowRight size={15} />
              </div>
            </button>
          </div>
        ) : (
          <CloudWizard
            onBack={() => setStep('choose')}
            onDone={() => {
              let conf = null
              try {
                conf = JSON.parse(localStorage.getItem('gm_cloud_conf') || 'null')
              } catch {}
              chooseMode('cloud', conf)
            }}
          />
        )}

        <div className="mt-8 text-center text-xs text-slate-400">
          界面适配电脑和手机 · 数据随时可导出备份 · 永远不锁定
        </div>
      </div>
    </div>
  )
}

function CloudWizard({ onBack, onDone }) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState(1) // 1 连接 2 建表 3 账号
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [sqlDone, setSqlDone] = useState(false)

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(SCHEMA_SQL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setMsg('复制失败，请手动全选复制下方文本')
    }
  }

  const testConn = async () => {
    setMsg('')
    if (!/^https:\/\/.+/.test(url.trim())) return setMsg('项目地址应以 https:// 开头，形如 https://xxxx.supabase.co')
    if (!key.trim()) return setMsg('请粘贴 anon public key')
    setBusy(true)
    const r = await testCloudConnection(url.trim(), key.trim())
    setBusy(false)
    if (!r.ok) return setMsg(r.message)
    setStep(2)
  }

  const doSignUp = async () => {
    setMsg('')
    if (!email.trim() || !password || password.length < 6)
      return setMsg('请填写邮箱和至少 6 位密码')
    setBusy(true)
    try {
      // 初始化 API 以便检查建表情况
      const conf = { url: url.trim(), anonKey: key.trim() }
      localStorage.setItem('gm_cloud_conf', JSON.stringify(conf))
      const api = initApi('cloud', conf)
      const schema = await checkSchema(api.client)
      if (!schema.ok) {
        setBusy(false)
        setMsg('数据表还没创建：请先完成第 2 步（在 Supabase SQL Editor 执行建表脚本）')
        setStep(2)
        return
      }
      await api.signUp(email.trim(), password)
      setBusy(false)
      onDone()
    } catch (e) {
      setBusy(false)
      setMsg(e.message || String(e))
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={onBack} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
          <ArrowLeft size={18} />
        </button>
        <h2 className="font-bold">连接 Supabase 云端</h2>
        <div className="ml-auto flex gap-1.5">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={cn('h-2 w-8 rounded-full transition-colors', step >= n ? 'bg-blue-500' : 'bg-slate-200')}
            />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3.5 text-[13px] leading-relaxed text-slate-600">
            <b>1.</b> 打开 <span className="font-mono text-blue-600">supabase.com</span> 注册/登录（免费），
            点「New Project」创建项目（名字随意，区域选 Singapore 离得近）。
            <br />
            <b>2.</b> 创建后进入项目 → 右下角齿轮 <b>Project Settings → API</b>，
            找到 <b>Project URL</b> 和 <b>anon public key</b>，分别粘贴到下面。
          </div>
          <Field label="Project URL">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxx.supabase.co" />
          </Field>
          <Field label="anon public key">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOiJI..." />
          </Field>
          {msg && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{msg}</div>}
          <Button size="lg" className="w-full" onClick={testConn} disabled={busy}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
            测试连接
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3.5 text-[13px] leading-relaxed text-slate-600">
            <b>1.</b> 点击下方按钮复制建表脚本。
            <br />
            <b>2.</b> 回到 Supabase 项目 → 左侧 <b>SQL Editor</b> → New query → 粘贴 → 点 <b>Run</b>。
            <br />
            <b>3.</b> 显示 "Success" 后，勾选下方确认框。
          </div>
          <Button variant="outline" className="w-full" onClick={copySql}>
            {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
            {copied ? '已复制，去粘贴执行吧' : '复制建表脚本'}
          </Button>
          <details className="rounded-xl border border-slate-200">
            <summary className="cursor-pointer p-3 text-sm text-slate-500">查看脚本内容（也可从这里手动复制）</summary>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all p-3 pt-0 text-[11px] leading-relaxed text-slate-500">
              {SCHEMA_SQL}
            </pre>
          </details>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={sqlDone} onChange={(e) => setSqlDone(e.target.checked)} className="h-4 w-4" />
            我已在 Supabase 执行完建表脚本
          </label>
          {msg && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">{msg}</div>}
          <Button size="lg" className="w-full" disabled={!sqlDone} onClick={() => setStep(3)}>
            下一步：创建管理员账号 <ArrowRight size={16} />
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3.5 text-[13px] leading-relaxed text-slate-600">
            这是<b>你自己</b>的登录账号（只用在这套系统里）。建议到 Supabase 后台 <b>Authentication → Sign In / Providers</b>{' '}
            关闭「Confirm email」，注册后即可直接登录。
          </div>
          <Field label="管理员邮箱">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />
          </Field>
          <Field label="密码（至少 6 位）">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
          </Field>
          {msg && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{msg}</div>}
          <Button size="lg" className="w-full" onClick={doSignUp} disabled={busy}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Bot size={18} />}
            创建账号并进入系统
          </Button>
        </div>
      )}
    </Card>
  )
}
