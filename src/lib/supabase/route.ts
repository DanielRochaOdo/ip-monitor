import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { UnauthorizedError } from "@/lib/errors";
import { getRequiredEnv } from "@/lib/env";

const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

function parseCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, segment) => {
    const [key, ...valueParts] = segment.trim().split("=");
    if (!key) {
      return acc;
    }
    acc[key] = valueParts.join("=");
    return acc;
  }, {});
}

function getAccessTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [type, token] = authorization.split(" ");
    if (type?.toLowerCase() === "bearer" && token) {
      return token;
    }
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return cookies["sb-access-token"] ?? null;
}

export async function getServerSupabaseClient(request: Request): Promise<{
  supabase: ReturnType<typeof createClient<Database>>;
  user: User;
}> {
  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) {
    throw new UnauthorizedError();
  }

  // We avoid Next's cookies() API (async in Next 15+/16) entirely. The request already
  // contains the session token, and supabase-js will enforce RLS via the JWT.
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new UnauthorizedError();
  }

  return { supabase, user: data.user };
}
