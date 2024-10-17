import { oauth2Client } from '../../../lib/googleads';

export async function GET(req) {
    console.log(oauth2Client);
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/adwords'],
    });

    return new Response(JSON.stringify({ url: authUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}