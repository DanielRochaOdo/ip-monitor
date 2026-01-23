import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { monitorPatchSchema } from "@/lib/validators/monitor";
import { UnauthorizedError } from "@/lib/errors";

const toErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : (error as any)?.message
        ? String((error as any).message)
        : JSON.stringify(error);

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await Promise.resolve(context.params as any);
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
    const { id } = await Promise.resolve(context.params as any);
    const { supabase } = await getServerSupabaseClient(request);
    const payload = await request.json();
    const parsed = monitorPatchSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((issue) => issue.message) },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {
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
    const { id } = await Promise.resolve(context.params as any);
    const { supabase } = await getServerSupabaseClient(request);
    const { error } = await supabase.from("monitors").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        {
          error: "Unable to delete monitor",
          details: {
            message: (error as any)?.message ?? null,
            code: (error as any)?.code ?? null,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
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
