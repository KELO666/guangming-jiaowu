import { todayStr, WEEK_CN } from './core'

// ============================================================
// 大模型理解层（可选）：把自然语言转成结构化指令（语义层）
// 设计边界：LLM 只输出"语义字段"，实体对号（名字→ID、周几时间→班课）
// 由本地代码完成（见 nlu.js 的 resolveLLMCommand），确认卡片流程不变。
// 未配置 Key 或调用失败时，上层自动回退到规则式解析（nlu.parseAssistantInput）。
// ============================================================

const LLM_CONF_KEY = 'gm_llm_conf'

export const LLM_PROVIDERS = {
  siliconflow: {
    label: '硅基流动（模型多，价格低）',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyHint: '注册后到「API 密钥」页面新建一个密钥',
    modelHint: '点「拉取可用模型」自动获取你账户可用的模型列表，或到官网「模型广场」看价格后手填',
  },
  deepseek: {
    label: 'DeepSeek（十块钱用很久，效果更好）',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    knownModels: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: '注册后充值少量金额（如 ¥10）再创建 Key；DeepSeek 没有免费额度，但按用量算极低',
    modelHint: '可用模型：deepseek-chat（推荐）、deepseek-reasoner',
  },
  dashscope: {
    label: '阿里百炼·通义（新用户有免费额度）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    keyHint: '阿里云账号开通百炼后，在「API-KEY 管理」里创建',
    modelHint: '如 qwen-turbo（快）/ qwen-plus / qwen-max（强）',
  },
}

// 拉取账户可用的模型列表（OpenAI 兼容 /models 接口，三家均已实测支持浏览器直连）
export async function fetchModelList(conf) {
  const provider = LLM_PROVIDERS[conf.provider] || LLM_PROVIDERS.siliconflow
  const base = provider.endpoint.replace(/\/chat\/completions$/, '')
  const res = await fetch(base + '/models', {
    headers: { Authorization: `Bearer ${conf.key}` },
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.message || ''
    } catch {}
    throw new Error(`HTTP ${res.status} ${detail}`)
  }
  const data = await res.json()
  return (data?.data || []).map((m) => m.id).filter(Boolean).sort()
}

export function getLLMConf() {
  try {
    const c = JSON.parse(localStorage.getItem(LLM_CONF_KEY) || 'null')
    return c && c.key ? c : null
  } catch {
    return null
  }
}
export function setLLMConf(conf) {
  if (conf && conf.key) localStorage.setItem(LLM_CONF_KEY, JSON.stringify(conf))
  else localStorage.removeItem(LLM_CONF_KEY)
}

// 连通性测试：花最少的 token 验证 Key/模型可用
export async function testLLM(conf) {
  try {
    const reply = await chat(conf, [
      { role: 'user', content: '请只回复两个字：成功' },
    ], 20)
    if (/成功|ok/i.test(reply)) return { ok: true, message: '连接成功，大模型可以正常使用' }
    return { ok: true, message: '连接成功（模型回复：' + reply.slice(0, 30) + '）' }
  } catch (e) {
    return { ok: false, message: friendlyLLMError(e) }
  }
}

function friendlyLLMError(e) {
  const msg = e?.message || String(e)
  if (/401|Unauthorized|Invalid.*key|认证/i.test(msg)) return 'API Key 不正确，请检查是否复制完整'
  if (/402|Insufficient Balance|余额/i.test(msg)) return '账户余额不足，请充值后重试'
  if (/404|model.*not.*exist|not found|模型/i.test(msg)) return '模型名不存在：请到设置里修改为平台提供的模型名'
  if (/429|rate|限流/i.test(msg)) return '请求太频繁或超出免费额度，稍后再试'
  if (/Failed to fetch|NetworkError|网络/i.test(msg)) return '网络连接失败，请检查网络'
  return msg
}

async function chat(conf, messages, maxTokens = 800) {
  const provider = LLM_PROVIDERS[conf.provider] || LLM_PROVIDERS.siliconflow
  const res = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conf.key}` },
    body: JSON.stringify({
      model: conf.model || provider.defaultModel,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      // 不使用 response_format：各家支持不一（DeepSeek 要求提示词含小写"json"，
      // 部分免费模型直接不支持），改为提示词强约束 + 宽容的 JSON 提取（见 extractJSON）
    }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.message || ''
    } catch {}
    throw new Error(`HTTP ${res.status} ${detail}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ''
}

function extractJSON(text) {
  if (!text) throw new Error('模型返回为空')
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(t)
  } catch {}
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1))
  throw new Error('模型返回的不是有效 JSON')
}

// —— 实体字典（发给模型的唯一数据：名字清单，不含电话/余额等） ——
export function buildDict(ctx) {
  return {
    today: todayStr(),
    weekday: '周' + WEEK_CN[new Date().getDay()],
    students: ctx.students
      .filter((s) => s.status !== 'archived')
      .slice(0, 100)
      .map((s) => (s.enName ? `${s.name}(${s.enName})` : s.name)),
    courses: ctx.courses.map((c) => c.name),
    groups: ctx.groups
      .filter((g) => g.active)
      .map((g) => {
        const c = ctx.courses.find((x) => x.id === g.courseId)
        const wd = (g.weekdays || []).map((n) => '周' + WEEK_CN[n % 7]).join('')
        return `${g.name}（${c?.name || ''} ${wd} ${g.startTime || ''}${g.type === 'limited' ? `,限时至${g.endDate || '?'}` : ''}）`
      }),
  }
}

