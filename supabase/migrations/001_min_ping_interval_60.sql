-- Enforce minimum interval of 60 seconds (Vercel Cron runs at most once per minute).

update monitors
set ping_interval_seconds = 60
where ping_interval_seconds < 60;

alter table monitors
drop constraint if exists monitors_ping_interval_seconds_check;

alter table monitors
add constraint monitors_ping_interval_seconds_check
check (ping_interval_seconds >= 60);

