import { google } from 'googleapis';
import { getCredentials } from './dbFunctions'; // Adjust the path if necessary

let oauth2Client;

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

// Initialize the client when the module loads
initializeClient(); // Ensure it runs once when the module is imported

// Export oauth2Client for use in other files
export { oauth2Client };
