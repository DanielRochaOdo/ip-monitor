import { NextResponse } from "next/server";
import { requireAgentFromRequest } from "@/app/api/agent/_lib";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const agent = await requireAgentFromRequest(request);
    const nowIso = new Date().toISOString();

    const { data: monitorsData, error: monitorsError } = await supabaseAdmin
      .from("monitors")
      .select(
        "id, user_id, ip_address, nickname, check_type, ports, port, http_url, http_method, http_expected_status, ping_interval_seconds, failure_threshold, success_threshold, next_check_at, is_active, is_private",
      )
      .eq("agent_id", agent.id)
      .eq("is_active", true)
      .lte("next_check_at", nowIso)
      .order("next_check_at", { ascending: true })
      .limit(200);

    if (monitorsError) {
      return NextResponse.json({ error: monitorsError.message }, { status: 500 });
    }

    const { data: devicesData, error: devicesError } = await supabaseAdmin
      .from("network_devices")
      .select(
        "id, user_id, site, hostname, vendor, model, firmware_expected, wan_public_ips, lan_ip, agent_id, mgmt_method, mgmt_port, api_base_url, api_token_secret_ref, snmp_version, snmp_target, snmp_community",
      )
      .eq("agent_id", agent.id)
      .limit(50);

    if (devicesError) {
      return NextResponse.json({ error: devicesError.message }, { status: 500 });
    }

    return NextResponse.json({
      agent,
      monitors: monitorsData ?? [],
      devices: devicesData ?? [],
      now: nowIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unauthorized";
    const status = message.includes("token") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

