import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";
import { sendMonitorEmail } from "@/lib/email/send";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);

    const { data: settings } = await supabase
      .from("notification_settings")
      .select("alert_email")
      .eq("user_id", user.id)
      .maybeSingle();

    const destination = settings?.alert_email ?? user.email ?? null;
    if (!destination) {
      return NextResponse.json(
        { error: "Nenhum email de destino encontrado. Configure em Configurações." },
        { status: 400 },
      );
    }

    await sendMonitorEmail({
      to: destination,
      subject: "[Monitor] Email de teste",
      html: `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5;">
          <h2 style="margin:0 0 12px;">Email de teste</h2>
          <p style="margin:0 0 12px;">
            Se você recebeu este email, o envio via SMTP está configurado corretamente.
          </p>
          <p style="margin:0; color:#64748b; font-size:12px;">
            Usuário: ${user.email ?? user.id}
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, to: destination });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar email de teste" },
      { status: 500 },
    );
  }
}

