-- LAN Agent + FortiGate devices support.
-- This keeps the original multi-tenant model for dashboard users, and adds an agent layer
-- for private-network checks (10.x/192.168.x/172.16-31.x) where cloud ICMP is not possible.

create extension if not exists "pgcrypto";

-- Agents are installed inside the LAN. They authenticate to the app using a token (hashed at rest).
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  site text not null,
  token_hash text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create index if not exists agents_user_active_idx on agents(user_id, is_active);

-- Extend monitors to support LAN agents + more check types and a richer status surface.
alter table monitors
  add column if not exists agent_id uuid references agents(id) on delete set null,
  add column if not exists http_url text,
  add column if not exists http_method text default 'GET' check (http_method in ('GET','HEAD')),
  add column if not exists http_expected_status int default 200 check (http_expected_status >= 100 and http_expected_status <= 599),
  add column if not exists port int,
  add column if not exists last_latency_ms int,
  add column if not exists last_error text,
  add column if not exists failure_count int not null default 0,
  add column if not exists status text check (status in ('UP','DOWN','DEGRADED'));

-- Expand allowed check types (cloud cron still runs only TCP/HTTP; ICMP is for LAN agent).
alter table monitors
  drop constraint if exists monitors_check_type_check;
alter table monitors
  add constraint monitors_check_type_check
  check (check_type in ('TCP','HTTP','ICMP'));

create index if not exists monitors_agent_idx on monitors(agent_id, is_active);

-- Extend monitor_checks to include the origin and which agent produced the data.
alter table monitor_checks
  add column if not exists source text not null default 'CLOUD' check (source in ('CLOUD','LAN')),
  add column if not exists agent_id uuid references agents(id) on delete set null,
  add column if not exists check_method text;

-- Allow DEGRADED samples (ex.: TCP reachable via ECONNREFUSED).
alter table monitor_checks
  drop constraint if exists monitor_checks_status_check;
alter table monitor_checks
  add constraint monitor_checks_status_check
  check (status in ('UP','DOWN','DEGRADED'));

create index if not exists monitor_checks_source_idx on monitor_checks(source, checked_at desc);
create index if not exists monitor_checks_agent_idx on monitor_checks(agent_id, checked_at desc);

-- Network devices (FortiGate etc.) are modeled as one device with multiple metrics per sample.
create table if not exists network_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site text not null,
  hostname text,
  vendor text not null default 'Fortinet',
  model text,
  firmware_expected text,
  wan_public_ips text[] not null default array[]::text[],
  lan_ip text,
  agent_id uuid references agents(id) on delete set null,
  mgmt_method text not null default 'API' check (mgmt_method in ('API','SNMP','TCP_ONLY')),
  mgmt_port int not null default 443,
  api_base_url text,
  api_token_secret_ref text,
  snmp_version text check (snmp_version in ('v2c','v3')),
  snmp_target text,
  snmp_community text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists network_devices_user_site_idx on network_devices(user_id, site);
create index if not exists network_devices_agent_idx on network_devices(agent_id);

create table if not exists device_metrics (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references network_devices(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  checked_at timestamptz not null default now(),
  reachable boolean not null default false,
  status text not null check (status in ('UP','DOWN','DEGRADED')),
  uptime_seconds bigint,
  cpu_percent int,
  mem_percent int,
  sessions int,
  wan1_status text,
  wan1_ip text,
  wan2_status text,
  wan2_ip text,
  lan_status text,
  lan_ip text,
  rx_bps bigint,
  tx_bps bigint,
  error text
);

create index if not exists device_metrics_device_checked_idx on device_metrics(device_id, checked_at desc);
create index if not exists device_metrics_agent_checked_idx on device_metrics(agent_id, checked_at desc);

-- RLS for dashboard users.
alter table agents enable row level security;
create policy "agents_owner" on agents for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table network_devices enable row level security;
create policy "network_devices_owner" on network_devices for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table device_metrics enable row level security;
create policy "device_metrics_owner" on device_metrics for all
  using (exists (select 1 from network_devices d where d.id = device_metrics.device_id and d.user_id = auth.uid()))
  with check (exists (select 1 from network_devices d where d.id = device_metrics.device_id and d.user_id = auth.uid()));

-- monitor_checks is already protected via monitor ownership; keep that and allow LAN rows too.
-- Note: agents write via server-side endpoints (service role), so RLS isn't used for them.
