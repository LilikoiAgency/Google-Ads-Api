import dbConnect from "../../../../lib/mongoose";
import { clearCredentialsCache } from "../../../../lib/dbFunctions";
import { getBingCreds } from "../../../../lib/bingReporting";

const TENANT = process.env.BING_ADS_TENANT || "consumers";
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const REDIRECT_URI =
  process.env.BING_ADS_REDIRECT_URI ||
  "http://localhost:3000/api/bing-ads/callback";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return new Response(
      JSON.stringify({ error: "Missing code query param." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { clientId, clientSecret } = await getBingCreds();

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({
        error: "Missing BING_ADS_CLIENT_ID or BING_ADS_CLIENT_SECRET in environment or MongoDB.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
    scope: "https://ads.microsoft.com/msads.manage offline_access",
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return new Response(
      JSON.stringify({
        error: "Failed to exchange code for token.",
        details: payload,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Save new refresh token to MongoDB so no redeploy is needed
  if (payload.refresh_token) {
    try {
      const mongoClient = await dbConnect();
      const db = mongoClient.db("tokensApi");
      await db.collection("Tokens").updateOne({}, { $set: { BING_ADS_REFRESH_TOKEN: payload.refresh_token } });
      clearCredentialsCache(); // bust in-memory cache so next request picks up new token
      console.log("[bing-callback] Refresh token saved to MongoDB.");
    } catch (e) {
      console.error("[bing-callback] Failed to save refresh token to MongoDB:", e.message);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      tenant: TENANT,
      refresh_token: payload.refresh_token || null,
      expires_in: payload.expires_in || null,
      note: "Refresh token saved to MongoDB automatically.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
