import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import {
  getSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  seedFromEnvIfEmpty,
  writeActivityLog,
  isAdmin,
  TOTAL_SLOTS,
} from "../../../../lib/audienceLabSegments";

export const dynamic = "force-dynamic";

async function getUser(request) {
  const session = await getServerSession(authOptions);
  return {
    email: session?.user?.email || null,
    name:  session?.user?.name  || session?.user?.email?.split("@")[0] || "Unknown",
  };
}

// GET /api/audience-lab/segments
export async function GET() {
  try {
    await seedFromEnvIfEmpty();
    const segments = await getSegments();
    const occupied = new Set(segments.map((s) => s.slot));

    const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
      const utcMinutes  = i * 10 + 720;
      const ptMinutes   = utcMinutes - 7 * 60;
      const hours       = Math.floor(ptMinutes / 60);
      const minutes     = ptMinutes % 60;
      const ampm        = hours >= 12 ? "PM" : "AM";
      const displayHour = hours % 12 === 0 ? 12 : hours % 12;
      const label       = `Mon ${displayHour}:${String(minutes).padStart(2, "0")} ${ampm} PT`;
      return {
        slot:     i,
        schedule: label,
        occupied: occupied.has(i),
        segment:  segments.find((s) => s.slot === i) || null,
      };
    });

    return NextResponse.json({ slots, total: segments.length, maxSlots: TOTAL_SLOTS });
  } catch (err) {
    console.error("[segments] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/audience-lab/segments — admin only
export async function POST(request) {
  try {
    const user = await getUser(request);
    if (!user.email)        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!isAdmin(user.email)) return NextResponse.json({ error: "Only admins can add segments." }, { status: 403 });

    const body = await request.json();
    const { slot, key, name, segmentId, tableId, active } = body;

    if (!key || !name || !segmentId || !tableId)
      return NextResponse.json({ error: "Missing required fields: key, name, segmentId, tableId" }, { status: 400 });
    if (slot !== undefined && (slot < 0 || slot >= TOTAL_SLOTS))
      return NextResponse.json({ error: `Slot must be 0–${TOTAL_SLOTS - 1}` }, { status: 400 });

    const doc = await createSegment({ slot, key, name, segmentId, tableId, active });

    await writeActivityLog({
      action: "created", segmentKey: doc.key, segmentName: doc.name,
      userEmail: user.email, userName: user.name,
      details: { slot: doc.slot, tableId: doc.tableId },
    }).catch(() => {});

    return NextResponse.json({ segment: doc }, { status: 201 });
  } catch (err) {
    console.error("[segments] POST error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/audience-lab/segments?key=xxx — admin only
export async function PUT(request) {
  try {
    const user = await getUser(request);
    if (!user.email)        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!isAdmin(user.email)) return NextResponse.json({ error: "Only admins can edit segments." }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return NextResponse.json({ error: "Missing ?key= param" }, { status: 400 });

    const updates = await request.json();
    await updateSegment(key, updates);

    // Determine a friendly action label
    let action = "updated";
    if (updates.active === true)  action = "resumed";
    if (updates.active === false) action = "paused";

    await writeActivityLog({
      action, segmentKey: key, segmentName: updates.name || key,
      userEmail: user.email, userName: user.name,
      details: updates,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[segments] PUT error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/audience-lab/segments?key=xxx — admin only
export async function DELETE(request) {
  try {
    const user = await getUser(request);
    if (!user.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!isAdmin(user.email))
      return NextResponse.json({ error: "Only admins can delete segments." }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return NextResponse.json({ error: "Missing ?key= param" }, { status: 400 });

    await deleteSegment(key);

    await writeActivityLog({
      action: "deleted", segmentKey: key, segmentName: key,
      userEmail: user.email, userName: user.name,
      details: {},
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[segments] DELETE error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
