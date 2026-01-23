import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getRequiredEnv } from "@/lib/env";
import { MonitorDetail } from "@/components/monitor-detail";

type PageProps = {
  params: {
    id: string;
  };
};

export default async function MonitorDetailPage({ params }: PageProps) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("sb-access-token")?.value;
  const refreshToken = cookieStore.get("sb-refresh-token")?.value;
  const headers =
    accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
          ...(refreshToken ? { "x-refresh-token": refreshToken } : {}),
        }
      : undefined;
  const baseUrl = getRequiredEnv("APP_URL");
  const monitorRes = await fetch(`${baseUrl}/api/monitors/${params.id}`, {
    cache: "no-store",
    headers,
  });
  if (!monitorRes.ok) {
    return notFound();
  }
  const monitor = await monitorRes.json();

  const checksRes = await fetch(`${baseUrl}/api/reports/checks?monitorId=${params.id}&limit=10`, {
    cache: "no-store",
    headers,
  });
  const checksData = await checksRes.json();

  return <MonitorDetail monitor={monitor} checks={checksData.checks ?? []} />;
}
