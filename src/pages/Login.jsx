import React, { useState } from 'react'
import { Bot, Loader2 } from 'lucide-react'
import { useApp } from '../store'
import { getApi } from '../api'
import { Button, Field, Input } from '../ui'
import { Logo } from '../components/Layout'

export default function Login() {
  const { chooseMode, cloudConf, bakedConf, toast } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e?.preventDefault()
    setMsg('')
    if (!email.trim() || !password) return setMsg('请输入邮箱和密码')
    setBusy(true)
    try {
      await getApi().signIn(email.trim(), password)
      // 重新走启动流程（生产构建用固化的云端配置）
      chooseMode('cloud', bakedConf || cloudConf)
    } catch (err) {
      setBusy(false)
      setMsg(err.message || '登录失败')
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-blue-50/60 to-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo />
          <div className="text-sm text-slate-400">登录后同步云端数据</div>
        </div>
        <div className="space-y-3">
          <Field label="邮箱">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoFocus />
          </Field>
          <Field label="密码">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
          </Field>
        </div>
        {msg && <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{msg}</div>}
        <Button size="lg" className="mt-5 w-full" onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Bot size={18} />} 登录
        </Button>
      </form>
    </div>
  )
}
