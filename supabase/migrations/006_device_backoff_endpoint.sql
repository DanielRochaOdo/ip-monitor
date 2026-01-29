-- Extend device_backoff with endpoint cooldown + rate limit metadata.

alter table device_backoff
  add column if not exists rate_limit_count int not null default 0,
  add column if not exists last_error text,
  add column if not exists iface_next_allowed_at timestamptz;

create index if not exists device_backoff_iface_next_allowed_idx on device_backoff(iface_next_allowed_at);
