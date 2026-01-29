import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { encryptDeviceToken } from "@/lib/crypto/device-token";

type Params = { params: Promise<{ id: string }> };

type NetworkDevicePayload = {
  site?: string;
  hostname?: string | null;
  vendor?: string;
  model?: string | null;
  firmware_expected?: string | null;
  wan_public_ips?: string[] | string | null;
  lan_ip?: string | null;
  agent_id?: string | null;
  mgmt_method?: "API" | "SNMP" | "TCP_ONLY";
  mgmt_port?: number | null;
  api_base_url?: string | null;
  api_token_secret_ref?: string | null;
  api_token?: string | null;
  step_seconds?: number | null;
  interface_interval_seconds?: number | null;
  status_interval_seconds?: number | null;
  backoff_cap_seconds?: number | null;
  iface_cooldown_seconds?: number | null;
  snmp_version?: "v2c" | "v3" | null;
  snmp_target?: string | null;
  snmp_community?: string | null;
};

function normalizeIps(value: NetworkDevicePayload["wan_public_ips"]): string[] | undefined {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return undefined;
  return value
    .split(/[;, ]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const { id } = await params;
    const { data, error } = await supabase
      .from("network_devices")
      .select(
        "id, site, hostname, vendor, model, firmware_expected, wan_public_ips, lan_ip, agent_id, mgmt_method, mgmt_port, api_base_url, api_token_secret_ref, api_token_encrypted, step_seconds, interface_interval_seconds, status_interval_seconds, backoff_cap_seconds, iface_cooldown_seconds, snmp_version, snmp_target, snmp_community, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Device not found" }, { status: 404 });

    const { api_token_encrypted: _token, ...rest } = data;
    return NextResponse.json({ device: { ...rest, has_token: !!_token } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const { id } = await params;
    const payload = (await request.json()) as NetworkDevicePayload;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.site !== undefined) updates.site = payload.site?.trim() || null;
    if (payload.hostname !== undefined) updates.hostname = payload.hostname?.trim() || null;
    if (payload.vendor !== undefined) updates.vendor = payload.vendor?.trim() || null;
    if (payload.model !== undefined) updates.model = payload.model?.trim() || null;
    if (payload.firmware_expected !== undefined) updates.firmware_expected = payload.firmware_expected?.trim() || null;
    if (payload.wan_public_ips !== undefined) updates.wan_public_ips = normalizeIps(payload.wan_public_ips) ?? [];
    if (payload.lan_ip !== undefined) updates.lan_ip = payload.lan_ip?.trim() || null;
    if (payload.agent_id !== undefined) updates.agent_id = payload.agent_id || null;
    if (payload.mgmt_method !== undefined) updates.mgmt_method = payload.mgmt_method;
    if (payload.mgmt_port !== undefined) updates.mgmt_port = payload.mgmt_port ?? null;
    if (payload.api_base_url !== undefined) updates.api_base_url = payload.api_base_url?.trim() || null;
    if (payload.api_token_secret_ref !== undefined) {
      updates.api_token_secret_ref = payload.api_token_secret_ref?.trim() || null;
    }
    if (payload.api_token !== undefined) {
      updates.api_token_encrypted =
        payload.api_token && payload.api_token.trim() ? encryptDeviceToken(payload.api_token.trim()) : null;
    }
    if (payload.step_seconds !== undefined) updates.step_seconds = payload.step_seconds;
    if (payload.interface_interval_seconds !== undefined)
      updates.interface_interval_seconds = payload.interface_interval_seconds;
    if (payload.status_interval_seconds !== undefined) updates.status_interval_seconds = payload.status_interval_seconds;
    if (payload.backoff_cap_seconds !== undefined) updates.backoff_cap_seconds = payload.backoff_cap_seconds;
    if (payload.iface_cooldown_seconds !== undefined) updates.iface_cooldown_seconds = payload.iface_cooldown_seconds;
    if (payload.snmp_version !== undefined) updates.snmp_version = payload.snmp_version;
    if (payload.snmp_target !== undefined) updates.snmp_target = payload.snmp_target?.trim() || null;
    if (payload.snmp_community !== undefined) updates.snmp_community = payload.snmp_community?.trim() || null;

    const { error } = await supabase
      .from("network_devices")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const { id } = await params;
    const { error } = await supabase.from("network_devices").delete().eq("id", id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao excluir device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
