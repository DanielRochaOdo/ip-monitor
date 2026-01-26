import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type AuthedAgent = {
  id: string;
  user_id: string;
  name: string;
  site: string;
};

export function hashAgentToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export async function requireAgentFromRequest(request: Request): Promise<AuthedAgent> {
  const token = request.headers.get("x-agent-token")?.trim();
  if (!token) {
    throw new Error("missing agent token");
  }

  const tokenHash = hashAgentToken(token);
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, user_id, name, site, is_active")
    .eq("token_hash", tokenHash)
    .limit(1)
    .maybeSingle();

  if (error || !data || !data.is_active) {
    throw new Error("invalid agent token");
  }

  // Best-effort last seen.
  await supabaseAdmin.from("agents").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);

  return {
    id: data.id as string,
    user_id: data.user_id as string,
    name: data.name as string,
    site: data.site as string,
  };
}

