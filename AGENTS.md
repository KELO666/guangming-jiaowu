# AGENTS.md — AI 助手项目须知

> 供各类 AI 编码工具（Codex / Claude Code / Cursor / ZCode…）打开本项目时自动加载。
> 深度背景（架构详解、数据模型、历史决策、20 轮踩坑记录）在 **交接日志.md**——做任何实质性改动前先读它。

## 项目一句话

少儿编程机器人机构（光明校区）的教务管理系统：学生 → 课包（正式池+赠送池）→ 排课 → 点名消课 → 续费预警，外加"说一句话就办好事"的智能助手。React 18 SPA + Supabase（PostgreSQL + Auth + RLS），无自建后端。

## 常用命令

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
npm run build      # 生产构建 → dist/（自动读取 .env.production）
npm run preview    # 本地预览构建产物
```

- **部署 = `git push` 到 main**，GitHub Actions 自动构建发布（约 2 分钟），线上 https://kelo666.github.io/guangming-jiaowu/
- ⚠️ **本机 shell 的 http_proxy/https_proxy 环境变量指向已失效的 127.0.0.1:7890**，会劫持所有网络请求。访问 GitHub/Supabase 终端操作用：
  `env -u http_proxy -u https_proxy -u all_proxy git push`（curl/npm 同理）；
  直连仍失败时改走本地代理：`git -c http.proxy=http://127.0.0.1:7891 push`。

## 目录结构

```
src/
├─ main.jsx            # 入口：createRoot + HashRouter（兼容任意静态托管）
├─ App.jsx             # 路由表
├─ store.jsx           # 全局状态 useApp() + 业务动作（saveAttendance/resetAttendance…）
├─ ui.jsx              # 共享 UI 组件（Button/Input/Card/Modal/Badge/Avatar…）
├─ styles.css          # Tailwind v4 入口
├─ api/
│  ├─ cloud.js         # Supabase 适配器（生产模式）
│  ├─ local.js         # localStorage 适配器（演示/离线），业务代码双实现复用
│  ├─ seed.js          # 演示数据（注意：已用虚构名）
│  └─ index.js         # 适配器选择
├─ lib/                # 纯业务逻辑：core（工具）/ logic（消课计算）/ parser + nlu + actions（助手）/ llm / schema（本地建表）/ sheet（Excel）
├─ pages/              # Today 今日课表 / Schedule 排课 / Students 学生 / Attendance 点名 / Records 记录 / Stats 看板 / Settings 设置 / Login / Setup
└─ components/         # AttendanceSheet 点名面板 / GroupFormModal 班课表单 / Assistant 助手 / ImportWizard Excel 导入 / Layout / RosterPicker / TextScheduleModal 文字排课
```

## 必须遵守的规则

1. **业务口径不可改动**：课时单位=小时；课包双池（正式计费 + 赠送"比赛课时"计 ¥0）；允许负课时（不足照上，红色置顶待续费名单）；排课名命中比赛关键词自动扣赠送池；点名默认全员到课只标例外；消课可撤销、按快照自动回冲。
2. **凭据红线**：数据库密码 / service_role key / sbp_ 个人令牌 / LLM API Key 永不入库（.gitignore 已防）。`.env.production` 仅含公开的 URL + anon key（受 RLS 保护），允许入库。
3. **本仓库是公开仓库**：任何真实客户信息（学生真名、家长联系方式、消费记录）不得提交；文档与代码示例一律用虚构名（历史中的真名已在公开发布时清洗）。
4. **改数据库结构三处同步**：`src/lib/schema.js`、`supabase-schema.sql`、Supabase 后台。消课加速函数 `apply_attendance` / `reset_attendance` 在 schema.sql 末尾——改消课逻辑时必须同步这两个函数（生产库已建，前端自动探测、缺失自动回退逐条路径）。
5. **cloud.js 的 `toRow` 会把日期/时间戳/数值/ID 类字段的空字符串归一为 null**（v1.4.4，防 Postgres "invalid input syntax" 类报错）——新表单不需要自行处理空串；不要绕过 toRow 直发 PostgREST。
6. **UI 用共享组件**（src/ui.jsx）；Button 已全局 `whitespace-nowrap shrink-0`（防中文按钮文字被 flex 压成竖排），别手写裸 button 样式。
7. **路由是 HashRouter、vite `base: './'`**——任意静态托管子路径可用；不要改成 BrowserRouter 或绝对 base。
8. **改完必须 `npm run build` 验证**再提交；涉及数据写入的改动，在真实库上做完整回环测试（创建→验证→清理测试数据）并在测试日志记一轮。

## 当前状态速览

- 版本 v1.4.4 · 已上线 · 数据库 Supabase 新加坡区（cron-job.org 每 3 天 GET 防休眠）
- 手机端与电脑端同一网址自适应；各设备首次使用需重配 DeepSeek Key（localStorage 按域名隔离，系统设置里填）
- 每月备份：系统满 30 天自动弹窗提醒，导出 JSON 存本地

## 文档地图

| 文档 | 用途 |
|---|---|
| 交接日志.md | **必读**：架构、数据模型、全文件清单、设计决策、运维手册、托管方案史 |
| 测试日志.md | 20 轮测试记录、已修复 bug 清单、回归指引 |
| 部署指南.md | 从零上线步骤（Supabase + GitHub Pages） |
| 使用说明.md | 机构老板的日常操作手册 |
