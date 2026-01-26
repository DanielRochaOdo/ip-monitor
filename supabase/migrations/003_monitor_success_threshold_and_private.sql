-- Additional monitor state fields used by the LAN Agent.

alter table monitors
  add column if not exists success_threshold int not null default 1 check (success_threshold >= 1),
  add column if not exists success_count int not null default 0,
  add column if not exists is_private boolean not null default false;

