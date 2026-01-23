import { NextRequest, NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await getServerSupabaseClient(request);
    const url = new URL(request.url);
    const monitorId = url.searchParams.get("monitorId");
    const status = url.searchParams.get("status");

    let query = supabase
      .from("monitor_incidents")
      .select("id, monitor_id, started_at, resolved_at, monitors (nickname, ip_address)")
      .order("started_at", { ascending: false });

    if (monitorId) {
      query = query.eq("monitor_id", monitorId);
    }

    if (status === "open") {
      query = query.is("resolved_at", null);
    } else if (status === "resolved") {
      query = query.not("resolved_at", "is", null);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const incidents = (data ?? []).map((incident) => ({
      id: incident.id,
      monitorId: incident.monitor_id,
      startedAt: incident.started_at,
      resolvedAt: incident.resolved_at,
      nickname: incident.monitors?.nickname ?? null,
      ip: incident.monitors?.ip_address ?? null,
    }));

    return NextResponse.json({ incidents });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to load incidents" }, { status: 500 });
  }
}
