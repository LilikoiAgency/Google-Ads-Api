import { NextResponse } from "next/server";
import { getAllowedSession } from "@/lib/routeAuth";
import { getCached, setCached } from "@/lib/serverCache";
import { listProperties } from "@/lib/ga4Client";
import { mapGa4Error } from "@/lib/ga4Errors";

export const dynamic = "force-dynamic";

const KEY = "ga4:properties";
const TTL = 60 * 60 * 1000;

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: "unauthorized", message: auth.error }, { status: 401 });

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (!refresh) {
      const cached = await getCached(KEY);
      if (cached) return NextResponse.json({ properties: cached });
    }
    const properties = await listProperties();
    await setCached(KEY, properties, TTL);
    return NextResponse.json({ properties });
  } catch (err) {
    const { status, error, message } = mapGa4Error(err, "ga4/properties");
    return NextResponse.json({ error, message }, { status });
  }
}
