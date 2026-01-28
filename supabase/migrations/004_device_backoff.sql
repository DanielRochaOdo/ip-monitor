-- Persist per-device backoff so LAN Agent restarts don't cause bursts.
-- This table is written by the app's server-side agent endpoints (service role).

create extension if not exists "pgcrypto";

create table if not exists device_backoff (
  device_id uuid primary key references network_devices(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  backoff_seconds int not null default 0,
  next_allowed_at timestamptz,
  reason text,
  updated_at timestamptz not null default now()
);

create index if not exists device_backoff_agent_idx on device_backoff(agent_id);
create index if not exists device_backoff_next_allowed_idx on device_backoff(next_allowed_at);

alter table device_backoff enable row level security;

-- Dashboard users can read/write only for devices they own.
create policy "device_backoff_owner" on device_backoff for all
  using (
    exists (
      select 1
      from network_devices d
      where d.id = device_backoff.device_id
        and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from network_devices d
      where d.id = device_backoff.device_id
        and d.user_id = auth.uid()
    )
  );

