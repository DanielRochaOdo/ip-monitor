/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(_request, _env, _ctx): Promise<Response> {
		return new Response("ok");
	},
	async scheduled(_event, env, ctx): Promise<void> {
		ctx.waitUntil(runCron(env));
	},
} satisfies ExportedHandler<Env>;

type Env = {
	APP_URL: string;
	CRON_SECRET: string;
};

async function runCron(env: Env) {
	const appUrl = env.APP_URL?.replace(/\/+$/, "");
	if (!appUrl) {
		throw new Error("APP_URL is missing");
	}
	if (!env.CRON_SECRET) {
		throw new Error("CRON_SECRET is missing");
	}

	const res = await fetch(`${appUrl}/api/cron/check-monitors`, {
		method: "POST",
		headers: {
			"cron-secret": env.CRON_SECRET,
		},
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`[cron] ${res.status} ${text}`);
	}
}
