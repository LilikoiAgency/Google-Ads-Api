import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import {
  getClients, createClient, updateClient,
  deleteClient, regenerateToken,
} from "../../../../lib/clientPortal";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return session;
}

// GET /api/admin/clients — list all clients
export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clients = await getClients();
  return NextResponse.json({ clients });
}

// POST /api/admin/clients — create client
export async function POST(request) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data   = await request.json();
    const client = await createClient(data);
    return NextResponse.json({ client });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// PUT /api/admin/clients?slug=xxx — update or regenerate token
export async function PUT(request) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const data = await request.json();

  if (data._action === "regenerateToken") {
    const token = await regenerateToken(slug);
    return NextResponse.json({ token });
  }

  await updateClient(slug, data);
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/clients?slug=xxx
export async function DELETE(request) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  await deleteClient(slug);
  return NextResponse.json({ ok: true });
}
