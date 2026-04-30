// src/app/api/googleads/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GoogleAdsApi } from 'google-ads-api';
import util from 'node:util';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { getCredentials } from '../../../lib/dbFunctions';
import {
  buildDateFilter,
  getCampaignStatusCondition,
} from '../../../lib/googleAdsHelpers';
import { fetchCustomerData } from '../../../lib/googleAdsCustomer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Zod schema for query params ────────────────────────────────────────────
export const googleAdsQuerySchema = z
  .object({
    dateRange: z.enum(['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'CUSTOM']).default('LAST_7_DAYS'),
    statusFilter: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
    customerId: z.string().regex(/^\d+$/).optional(),
    includeAds: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (data) => data.dateRange !== 'CUSTOM' || (data.startDate && data.endDate),
    { message: 'startDate and endDate are required for CUSTOM dateRange' }
  );

export async function GET(request) {
  const requestId = crypto.randomUUID();

  try {
    const session = await getServerSession(authOptions);
    const sessionEmail = session?.user?.email?.toLowerCase() || '';

    if (!sessionEmail.endsWith(`@${allowedEmailDomain}`)) {
      return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
    }

    // ── Validate query params ──────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const parsed = googleAdsQuerySchema.safeParse({
      dateRange: searchParams.get('dateRange') ?? undefined,
      statusFilter: searchParams.get('statusFilter') ?? undefined,
      customerId: searchParams.get('customerId')?.replaceAll('-', '') ?? undefined,
      includeAds: searchParams.get('includeAds') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message, requestId },
        { status: 400 }
      );
    }

    const { dateRange, statusFilter, customerId, includeAds, startDate, endDate } = parsed.data;
    const { dateFilter, dateWindow } = buildDateFilter(dateRange, startDate, endDate);
    const campaignStatusCondition = getCampaignStatusCondition(statusFilter);
    const campaignStatusConditionWithoutServing = getCampaignStatusCondition(statusFilter, {
      includeServingStatus: false,
    });

    // ── Credentials + API client ───────────────────────────────────────────
    const credentials = await getCredentials();
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const mccCustomer = client.Customer({
      customer_id: credentials.customer_id,
      refresh_token: credentials.refresh_token,
      login_customer_id: credentials.customer_id,
    });

    const customerClients = await mccCustomer.query(`
      SELECT customer_client.level, customer_client.descriptive_name, customer_client.id
      FROM customer_client
      WHERE customer_client.level = 1 AND customer_client.status = 'ENABLED'
    `);

    if (!customerClients || customerClients.length === 0) {
      return NextResponse.json({ error: 'No accessible customers found', requestId }, { status: 404 });
    }

    // ── Fetch all customer data in parallel ────────────────────────────────
    const requestedCustomerClients = customerId
      ? customerClients.filter(
          (customerClient) => String(customerClient.customer_client.id) === String(customerId)
        )
      : customerClients;

    if (customerId && requestedCustomerClients.length === 0) {
      return NextResponse.json({ error: 'Customer not found or inaccessible', requestId }, { status: 404 });
    }

    const allCampaignData = await Promise.all(
      requestedCustomerClients.map((customerClient) =>
        fetchCustomerData({
          client,
          customerClient,
          credentials,
          dateFilter,
          dateWindow,
          campaignStatusCondition,
          campaignStatusConditionWithoutServing,
          includeAds,
        })
      )
    );

    const validCampaignsData = allCampaignData.filter(Boolean);

    const response = NextResponse.json({
      data: { validCampaignsData, dateRange, dateWindow, statusFilter },
      requestId,
    });
    response.headers.set('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return response;
  } catch (error) {
    console.error(`[googleads] Error [${requestId}]:`, util.inspect(error, { depth: null, colors: false }));
    return NextResponse.json(
      { error: 'Failed to fetch campaign data', requestId },
      { status: 500 }
    );
  }
}
