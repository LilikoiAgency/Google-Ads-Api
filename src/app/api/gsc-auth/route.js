import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { getGscAuthUrl } from '../../../lib/gscClient';

export async function GET() {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.toLowerCase() || '';

    if (!email.endsWith(`@${allowedEmailDomain}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authUrl = await getGscAuthUrl();
    return NextResponse.redirect(authUrl);
}
