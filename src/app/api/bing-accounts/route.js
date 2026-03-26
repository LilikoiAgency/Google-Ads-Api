import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TOKEN_TENANT           = process.env.BING_ADS_TENANT || "consumers";
const TOKEN_ENDPOINT         = `https://login.microsoftonline.com/${TOKEN_TENANT}/oauth2/v2.0/token`;
const CUSTOMER_MGMT_ENDPOINT = "https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc";

// ─── helpers ──────────────────────────────────────────────────────────────────

function escapeXml(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function unescapeXml(v) {
  return String(v)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<[\\w.-]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[\\w.-]*:?${tag}>`, "i"));
  return m ? unescapeXml(m[1].trim()) : null;
}
function allXmlTags(xml, tag) {
  const results = [];
  const re = new RegExp(`<[\\w.-]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[\\w.-]*:?${tag}>`, "gi");
  let m;
  while ((m = re.exec(xml)) !== null) results.push(unescapeXml(m[1].trim()));
  return results;
}

async function fetchAccessToken() {
  const body = new URLSearchParams({
    client_id:     process.env.BING_ADS_CLIENT_ID,
    client_secret: process.env.BING_ADS_CLIENT_SECRET,
    refresh_token: process.env.BING_ADS_REFRESH_TOKEN,
    grant_type:    "refresh_token",
    scope:         "https://ads.microsoft.com/msads.manage offline_access",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bing token error: ${await res.text()}`);
  return (await res.json()).access_token;
}

function soapHeaders(accessToken, accountId, customerId) {
  const devToken = escapeXml(process.env.BING_ADS_DEVELOPER_TOKEN);
  return `
    <Action mustUnderstand="1">PLACEHOLDER</Action>
    <AuthenticationToken>${escapeXml(accessToken)}</AuthenticationToken>
    <DeveloperToken>${devToken}</DeveloperToken>
    ${accountId ? `<CustomerAccountId>${escapeXml(accountId)}</CustomerAccountId>` : ""}
    ${customerId ? `<CustomerId>${escapeXml(customerId)}</CustomerId>` : ""}
  `;
}

async function soapCall(action, accessToken, bodyXml, accountId, customerId) {
  const headers = soapHeaders(accessToken, accountId, customerId).replace("PLACEHOLDER", action);
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Customer/v13">${headers}</s:Header>
  <s:Body>${bodyXml}</s:Body>
</s:Envelope>`;

  const res = await fetch(CUSTOMER_MGMT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action },
    body: envelope, cache: "no-store",
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`Bing ${action} error (${res.status}): ${xml.slice(0, 500)}`);
  return xml;
}

// ─── Step 1: GetUser — returns all CustomerRoles (customers the user manages) ──

async function getUser(accessToken) {
  const body = `<GetUserRequest xmlns="https://bingads.microsoft.com/Customer/v13">
    <UserId xmlns:i="http://www.w3.org/2001/XMLSchema-instance" i:nil="true"/>
  </GetUserRequest>`;

  const xml = await soapCall("GetUser", accessToken, body,
    process.env.BING_ADS_ACCOUNT_ID,
    process.env.BING_ADS_CUSTOMER_ID
  );

  // Extract all CustomerIds from CustomerRoles
  const customerIds = new Set();

  // Pull every <CustomerId> inside any CustomerRole block
  const roleBlocks = allXmlTags(xml, "CustomerRole");
  for (const block of roleBlocks) {
    const id = xmlTag(block, "CustomerId");
    if (id && /^\d+$/.test(id)) customerIds.add(id);
  }

  // Also add the env customer as fallback
  if (process.env.BING_ADS_CUSTOMER_ID) customerIds.add(process.env.BING_ADS_CUSTOMER_ID);

  console.log("[bing-accounts] CustomerIds from GetUser:", [...customerIds]);
  return [...customerIds];
}

// ─── Step 2: GetAccountsInfo — returns all accounts under a customer ───────────

async function getAccountsForCustomer(accessToken, customerId) {
  const body = `<GetAccountsInfoRequest xmlns="https://bingads.microsoft.com/Customer/v13">
    <CustomerId>${escapeXml(customerId)}</CustomerId>
    <OnlyParentAccounts>false</OnlyParentAccounts>
  </GetAccountsInfoRequest>`;

  let xml;
  try {
    xml = await soapCall("GetAccountsInfo", accessToken, body, null, customerId);
  } catch (err) {
    console.warn(`[bing-accounts] GetAccountsInfo failed for customer ${customerId}:`, err.message);
    return [];
  }

  const accounts = [];
  // AccountInfo blocks contain Id, Name, Number, AccountLifeCycleStatus
  const infoBlocks = allXmlTags(xml, "AccountInfo");
  for (const block of infoBlocks) {
    const id     = xmlTag(block, "Id");
    const name   = xmlTag(block, "Name");
    const status = xmlTag(block, "AccountLifeCycleStatus");
    if (id && name) {
      accounts.push({
        accountId:  id,
        customerId,
        name,
        currency:   "USD",  // GetAccountsInfo doesn't return currency; fine for the picker
        status:     status || "Active",
      });
    }
  }

  console.log(`[bing-accounts] Customer ${customerId} → ${accounts.length} accounts:`, accounts.map(a => a.name));
  return accounts;
}

// ─── main handler ─────────────────────────────────────────────────────────────

function envFallback() {
  return [{
    accountId:  process.env.BING_ADS_ACCOUNT_ID  || "",
    customerId: process.env.BING_ADS_CUSTOMER_ID || "",
    name:       "Default Account",
    currency:   "USD",
    status:     "Active",
  }];
}

export async function GET() {
  try {
    const accessToken = await fetchAccessToken();

    // 1. Get all customer IDs this user manages
    const customerIds = await getUser(accessToken);

    // 2. Fetch accounts for each customer in parallel
    const accountArrays = await Promise.all(
      customerIds.map((cid) => getAccountsForCustomer(accessToken, cid))
    );

    // 3. Flatten + deduplicate by accountId
    const seen = new Set();
    const accounts = [];
    for (const arr of accountArrays) {
      for (const a of arr) {
        if (!seen.has(a.accountId)) {
          seen.add(a.accountId);
          accounts.push(a);
        }
      }
    }

    accounts.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[bing-accounts] Total unique accounts: ${accounts.length}`);

    return NextResponse.json({ accounts: accounts.length > 0 ? accounts : envFallback() });
  } catch (err) {
    console.error("[bing-accounts] Fatal error:", err.message);
    return NextResponse.json({ accounts: envFallback() });
  }
}
