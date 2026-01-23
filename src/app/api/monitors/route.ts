import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { monitorCreateSchema } from "@/lib/validators/monitor";
import { UnauthorizedError } from "@/lib/errors";

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

export async function GET(request: Request) {
  try {
    const { supabase } = await getServerSupabaseClient(request);
    const { data, error } = await supabase
      .from("monitors")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[/api/monitors][GET]", error);
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `Unable to load monitors: ${toErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const payload = await request.json();
    const parsed = monitorCreateSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message) },
        { status: 400 },
      );
    }

    const monitor = await supabase
      .from("monitors")
      .insert({
        ...parsed.data,
        user_id: user.id,
        ports: parsed.data.ports ?? [80, 443],
        next_check_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (monitor.error) {
      throw monitor.error;
    }

    return NextResponse.json(monitor.data, { status: 201 });
  } catch (error: unknown) {
    console.error("[/api/monitors]", error);
    const message = toErrorMessage(error);
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: `Unable to create monitor: ${message}` }, { status: 500 });
  }
}
