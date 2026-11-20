import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllowedSession } from "../../../../../../lib/routeAuth";
import { resolveLocationInput, PlacesError } from "../../../../../../lib/seoAuditV2/places";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ input: z.string().trim().min(1).max(500) });

/** POST /api/seo-audit/v2/locations/resolve { input } -> { candidates } (name, Maps link or place id). */
export async function POST(request) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a business name or Google Maps link (up to 500 characters)" }, { status: 400 });
  }

  try {
    const candidates = await resolveLocationInput(parsed.data.input);
    return NextResponse.json({ candidates });
  } catch (err) {
    if (err instanceof PlacesError && err.code === "not_connected") {
      return NextResponse.json({ candidates: [], status: "not_connected" });
    }
    console.error("[seo-audit/v2/locations/resolve] failed:", err?.message);
    return NextResponse.json({ candidates: [], status: "error" });
  }
}
