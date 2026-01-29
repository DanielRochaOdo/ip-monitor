import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

type Params = {
  params: {
    id: string;
  };
};

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await getServerSupabaseClient(request);
    const agentId = params.id;

    if (!agentId) {
      return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });
    }

    // Ensure the agent belongs to the user.
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, user_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent || agent.user_id !== user.id) {
      return NextResponse.json({ error: "Agente nao encontrado" }, { status: 404 });
    }

    // Detach monitors/devices from this agent so the UI doesn't keep showing it.
    const { error: monitorsError } = await supabase
      .from("monitors")
      .update({ agent_id: null })
      .eq("agent_id", agentId);
    if (monitorsError) {
      return NextResponse.json({ error: monitorsError.message }, { status: 500 });
    }

    const { error: devicesError } = await supabase
      .from("network_devices")
      .update({ agent_id: null })
      .eq("agent_id", agentId);
    if (devicesError) {
      return NextResponse.json({ error: devicesError.message }, { status: 500 });
    }

    const { error: deleteError } = await supabase.from("agents").delete().eq("id", agentId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
