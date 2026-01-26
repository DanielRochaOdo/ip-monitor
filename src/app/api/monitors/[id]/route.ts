import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { monitorPatchSchema } from "@/lib/validators/monitor";
import { UnauthorizedError } from "@/lib/errors";
import type { Database } from "@/types/database.types";

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type MonitorUpdate = Database["public"]["Tables"]["monitors"]["Update"];

async function getIdFromContext(context: RouteContext) {
  const params = await Promise.resolve(context.params);
  return params.id;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const id = await getIdFromContext(context);
    const { supabase } = await getServerSupabaseClient(request);
    const { data, error } = await supabase
      .from("monitors")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[/api/monitors/:id][GET]", error);
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `Unable to load monitor: ${toErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const id = await getIdFromContext(context);
    const { supabase } = await getServerSupabaseClient(request);
    const payload = await request.json();
    const parsed = monitorPatchSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message) },
        { status: 400 },
      );
    }

    const updates: MonitorUpdate = {
      ...parsed.data,
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.ping_interval_seconds !== undefined) {
      updates.next_check_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("monitors")
      .update(updates)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[/api/monitors/:id][PATCH]", error);
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `Unable to update monitor: ${toErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const id = await getIdFromContext(context);
    const { supabase } = await getServerSupabaseClient(request);
    const { error } = await supabase.from("monitors").delete().eq("id", id);

    if (error) {
      const err = error as unknown as Record<string, unknown>;
      return NextResponse.json(
        {
          error: "Unable to delete monitor",
          details: {
            message: typeof err.message === "string" ? err.message : null,
            code: typeof err.code === "string" ? err.code : null,
            details: typeof err.details === "string" ? err.details : null,
            hint: typeof err.hint === "string" ? err.hint : null,
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[/api/monitors/:id][DELETE]", error);
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `Unable to delete monitor: ${toErrorMessage(error)}` },
      { status: 500 },
    );
  }
}
