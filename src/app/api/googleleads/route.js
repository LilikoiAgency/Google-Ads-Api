// api/googleleads.js
import { getOAuth2Client } from '../../../lib/googleads';

export async function GET(req) {
    try {
        const oauth2Client = await getOAuth2Client(); // Ensure the oauth2Client is initialized

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/adwords'],
        });

        return new Response(JSON.stringify({ url: authUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error("Error initializing oauth2Client:", error);
        return new Response(JSON.stringify({ error: "Failed to initialize OAuth2 client" }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
