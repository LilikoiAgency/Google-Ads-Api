import dbConnect from './mongoose';

let cachedCredentials = null; // Variable to store cached credentials

export function clearCredentialsCache() {
    cachedCredentials = null;
}

export async function getCredentials() {
    // Bust cache if key fields are missing (e.g. key was added to DB after this lambda cold-started)
    if (cachedCredentials && (!cachedCredentials.anthropic_api_key || !cachedCredentials.meta_access_token || !cachedCredentials.bing_refresh_token)) {
        cachedCredentials = null;
    }
    if (cachedCredentials) return cachedCredentials; // Return cached credentials if available

    const client = await dbConnect();
    const db = client.db('tokensApi'); // Adjust the database name if necessary

    try {
        const tokenData = await db.collection('Tokens').findOne({}); // Ensure 'Tokens' matches your collection
        if (!tokenData) throw new Error('No credentials found in the database');

        // Cache the credentials
        cachedCredentials = {
            client_id: tokenData.GOOGLE_ADS_CLIENT_ID,
            client_secret: tokenData.GOOGLE_ADS_CLIENT_SECRET,
            developer_token: tokenData.GOOGLE_ADS_DEVELOPER_TOKEN,
            refresh_token: tokenData.GOOGLE_ADS_REFRESH_TOKEN,
            redirect_uri: tokenData.REDIRECT_URI,
            customer_id: tokenData.CUSTOMER_ID,
            anthropic_api_key: tokenData.ANTHROPIC_API_KEY,
            meta_access_token: tokenData.META_ACCESS_TOKEN,
            bing_client_id:       tokenData.BING_ADS_CLIENT_ID,
            bing_client_secret:   tokenData.BING_ADS_CLIENT_SECRET,
            bing_refresh_token:   tokenData.BING_ADS_REFRESH_TOKEN,
            bing_developer_token: tokenData.BING_ADS_DEVELOPER_TOKEN,
        };

        return cachedCredentials; // Return the fetched credentials
    } catch (error) {
        console.error('Error fetching credentials:', error);
        throw new Error('Failed to fetch credentials');
    }
}