create extension if not exists "pgcrypto";

create table monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ip_address text not null,
  nickname text not null,
  ping_interval_seconds int not null default 60 check (ping_interval_seconds >= 60),
  failure_threshold int not null default 2 check (failure_threshold >= 1),
  check_type text not null default 'TCP' check (check_type in ('TCP')),
  ports int[] not null default array[80,443],
  is_active boolean default true,
  last_status text check (last_status in ('UP','DOWN')),
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table monitor_checks (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references monitors(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('UP','DOWN')),
  latency_ms int,
  error_message text
);

create table monitor_incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references monitors(id) on delete cascade,
  started_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  alert_email text not null,
  notify_on_down boolean default true,
  notify_on_up boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index monitors_user_active_idx on monitors(user_id, is_active);
create index monitors_next_check_idx on monitors(next_check_at);
create index monitor_checks_monitor_checked_idx on monitor_checks(monitor_id, checked_at desc);
create index monitor_incidents_monitor_started_idx on monitor_incidents(monitor_id, started_at desc);

alter table monitors enable row level security;
create policy "monitors_owner" on monitors for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table notification_settings enable row level security;
create policy "notification_settings_owner" on notification_settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table monitor_checks enable row level security;
create policy "monitor_checks_owner" on monitor_checks for all
  using (exists (select 1 from monitors m where m.id = monitor_checks.monitor_id and m.user_id = auth.uid()))
  with check (exists (select 1 from monitors m where m.id = monitor_checks.monitor_id and m.user_id = auth.uid()));

alter table monitor_incidents enable row level security;
create policy "monitor_incidents_owner" on monitor_incidents for all
  using (exists (select 1 from monitors m where m.id = monitor_incidents.monitor_id and m.user_id = auth.uid()))
  with check (exists (select 1 from monitors m where m.id = monitor_incidents.monitor_id and m.user_id = auth.uid()));
