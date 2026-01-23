import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const { supabase } = await getServerSupabaseClient(request);

    const { data: monitors, error: monitorsError } = await supabase
      .from("monitors")
      .select("id, nickname, ip_address, last_status")
      .order("created_at", { ascending: false });

    if (monitorsError) {
      throw monitorsError;
    }

    const statusCounts = {
      total: monitors?.length ?? 0,
      up: (monitors ?? []).filter((monitor) => monitor.last_status !== "DOWN").length,
      down: (monitors ?? []).filter((monitor) => monitor.last_status === "DOWN").length,
    };

    const { data: incidents, error: incidentsError } = await supabase
      .from("monitor_incidents")
      .select("id, monitor_id, started_at, resolved_at, monitors (nickname, ip_address)")
      .order("started_at", { ascending: false })
      .limit(5);

    if (incidentsError) {
      throw incidentsError;
    }

    const lastIncidents = (incidents ?? []).map((incident) => ({
      id: incident.id,
      monitorId: incident.monitor_id,
      nickname: incident.monitors?.nickname ?? null,
      ip: incident.monitors?.ip_address ?? null,
      startedAt: incident.started_at,
      resolvedAt: incident.resolved_at,
    }));

    return NextResponse.json({
      totalMonitors: statusCounts.total,
      up: statusCounts.up,
      down: statusCounts.down,
      lastIncidents,
    });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to load report" }, { status: 500 });
  }
}
