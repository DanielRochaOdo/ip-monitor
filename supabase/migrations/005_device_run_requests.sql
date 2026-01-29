-- Manual "run now" requests for network devices.
-- The dashboard can enqueue a request, and the LAN Agent will pick it up on the next cycle.

create table if not exists device_run_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references network_devices(id) on delete cascade,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  consumed_at timestamptz null,
  consumed_by uuid null references agents(id) on delete set null
);

-- Only one pending request per device (prevents button spam).
create unique index if not exists device_run_requests_pending_uniq
  on device_run_requests(device_id)
  where consumed_at is null;

create index if not exists device_run_requests_device_idx on device_run_requests(device_id);
create index if not exists device_run_requests_consumed_idx on device_run_requests(consumed_at);

alter table device_run_requests enable row level security;

-- Dashboard user can manage requests only for their own devices.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'device_run_requests'
      and policyname = 'device_run_requests_owner_read'
  ) then
    create policy "device_run_requests_owner_read" on device_run_requests for select
      using (
        exists (
          select 1
          from network_devices d
          where d.id = device_run_requests.device_id
            and d.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'device_run_requests'
      and policyname = 'device_run_requests_owner_insert'
  ) then
    create policy "device_run_requests_owner_insert" on device_run_requests for insert
      with check (
        exists (
          select 1
          from network_devices d
          where d.id = device_run_requests.device_id
            and d.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'device_run_requests'
      and policyname = 'device_run_requests_owner_delete'
  ) then
    create policy "device_run_requests_owner_delete" on device_run_requests for delete
      using (
        exists (
          select 1
          from network_devices d
          where d.id = device_run_requests.device_id
            and d.user_id = auth.uid()
        )
      );
  end if;
end $$;
