-- Add encrypted token + per-device overrides for FortiGate (LAN Agent)

alter table network_devices
  add column if not exists api_token_encrypted text,
  add column if not exists step_seconds int,
  add column if not exists interface_interval_seconds int,
  add column if not exists status_interval_seconds int,
  add column if not exists backoff_cap_seconds int,
  add column if not exists iface_cooldown_seconds int;

