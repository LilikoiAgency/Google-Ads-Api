import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createAuthedGscClient } from '../../../lib/gscClient';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const siteUrl = searchParams.get('siteUrl');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!siteUrl || !startDate || !endDate) {
    return NextResponse.json({ error: 'Missing required params' }, { status: 400 });
  }

  try {
    const auth = await createAuthedGscClient();
    if (!auth) {
      return NextResponse.json({ error: 'gsc_not_connected' }, { status: 401 });
    }

    const webmasters = google.webmasters({ version: 'v3', auth });

    // Fetch queries, pages, and trend in parallel
    const [queriesRes, pagesRes, trendRes] = await Promise.all([
      webmasters.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 1000 },
      }),
      webmasters.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: 500 },
      }),
      webmasters.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: ['date'], rowLimit: 500 },
      }),
    ]);

    const queryRows = queriesRes.data.rows || [];
    const pageRows  = pagesRes.data.rows  || [];
    const trendRows = trendRes.data.rows  || [];

    // Aggregate totals from query-level data
    const totalClicks       = queryRows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions  = queryRows.reduce((s, r) => s + r.impressions, 0);
    const avgCtr            = totalImpressions > 0
      ? parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2))
      : 0;
    const avgPosition       = queryRows.length > 0
      ? parseFloat((queryRows.reduce((s, r) => s + r.position, 0) / queryRows.length).toFixed(1))
      : 0;

    const queries = queryRows.map((r) => ({
      query:       r.keys[0],
      clicks:      r.clicks,
      impressions: r.impressions,
      ctr:         parseFloat((r.ctr * 100).toFixed(2)),
      position:    parseFloat(r.position.toFixed(1)),
    }));

    const pages = pageRows.map((r) => ({
      page:        r.keys[0],
      clicks:      r.clicks,
      impressions: r.impressions,
      ctr:         parseFloat((r.ctr * 100).toFixed(2)),
      position:    parseFloat(r.position.toFixed(1)),
    }));

    const trend = trendRows.map((r) => ({
      date:        r.keys[0],
      clicks:      r.clicks,
      impressions: r.impressions,
    }));

    return NextResponse.json({
      totals: { clicks: totalClicks, impressions: totalImpressions, ctr: avgCtr, position: avgPosition },
      queries,
      pages,
      trend,
    });
  } catch (err) {
    console.error('Organic API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch organic data' }, { status: 500 });
  }
}
