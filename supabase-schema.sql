-- 光明教务 · Supabase 建表脚本
-- 用法：Supabase 控制台 → SQL Editor → 新建查询 → 粘贴本文件全部内容 → Run
-- （系统内「设置 → 连接云端」向导中也可复制同样的内容）

create extension if not exists "pgcrypto";

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  en_name text,
  grade text,
  gender text,
  birth_date date,
  school text,
  parent_name text,
  phone text,
  wechat text,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text default '#3b82f6',
  created_at timestamptz not null default now()
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  kind text not null default 'formal',          -- formal 正式池 / gift 赠送池
  bundle_id uuid,                               -- 同一次缴费的正式+赠送归为一组
  total_hours numeric not null default 0,
  used_hours numeric not null default 0,
  price numeric not null default 0,             -- 赠送池为 0
  purchased_at date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists class_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  course_id uuid references courses(id) on delete set null,
  type text not null default 'recurring',       -- recurring 长期 / limited 限时 / single 单次
  weekdays jsonb,                               -- ISO 周几数组，如 [4] 或 [5,6]
  start_date date,
  end_date date,
  start_time text,
  end_time text,
  hours numeric default 2,
  default_pool text default 'formal',
  location text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists class_group_students (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references class_groups(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  unique(group_id, student_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references class_groups(id) on delete set null,
  course_id uuid references courses(id) on delete set null,
  date date not null,
  start_time text not null default '18:00',
  end_time text not null default '20:00',
  hours numeric not null default 2,
  content text,
  location text,
  pool text,                                    -- 为空时用班课的 default_pool
  status text not null default 'scheduled',     -- scheduled / completed / cancelled
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null default 'present',       -- present / leave / absent / makeup
  package_id uuid references packages(id) on delete set null,
  hours numeric default 0,
  amount numeric default 0,
  marked boolean not null default true,
  marked_at timestamptz,
  unique(session_id, student_id)
);

create table if not exists settings (
  key text primary key,
  value jsonb
);

-- 行级安全：只有登录的管理员能读写
alter table students enable row level security;
alter table courses enable row level security;
alter table packages enable row level security;
alter table class_groups enable row level security;
alter table class_group_students enable row level security;
alter table sessions enable row level security;
alter table attendance enable row level security;
alter table settings enable row level security;

create policy "auth_all_students" on students for all to authenticated using (true) with check (true);
create policy "auth_all_courses" on courses for all to authenticated using (true) with check (true);
create policy "auth_all_packages" on packages for all to authenticated using (true) with check (true);
create policy "auth_all_groups" on class_groups for all to authenticated using (true) with check (true);
create policy "auth_all_group_students" on class_group_students for all to authenticated using (true) with check (true);
create policy "auth_all_sessions" on sessions for all to authenticated using (true) with check (true);
create policy "auth_all_attendance" on attendance for all to authenticated using (true) with check (true);
create policy "auth_all_settings" on settings for all to authenticated using (true) with check (true);
