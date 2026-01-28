import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getIdFromContext(context: RouteContext) {
  const params = await Promise.resolve(context.params);
  return params.id;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const id = await getIdFromContext(context);
    const { supabase, user } = await getServerSupabaseClient(request);

    // Ensure the device exists and belongs to the logged-in user (RLS also enforces this).
    const { data: device, error: deviceError } = await supabase
      .from("network_devices")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (deviceError) throw deviceError;
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

    const { error: insertError } = await supabase.from("device_run_requests").insert({
      device_id: id,
      requested_by: user.id,
    });

    // Partial unique index prevents multiple pending rows; treat it as "already queued".
    if (insertError && (insertError as { code?: string }).code === "23505") {
      return NextResponse.json({ ok: true, queued: true, alreadyQueued: true });
    }

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, queued: true, alreadyQueued: false });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unable to queue run request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

