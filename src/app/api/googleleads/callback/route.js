import { oauth2Client as importedOauth2Client } from '../../../../lib/googleads'; // Import the oauth2Client
import dbConnect from '../../../../lib/mongoose'; // Adjust the path if necessary
import { getCredentials } from '../../../../lib/dbFunctions'; // Import the function to get credentials
import { google } from 'googleapis'; // Import google to create a new OAuth2 client

// Function to save tokens to the database
async function saveTokensToDatabase(tokens) {
    const client = await dbConnect();
    const db = client.db('tokensApi'); // Specify your database name if necessary

    try {
        // Update or insert tokens into the 'Tokens' collection
        await db.collection('Tokens').updateOne(
            {}, // Filter: Update the first document found (you might want to modify this if you have specific criteria)
            {
                $set: {
                    GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
                    GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
                    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
                    GOOGLE_ADS_REFRESH_TOKEN: tokens.refresh_token,
                    ACCESS_TOKEN: tokens.access_token,
                },
            },
            { upsert: true } // If no document matches the filter, insert a new document
        );

        console.log('Tokens saved to the database successfully.');
    } catch (error) {
        console.error('Error saving tokens to the database:', error);
    }
}

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code'); // Get the authorization code

    if (!code) {
        return new Response('Missing authorization code', { status: 400 });
    }

    try {
        // Get credentials and create a new oauth2Client instance if necessary
        const credentials = await getCredentials();
        if (!credentials) throw new Error('No credentials found');

        // Create a new OAuth2 client instance
        const oauth2Client = new google.auth.OAuth2(
            credentials.client_id,
            credentials.client_secret,
            credentials.redirect_uri
        );

        // Exchange the code for access and refresh tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Save the tokens to the database
        await saveTokensToDatabase(tokens);

        return new Response('Tokens received and saved to the database! Check the console.', { status: 200 });
    } catch (error) {
        return new Response(`Error retrieving access token: ${error.message}`, { status: 400 });
    }
}
