import { getBingCreds } from "../../../../lib/bingReporting";

const TENANT = process.env.BING_ADS_TENANT || "consumers";
const REDIRECT_URI =
  process.env.BING_ADS_REDIRECT_URI ||
  "http://localhost:3000/api/bing-ads/callback";
const AUTH_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;

export async function GET(request) {
  const { clientId } = await getBingCreds();

  if (!clientId) {
    return new Response(
      JSON.stringify({ error: "Missing BING_ADS_CLIENT_ID in environment or MongoDB." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const loginHint = searchParams.get("login_hint");
  const domainHint = searchParams.get("domain_hint");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: "https://ads.microsoft.com/msads.manage offline_access",
    prompt: "select_account",
  });
  if (loginHint) params.set("login_hint", loginHint);
  if (domainHint) params.set("domain_hint", domainHint);

  return new Response(
    JSON.stringify({
      tenant: TENANT,
      login_hint: loginHint || null,
      domain_hint: domainHint || null,
      authorizeUrl: `${AUTH_ENDPOINT}?${params.toString()}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
