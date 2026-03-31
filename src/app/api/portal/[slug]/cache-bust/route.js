import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { invalidateCacheByPrefix } from "../../../../../lib/serverCache";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/portal/[slug]/cache-bust
 *
 * Clears all server-side cached performance data for a client.
 * Requires an active admin session.
 * The portal will re-fetch live data on the next request.
 *
 * Usage: fetch(`/api/portal/${slug}/cache-bust`, { method: "DELETE" })
 */
export async function DELETE(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = params;
  const [deletedPerf, deletedAud] = await Promise.all([
    invalidateCacheByPrefix(`portal_perf_${slug}_`),
    invalidateCacheByPrefix(`portal_aud_${slug}_`),
  ]);
  const deleted = deletedPerf + deletedAud;

  return NextResponse.json({
    ok:      true,
    slug,
    deleted,
    message: `Cleared ${deleted} cached entries for "${slug}" (${deletedPerf} performance, ${deletedAud} audience). Next portal load will fetch live data.`,
  });
}
