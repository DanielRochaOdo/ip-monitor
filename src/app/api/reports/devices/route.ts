import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const { supabase } = await getServerSupabaseClient(request);

    const { data: devices, error } = await supabase
      .from("network_devices")
      .select("id, site, hostname, vendor, model, wan_public_ips, lan_ip, mgmt_method")
      .order("site", { ascending: true });

    if (error) throw error;

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

      result.push({ device, latest: metric ?? null });
    }

    return NextResponse.json({ devices: result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to load devices" }, { status: 500 });
  }
}

