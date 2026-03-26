import { google } from 'googleapis';
import dbConnect from './mongoose';
import { getCredentials } from './dbFunctions';

function getCallbackUrl() {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    return `${base}/api/gsc-callback`;
}

export async function createOAuth2Client() {
    const credentials = await getCredentials();
    return new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        getCallbackUrl()
    );
}

export async function getGscAuthUrl() {
    const oauth2Client = await createOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
}

export async function getGscToken() {
    const client = await dbConnect();
    const db = client.db('tokensApi');
    return db.collection('GscTokens').findOne({});
}

export async function saveGscToken(tokens) {
    const client = await dbConnect();
    const db = client.db('tokensApi');
    await db.collection('GscTokens').replaceOne(
        {},
        {
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            scope: tokens.scope,
            created_at: new Date(),
        },
        { upsert: true }
    );
}

export async function createAuthedGscClient() {
    const tokenDoc = await getGscToken();
    if (!tokenDoc?.refresh_token) return null;

    const oauth2Client = await createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: tokenDoc.refresh_token });
    return oauth2Client;
}
