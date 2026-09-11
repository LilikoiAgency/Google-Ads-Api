// src/app/api/streaming-pacing/config/route.js
import { NextResponse } from 'next/server';
import { getAllowedSession } from '../../../../lib/routeAuth';
import { loadStreamingPacingConfig, saveStreamingPacingConfig } from '../../../../lib/streamingPacingPipeline';

export async function GET() {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ data: await loadStreamingPacingConfig() });
}

export async function PUT(request) {
  const auth = await getAllowedSession();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
      enabled: !!c.enabled,
    })).filter((c) => c.key && c.name);
  }
  if (typeof body.sheetId === 'string') update.sheetId = body.sheetId.trim();
  if (typeof body.subjectPrefix === 'string') update.subjectPrefix = body.subjectPrefix.slice(0, 120);
  if (typeof body.fromAddress === 'string') update.fromAddress = body.fromAddress.trim();

  return NextResponse.json({ data: await saveStreamingPacingConfig(update) });
}
