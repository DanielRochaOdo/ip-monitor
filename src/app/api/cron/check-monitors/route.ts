import { NextRequest, NextResponse } from "next/server";
import { getRequiredEnv } from "@/lib/env";
import { runMonitorChecks } from "@/lib/cron/check-monitors";

const expectedSecret = getRequiredEnv("CRON_SECRET");

function validateSecret(request: NextRequest) {
  // Vercel Cron Jobs include this header automatically.
  // Note: this can be spoofed, but it's the only signal available from Vercel Cron config.
  // If you want stronger protection, call this endpoint from an external scheduler that can
  // send CRON_SECRET as a header.
  if (request.headers.get("x-vercel-cron") === "1") {
    return true;
  }

  const headerValue =
    request.headers.get("cron-secret") ??
    request.headers.get("cron_secret") ??
    request.headers.get("CRON_SECRET");

  return Boolean(headerValue && headerValue === expectedSecret);
}

async function handleRequest() {
  const payload = await runMonitorChecks();
  return NextResponse.json(payload);
}

export async function GET(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleRequest();
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run checks" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
