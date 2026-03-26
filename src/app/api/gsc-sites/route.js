import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { google } from 'googleapis';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { getGscToken, createAuthedGscClient } from '../../../lib/gscClient';

export async function GET() {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.toLowerCase() || '';

    if (!email.endsWith(`@${allowedEmailDomain}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenDoc = await getGscToken();
    if (!tokenDoc?.refresh_token) {
        return NextResponse.json({ connected: false, sites: [] });
    }

    try {
        const auth = await createAuthedGscClient();
        const webmasters = google.webmasters({ version: 'v3', auth });
        const response = await webmasters.sites.list();
        const siteEntries = response.data.siteEntry || [];

        const sites = siteEntries
            .filter((s) => ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(s.permissionLevel))
            .map((s) => ({ url: s.siteUrl, permissionLevel: s.permissionLevel }));

        return NextResponse.json({ connected: true, sites });
    } catch (err) {
        console.error('GSC sites fetch error:', err);
        return NextResponse.json({ connected: false, sites: [], error: err.message }, { status: 500 });
    }
}
