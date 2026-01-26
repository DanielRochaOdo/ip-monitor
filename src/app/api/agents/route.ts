import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const { data, error } = await supabase
      .from("agents")
      .select("id, name, site, is_active, last_seen_at, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const payload = (await request.json()) as { name?: string; site?: string };
    const name = payload?.name?.trim();
    const site = payload?.site?.trim();

    if (!name || !site) {
      return NextResponse.json({ error: "name e site sao obrigatorios" }, { status: 400 });
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("agents")
      .insert({
        user_id: user.id,
        name,
        site,
        token_hash: tokenHash,
        is_active: true,
        created_at: now,
        updated_at: now,
      })
      .select("id, name, site, is_active, last_seen_at, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Token is returned only once. We never store it in plaintext.
    return NextResponse.json({ agent: data, token });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

