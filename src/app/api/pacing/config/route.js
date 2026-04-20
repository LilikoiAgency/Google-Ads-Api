// src/app/api/pacing/config/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { loadPacingConfig, savePacingConfig } from '../../../../lib/pacingPipeline';

async function assertAllowed() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) return null;
  return email;
}

export async function GET() {
  const email = await assertAllowed();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = await loadPacingConfig();
  return NextResponse.json({ data: cfg });
}

export async function PUT(request) {
  const email = await assertAllowed();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const update = {};
  if (Array.isArray(body.recipients)) {
    update.recipients = body.recipients
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }
  if (Array.isArray(body.clients)) {
    update.clients = body.clients.map((c) => ({
      key: String(c.key || '').toUpperCase().slice(0, 8),
      name: String(c.name || '').slice(0, 120),
      sheetId: String(c.sheetId || '').trim(),
      enabled: !!c.enabled,
    })).filter((c) => c.key && c.name);
  }
  if (typeof body.subjectPrefix === 'string') update.subjectPrefix = body.subjectPrefix.slice(0, 120);
  if (typeof body.fromAddress === 'string') update.fromAddress = body.fromAddress.trim();

  const saved = await savePacingConfig(update);
  return NextResponse.json({ data: saved });
}
