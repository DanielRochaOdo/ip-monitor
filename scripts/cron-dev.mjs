// Dev-only scheduler to mimic Vercel Cron locally.
// Run in a separate terminal: `node scripts/cron-dev.mjs`

const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error("Missing CRON_SECRET in env. Add it to .env and restart.");
  process.exit(1);
}

const intervalMs = Number(process.env.CRON_DEV_INTERVAL_MS ?? 60_000);
if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
  console.error("CRON_DEV_INTERVAL_MS must be a number >= 1000");
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${appUrl}/api/cron/check-monitors`, {
      method: "POST",
      headers: { "cron-secret": cronSecret },
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[cron-dev] ${res.status} ${text}`);
      return;
    }
    console.log(`[cron-dev] ok ${new Date().toISOString()} ${text}`);
  } catch (err) {
    console.error("[cron-dev] error", err);
  }
}

console.log(`[cron-dev] scheduling ${appUrl}/api/cron/check-monitors every ${intervalMs}ms`);
await tick();
setInterval(tick, intervalMs);
