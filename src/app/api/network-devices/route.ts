import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { encryptDeviceToken } from "@/lib/crypto/device-token";

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

function normalizeIps(value: NetworkDevicePayload["wan_public_ips"]): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/[;, ]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const { data, error } = await supabase
      .from("network_devices")
      .select(
        "id, site, hostname, vendor, model, firmware_expected, wan_public_ips, lan_ip, agent_id, mgmt_method, mgmt_port, api_base_url, api_token_secret_ref, api_token_encrypted, step_seconds, interface_interval_seconds, status_interval_seconds, backoff_cap_seconds, iface_cooldown_seconds, snmp_version, snmp_target, snmp_community, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .order("site", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const devices = (data ?? []).map((row) => {
      const has_token = !!row.api_token_encrypted;
      // Do not expose encrypted token.
      const { api_token_encrypted: _token, ...rest } = row;
      return { ...rest, has_token };
    });

    return NextResponse.json({ devices });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const payload = (await request.json()) as NetworkDevicePayload;

    if (!payload.site?.trim()) {
      return NextResponse.json({ error: "Site e obrigatorio" }, { status: 400 });
    }

    const api_token_encrypted =
      payload.api_token && payload.api_token.trim()
        ? encryptDeviceToken(payload.api_token.trim())
        : null;

    const { error } = await supabase.from("network_devices").insert({
      user_id: user.id,
      site: payload.site.trim(),
      hostname: payload.hostname?.trim() || null,
      vendor: payload.vendor?.trim() || "Fortinet",
      model: payload.model?.trim() || null,
      firmware_expected: payload.firmware_expected?.trim() || null,
      wan_public_ips: normalizeIps(payload.wan_public_ips),
      lan_ip: payload.lan_ip?.trim() || null,
      agent_id: payload.agent_id || null,
      mgmt_method: payload.mgmt_method ?? "API",
      mgmt_port: payload.mgmt_port ?? 4434,
      api_base_url: payload.api_base_url?.trim() || null,
      api_token_secret_ref: payload.api_token_secret_ref?.trim() || null,
      api_token_encrypted,
      step_seconds: payload.step_seconds ?? null,
      interface_interval_seconds: payload.interface_interval_seconds ?? null,
      status_interval_seconds: payload.status_interval_seconds ?? null,
      backoff_cap_seconds: payload.backoff_cap_seconds ?? null,
      iface_cooldown_seconds: payload.iface_cooldown_seconds ?? null,
      snmp_version: payload.snmp_version ?? null,
      snmp_target: payload.snmp_target ?? null,
      snmp_community: payload.snmp_community ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
