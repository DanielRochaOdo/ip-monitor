# IP Monitor

Full-stack Next.js monitoring platform built with the Bolt.new pattern. Users register IPs, Supabase cron jobs run TCP health checks, incidents capture state transitions, and SMTP emails (via Supabase relay) deliver elegant alerts.

## Stack

- **Framework**: Next.js App Router with React + TailwindCSS (Tailwind v4)
- **Database**: Supabase Postgres with migrations, indexes, and RLS policies in `supabase/migrations/000_initial.sql`
- **Auth**: Supabase Auth via email/password + password reset
- **Monitoring engine**: Cron endpoint at `/api/cron/check-monitors` powered by a service-role Supabase client
- **Emails**: Supabase SMTP relay + HTML templates (`src/lib/email/templates.ts`)
- **Charts**: Recharts for dashboard/report trends

## Features

1. **Authentication & protection**
   - `/login`, `/signup`, `/reset-password` for auth flows
   - Client-side protection redirects to `/login` if no session
2. **Monitoring CRUD**
   - Full REST API (`/api/monitors`, `/api/monitors/[id]`) + UI for listing, creating, toggling, deleting, and editing monitors
3. **Monitoring engine (Cloud + LAN Agent)**
   - Cloud cron selects due cloud monitors (`agent_id IS NULL`), runs TCP checks, records `monitor_checks`, tracks transitions, and manages incidents
   - LAN Agent runs inside your network to monitor private IPs and FortiGate health (ICMP real + API/SNMP), recording checks and triggering alerts
   - Failure threshold (default 2) prevents spamming alerts
4. **Notifications**
   - Emails include last checks summary, incident timestamps, and dashboard link
   - Settings page lets users customize alert email + whether to notify on DOWN/UP
5. **Reports & UX**
   - Dashboard summary + chart, monitors list with search, detail view with checks history
   - Reports page with filters, CSV export, and trend chart
   - Tailwind-based layout with sidebar, header, and toasts for feedback

## Getting started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` and sign up. Protected UI lives under `/dashboard`, `/monitors`, `/reports`, and `/settings`.

### Environment variables

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only, used by cron) |
| `APP_URL` | Canonical app URL (used inside emails); optional on Vercel because `VERCEL_URL` is used automatically |
| `CRON_SECRET` | Shared secret required by `/api/cron/check-monitors` |
| `SMTP_HOST` | Supabase SMTP host (Settings > Email under your project) |
| `SMTP_PORT` | Corresponding SMTP port (usually 587) |
| `SMTP_USERNAME` | SMTP username provided by Supabase |
| `SMTP_PASSWORD` | SMTP password provided by Supabase |
| `EMAIL_FROM` | Sender address allowed by your SMTP configuration |

Add those to `.env.local` locally and in your deployment dashboard.

### Database & Supabase

1. Run the migrations in `supabase/migrations/` (in order) to create tables, indexes, and RLS policies.
2. Supabase tables:
   - `monitors`: per-user IPs, intervals, thresholds, `next_check_at`, and status metadata
   - `monitor_checks`: health check history (now includes `source=CLOUD|LAN`, `agent_id`, and `check_method`)
   - `monitor_incidents`: state transitions
   - `notification_settings`: per-user email + opt-in flags
   - `agents`: LAN Agents (token hashed at rest)
   - `network_devices`: devices (FortiGate etc.)
   - `device_metrics`: time series metrics collected by LAN Agents
3. RLS policies allow users only to access their data; service-role queries bypass RLS for cron tasks.

### Cron & monitoring

- The endpoint `/api/cron/check-monitors` accepts `GET` or `POST` requests.
- In Vercel, it also accepts Vercel Cron calls (`x-vercel-cron: 1`). For other schedulers, send the header `cron-secret: <CRON_SECRET>`.
- Schedule it via:
  1. **Vercel Cron Jobs (Pro)**: if you are on Pro, you can run every minute.
  2. **Vercel Hobby (free)**: Vercel limits cron to daily runs, so you must use an external scheduler for every-minute monitoring.
  3. **External scheduler (recommended on Hobby)**: any cron service that can call a URL every minute and send a header can be used.
     - Example: Cloudflare Workers Cron Trigger (free) calling your Vercel endpoint every minute with `cron-secret`.

#### Practical production setup on Vercel Hobby (free): Cloudflare Worker Cron

1. Deploy the app to Vercel normally (cron in `vercel.json` is set to daily just to satisfy Hobby limits).
2. Create a Cloudflare Worker and add a Cron Trigger with `* * * * *`.
3. Add two environment variables in the Worker:
   - `APP_URL`: your production URL, e.g. `https://your-app.vercel.app`
   - `CRON_SECRET`: same value as in your Vercel env vars
4. Worker code:

```js
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(`${env.APP_URL}/api/cron/check-monitors`, {
      method: "POST",
      headers: { "cron-secret": env.CRON_SECRET },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[cron] ${res.status} ${text}`);
    }
  },
};
```

#### Private IPs + FortiGate: use the LAN Agent

If you are monitoring private IPs (RFC1918 like `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`), a cloud scheduler (Vercel/Cloudflare) will NOT be able to reach them. Use the LAN Agent instead:

1) In the app: go to `/settings` and create an "Agente LAN" (you will get a token once).
2) Create monitors with origem "LAN Agent" and (optionally) check_type `ICMP` / `TCP` / `HTTP`.
3) Run the agent inside the LAN:
   - `lan-agent/README.md` has Docker + local instructions
4) For FortiGate monitoring, read `docs/fortigate-monitoring.md`.

### Local dev auto-checks

- Run `npm run dev:cron` in another terminal to trigger the cron endpoint periodically (default: every 60 seconds).
- Or run both together: `npm run dev:all`.

### APIs & helpers

- `GET/POST /api/monitors`, `GET/PATCH/DELETE /api/monitors/:id`
- `GET /api/reports/summary`, `GET /api/reports/checks?monitorId&status&from&to&format=csv`
- `GET /api/reports/devices` (latest FortiGate metrics per device)
- `GET /api/incidents?monitorId&status=open|resolved`
- `GET/PATCH /api/settings/notifications`
- `GET/POST /api/agents` (create and list LAN Agents; token is returned only once on create)
- `POST /api/agent/pull`, `POST /api/agent/report` (LAN Agent protocol)
- `GET/POST /api/cron/check-monitors` (header `CRON_SECRET`)

Server utilities:

- `src/lib/cron/check-monitors.ts` runs the health checks, manages incidents, and dispatches SMTP alerts via Supabase credentials
- `src/lib/network/check-monitor.ts` performs TCP port probes
- `src/lib/email/templates.ts` and `send.ts` define the alert copy
- `src/lib/supabase/*` centralizes Supabase clients and types

## Deployment

1. Push to GitHub and connect the repo to Vercel.
2. Add the required environment variables in Vercel project settings.
3. Configure a Vercel Cron Job (or Supabase scheduled job) hitting `/api/cron/check-monitors` every minute with header `CRON_SECRET`.

## Testing & verification

- `npm run dev` for local development.
- Use `curl -H "CRON_SECRET:<secret>" https://<APP_URL>/api/cron/check-monitors` to trigger a manual run.
- Watch the dashboard, add monitors, and toggle them to verify incidents and emails.

## Notes

- All frontend interactions use Tailwind UI-inspired cards, badges, and charts.
- Toasts (`src/components/toast-provider.tsx`) provide instant success/error feedback.
- The layout features a sidebar/app shell (`src/components/app-shell.tsx`) ensuring consistent navigation.
