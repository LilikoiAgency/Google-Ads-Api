export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const { url } = body;
  if (!url?.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  let parsed;
  try { parsed = new URL(url.trim()); }
  catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Only http and https URLs are supported' }, { status: 400 });
  }

  let html;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(parsed.href, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOMetaBot/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${res.status} ${res.statusText}` },
        { status: 422 }
      );
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json(
        { error: 'URL does not return HTML content' },
        { status: 422 }
      );
    }
    html = await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timed out. The URL took too long to respond.' },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: `Could not fetch URL: ${err.message}` }, { status: 422 });
  }

  const text = stripHtml(html);
  if (!text) {
    return NextResponse.json({ error: 'No readable content found at this URL' }, { status: 422 });
  }

  return NextResponse.json({ text });
}
