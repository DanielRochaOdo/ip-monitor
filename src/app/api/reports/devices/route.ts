import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";

type DeviceBackoffRow = {
  device_id: string;
  backoff_seconds: number;
  next_allowed_at: string | null;
  reason: string | null;
  updated_at: string;
};

type DeviceRunRequestRow = {
  id: string;
  device_id: string;
  requested_at: string;
};

export async function GET(request: Request) {
  try {
    const { supabase } = await getServerSupabaseClient(request);

    const { data: devices, error } = await supabase
      .from("network_devices")
      .select("id, site, hostname, vendor, model, wan_public_ips, lan_ip, mgmt_method")
      .order("site", { ascending: true });

    if (error) throw error;

    const deviceIds = (devices ?? []).map((d) => (d as { id: string }).id).filter(Boolean);
    const { data: backoffRows } = deviceIds.length
      ? await supabase
          .from("device_backoff")
          .select("device_id, backoff_seconds, next_allowed_at, reason, updated_at")
          .in("device_id", deviceIds)
      : { data: [] as unknown[] };

    const backoffByDevice = new Map<string, DeviceBackoffRow>();
    for (const row of (backoffRows ?? []) as unknown as DeviceBackoffRow[]) {
      if (row?.device_id) backoffByDevice.set(row.device_id, row);
    }

    const { data: runRows } = deviceIds.length
      ? await supabase
          .from("device_run_requests")
          .select("id, device_id, requested_at")
          .in("device_id", deviceIds)
          .is("consumed_at", null)
          .order("requested_at", { ascending: true })
      : { data: [] as unknown[] };

    const runByDevice = new Map<string, DeviceRunRequestRow>();
    for (const row of (runRows ?? []) as unknown as DeviceRunRequestRow[]) {
      if (!row?.device_id) continue;
      // If multiple rows exist (shouldn't, due to partial unique index), keep the earliest.
      if (!runByDevice.has(row.device_id)) runByDevice.set(row.device_id, row);
    }

    const result = [];
    for (const device of devices ?? []) {
      const { data: metric } = await supabase
        .from("device_metrics")
        .select(
          "checked_at, reachable, status, uptime_seconds, cpu_percent, mem_percent, sessions, wan1_status, wan1_ip, wan2_status, wan2_ip, lan_status, lan_ip, error",
        )
        .eq("device_id", device.id)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      result.push({
        device,
        latest: metric ?? null,
        backoff: backoffByDevice.get(device.id) ?? null,
        run_request: runByDevice.get(device.id) ?? null,
      });
    }

    return NextResponse.json({ devices: result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to load devices" }, { status: 500 });
  }
}
