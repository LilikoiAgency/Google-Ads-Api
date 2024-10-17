import dbConnect from './mongoose';

let cachedCredentials = null; // Variable to store cached credentials

export async function getCredentials() {
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
        };

        return cachedCredentials; // Return the fetched credentials
    } catch (error) {
        console.error('Error fetching credentials:', error);
        throw new Error('Failed to fetch credentials');
    }
}