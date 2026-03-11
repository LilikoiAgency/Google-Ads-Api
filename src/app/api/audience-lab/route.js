export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_BASE_URL = "https://api.audiencelab.io";
const DEFAULT_AUDIENCES_PATH = "/audiences";
const NO_STORE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizePath(path) {
  if (!path) return DEFAULT_AUDIENCES_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}

function buildBaseUrl() {
  return trimTrailingSlash(process.env.AUDIENCE_LAB_BASE_URL || DEFAULT_BASE_URL);
}

function buildAuthHeaders() {
  const apiKey = process.env.AUDIENCE_LAB_API_KEY;
  const apiKeyHeader = process.env.AUDIENCE_LAB_API_KEY_HEADER || "X-Api-Key";

  if (!apiKey) return null;

  return {
    Accept: "application/json",
    [apiKeyHeader]: apiKey,
  };
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function GET(request) {
  const headers = buildAuthHeaders();
  if (!headers) {
    return new Response(
      JSON.stringify({
        error: "Missing Audience Lab configuration.",
        missing: ["AUDIENCE_LAB_API_KEY"],
      }),
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  const { searchParams } = new URL(request.url);
  const baseUrl = buildBaseUrl();
  const path = normalizePath(searchParams.get("path"));

  const upstreamUrl = new URL(`${baseUrl}${path}`);

  // Pass through common list pagination params for /audiences.
  const page = searchParams.get("page");
  const pageSize = searchParams.get("page_size") || searchParams.get("pageSize");
  if (page) upstreamUrl.searchParams.set("page", page);
  if (pageSize) upstreamUrl.searchParams.set("page_size", pageSize);

  try {
    const response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const body = await parseBody(response);

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Audience Lab request failed.",
          endpoint: upstreamUrl.toString(),
          status: response.status,
          response: body,
        }),
        { status: response.status, headers: NO_STORE_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        endpoint: upstreamUrl.toString(),
        response: body,
      }),
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to fetch Audience Lab audiences.",
        endpoint: upstreamUrl.toString(),
        details: error.message,
      }),
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
