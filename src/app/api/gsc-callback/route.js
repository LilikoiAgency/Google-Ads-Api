import { NextResponse } from 'next/server';
import { createOAuth2Client, saveGscToken } from '../../../lib/gscClient';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';

    if (error || !code) {
        return NextResponse.redirect(`${base}/report?gsc_error=access_denied`);
    }

    try {
        const oauth2Client = await createOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            return NextResponse.redirect(`${base}/report?gsc_error=no_refresh_token`);
        }

        await saveGscToken(tokens);
        return NextResponse.redirect(`${base}/report?gsc_connected=true`);
    } catch (err) {
        console.error('GSC OAuth callback error:', err);
        return NextResponse.redirect(`${base}/report?gsc_error=auth_failed`);
    }
}
