// lib/googleads.js
import { google } from 'googleapis';
import { getCredentials } from './dbFunctions'; // Adjust the path if necessary

let oauth2Client; // Keep the original oauth2Client variable

// Function to initialize the OAuth2 client
async function initializeClient() {
    const credentials = await getCredentials();
    if (!credentials) throw new Error('No credentials found'); // Ensure credentials are valid

    oauth2Client = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uri
    );
}

// Ensure oauth2Client is initialized before using it
async function getOAuth2Client() {
    if (!oauth2Client) {
        await initializeClient(); // Initialize if not already initialized
    }
    return oauth2Client; // Return the oauth2Client object
}

// Export oauth2Client and initialization function
export { oauth2Client, getOAuth2Client, initializeClient };
