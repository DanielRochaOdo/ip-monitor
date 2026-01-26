import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";
import { sendMonitorEmail } from "@/lib/email/send";
import { parseRecipientEmails, validateRecipientEmails } from "@/lib/email/recipients";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);

    const { data: settings } = await supabase
      .from("notification_settings")
      .select("alert_email")
      .eq("user_id", user.id)
      .maybeSingle();

    const rawDestination = settings?.alert_email ?? user.email ?? null;
    if (!rawDestination) {
      return NextResponse.json(
        { error: "Nenhum email de destino encontrado. Configure em Configuracoes." },
        { status: 400 },
      );
    }

    // If settings exist, validate/normalize before sending.
    const normalized = settings?.alert_email
      ? validateRecipientEmails(rawDestination)
      : { ok: true as const, value: rawDestination };

    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const recipients = settings?.alert_email ? parseRecipientEmails(normalized.value) : [normalized.value];

    await sendMonitorEmail({
      to: recipients,
      subject: "[Monitor] Email de teste",
      html: `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5;">
          <h2 style="margin:0 0 12px;">Email de teste</h2>
          <p style="margin:0 0 12px;">
            Se voce recebeu este email, o envio via SMTP esta configurado corretamente.
          </p>
          <p style="margin:0; color:#64748b; font-size:12px;">
            Usuario: ${user.email ?? user.id}
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, to: recipients });
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

