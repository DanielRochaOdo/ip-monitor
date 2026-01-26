import { NextRequest, NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/route";
import { UnauthorizedError } from "@/lib/errors";
import { checksQuerySchema } from "@/lib/validators/reports";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await getServerSupabaseClient(request);
    const url = new URL(request.url);
    const parsed = checksQuerySchema.safeParse(Object.fromEntries(url.searchParams));

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message) },
        { status: 400 },
      );
    }

    const { monitorId, status, source, from, to, limit, page, format } = parsed.data;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("monitor_checks")
      .select(
        "id, monitor_id, checked_at, status, latency_ms, error_message, source, agent_id, check_method, monitors (nickname, ip_address)",
        {
        count: "exact",
        },
      )
      .order("checked_at", { ascending: false });

    if (monitorId) {
      query = query.eq("monitor_id", monitorId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (source) {
      query = query.eq("source", source);
    }

    if (from) {
      query = query.gte("checked_at", new Date(from).toISOString());
    }

    if (to) {
      query = query.lte("checked_at", new Date(to).toISOString());
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    const checks = data ?? [];

    if (format === "csv") {
      const header = ["Monitor", "IP", "Status", "Latency", "Error", "Checked At"].join(",");
      const rows = checks
        .map(
          (check) =>
            [
              check.monitors?.nickname ?? "",
              check.monitors?.ip_address ?? "",
              check.status,
              check.latency_ms ?? "",
              `"${(check.error_message ?? "").replace(/"/g, '""')}"`,
              check.checked_at,
            ].join(","),
        )
        .join("\n");

      const csv = [header, rows].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=checks.csv",
        },
      });
    }

    return NextResponse.json({
      checks,
      total: count ?? checks.length,
      page,
      limit,
    });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Unable to load checks" }, { status: 500 });
  }
}
