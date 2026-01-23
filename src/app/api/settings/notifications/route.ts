import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";
import {
  notificationSettingsPatchSchema,
  notificationSettingsSchema,
} from "@/lib/validators/settings";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const { data, error } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json({ settings: data });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to load notification settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const payload = await request.json();
    const parsed = notificationSettingsPatchSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message) },
        { status: 400 },
      );
    }

    const { data: existing } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const merged = {
      ...(existing ?? {}),
      ...parsed.data,
    };

    const finalPayload = notificationSettingsSchema.parse({
      ...merged,
      alert_email: merged.alert_email ?? "",
      notify_on_down: merged.notify_on_down ?? true,
      notify_on_up: merged.notify_on_up ?? true,
    });

    const { data, error } = await supabase
      .from("notification_settings")
      .upsert(
        {
          user_id: user.id,
          alert_email: finalPayload.alert_email,
          notify_on_down: finalPayload.notify_on_down,
          notify_on_up: finalPayload.notify_on_up,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ settings: data });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to update notification settings" }, { status: 500 });
  }
}