function buildSystemPrompt(dict) {
  return `你是少儿编程机构教务系统的指令解析器。把用户的每行指令转成 json（只输出一个 json 对象，不要输出任何其他文字）。

当前日期：${dict.today} ${dict.weekday}。日期一律按"离今天最近"理解（如现在是11月，"10.29"=今年的${dict.today.slice(0, 4)}-10-29；"1.20"=明年）。

输出 {"commands":[...]}，commands 数组每行指令一个元素，元素结构按意图：

- enroll（报名建档+课包+入班，出现新学生+课时/金额）:
  {"intent":"enroll","explain":"...","name":"学生名","grade":"","course":"课程名","price":0,"formalHours":100,"giftHours":20,"groupWeekday":3,"groupTime":"17:20"}
- payment（给已有学生缴费/续费）:
  {"intent":"payment","explain":"...","student":"已有学生名","course":"课程名","price":0,"formalHours":100,"giftHours":0}
- join（把学生加入已有班课，不含课时金额；"长期/以后"且目标为限时班时 toRecurring=true）:
  {"intent":"join","explain":"...","students":[{"name":"中文名","enName":"英文名"}],"groupWeekday":3,"groupTime":"17:20","groupName":"班课名(可选)","toRecurring":true}
- schedule（排课，一行一个班课）:
  {"intent":"schedule","explain":"...","type":"recurring|limited|single","weekdays":[4],"startDate":"YYYY-MM-DD","endDate":"","startTime":"17:20","endTime":"19:20","name":"班课名","course":"课程名","students":["学生名",...],"pool":"formal|gift"}
  limited 必须有 startDate/endDate；single 用 startDate；recurring 不用日期。
  pool：班课名或日期是比赛（城市赛/华南赛/国赛/世锦赛/锦标赛/公开赛/邀请赛/全天比赛等）时填 "gift"，普通训练课填 "formal"。
- attendance（点名，全员默认到课+例外）:
  {"intent":"attendance","explain":"...","mode":"single|date_all","date":"YYYY-MM-DD","groupName":"指名的班课名(没指名则省略)","groupWeekday":null,"groupTime":"","exceptions":[{"name":"学生名","status":"leave|absent"}]}
  指名班课用 single；"X月X日的课程/全部课"用 date_all 且省略 groupName。
- leave（给学生登记请假）:
  {"intent":"leave","explain":"...","student":"学生名","date":"YYYY-MM-DD(可空=下次课)"}
- query_hours（查某学生剩余课时）: {"intent":"query_hours","explain":"...","student":"学生名"}
- query_renewal（谁该续费）: {"intent":"query_renewal","explain":"..."}
- query_schedule（某天几节课）: {"intent":"query_schedule","explain":"...","date":"YYYY-MM-DD"}
- unknown（听不懂）: {"intent":"unknown","explain":"为什么没听懂"}

已知实体（尽量使用这些标准名）：
学生：${dict.students.join('、') || '无'}
课程：${dict.courses.join('、') || '无'}
班课：${dict.groups.join('；') || '无'}

规则：
1. 学生名要用已知实体里的标准名（英文名要对应到中文名），新学生可不在列表里
2. 金额/课时只填数字；不确定的字段省略
3. 赠送/比赛课时填 giftHours，正式课时填 formalHours
4. explain 用一句话说明你的理解
5. 每行用户输入对应一个 command 元素，顺序保持`
}

// —— 主入口：文本 → 语义指令数组（未做实体对号） ——
export async function parseWithLLM(text, dict) {
  const conf = getLLMConf()
  if (!conf?.key) throw new Error('未配置大模型')
  const content = await chat(conf, [
    { role: 'system', content: buildSystemPrompt(dict) },
    { role: 'user', content: text },
  ])
  const json = extractJSON(content)
  if (!json || !Array.isArray(json.commands)) throw new Error('模型返回格式异常')
  return json.commands
}

// —— 未听懂句子收集（帮助持续改进，攒着一次性反馈） ——
const MISS_KEY = 'gm_nlu_misses'
export function logNluMisses(commands) {
  try {
    const list = JSON.parse(localStorage.getItem(MISS_KEY) || '[]')
    for (const c of commands) {
      if (c && (c.intent === 'unknown' || c.ok === false)) {
        const t = String(c.raw || '').slice(0, 200)
        if (t && !list.some((x) => x.text === t)) list.unshift({ text: t, ts: new Date().toISOString() })
      }
    }
    localStorage.setItem(MISS_KEY, JSON.stringify(list.slice(0, 50)))
  } catch {}
}
export function getNluMisses() {
  try {
    return JSON.parse(localStorage.getItem(MISS_KEY) || '[]')
  } catch {
    return []
  }
}
export function clearNluMisses() {
  localStorage.removeItem(MISS_KEY)
}
