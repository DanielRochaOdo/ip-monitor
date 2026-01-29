import { NextResponse } from "next/server";
import { requireAgentFromRequest } from "@/app/api/agent/_lib";
import { decryptDeviceToken } from "@/lib/crypto/device-token";
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
        "id, user_id, site, hostname, vendor, model, firmware_expected, wan_public_ips, lan_ip, agent_id, mgmt_method, mgmt_port, api_base_url, api_token_secret_ref, api_token_encrypted, step_seconds, interface_interval_seconds, status_interval_seconds, backoff_cap_seconds, iface_cooldown_seconds, snmp_version, snmp_target, snmp_community",
      )
      .eq("agent_id", agent.id)
      .limit(50);

    if (devicesError) {
      return NextResponse.json({ error: devicesError.message }, { status: 500 });
    }

    const deviceIds = (devicesData ?? []).map((d) => (d as { id: string }).id).filter(Boolean);
    const { data: backoffData } = deviceIds.length
      ? await supabaseAdmin
          .from("device_backoff")
          .select(
            "device_id, backoff_seconds, next_allowed_at, iface_next_allowed_at, rate_limit_count, last_error, reason, updated_at",
          )
          .in("device_id", deviceIds)
      : { data: [] as unknown[] };

    const { data: runRequestsData } = deviceIds.length
      ? await supabaseAdmin
          .from("device_run_requests")
          .select("id, device_id, requested_at")
          .in("device_id", deviceIds)
          .is("consumed_at", null)
          .order("requested_at", { ascending: true })
          .limit(50)
      : { data: [] as unknown[] };

    // Normalize a few string fields to avoid subtle whitespace bugs in the agent.
    const normalizedDevices = (devicesData ?? []).map((d) => {
      const row = d as unknown as {
        api_token_secret_ref?: string | null;
        api_token_encrypted?: string | null;
        api_base_url?: string | null;
      };
      const api_token_secret_ref = row.api_token_secret_ref?.trim() || null;
      const api_base_url = row.api_base_url?.trim() || null;
      let api_token: string | null = null;
      if (row.api_token_encrypted) {
        try {
          api_token = decryptDeviceToken(row.api_token_encrypted);
        } catch {
          api_token = null;
        }
      }
      return { ...d, api_token_secret_ref, api_base_url, api_token };
    });

    return NextResponse.json({
      agent,
      monitors: monitorsData ?? [],
      devices: normalizedDevices,
      device_backoff: backoffData ?? [],
      device_run_requests: runRequestsData ?? [],
      now: nowIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unauthorized";
    const status = message.includes("token") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
