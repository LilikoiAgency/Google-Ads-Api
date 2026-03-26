import { NextResponse } from 'next/server';
import { GoogleAdsApi } from 'google-ads-api';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { getCredentials } from '../../../lib/dbFunctions';

export async function GET() {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.toLowerCase() || '';

    if (!email.endsWith(`@${allowedEmailDomain}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
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

        const rows = await mccCustomer.query(`
            SELECT
                customer_client.id,
                customer_client.descriptive_name,
                customer_client.level
            FROM customer_client
            WHERE customer_client.level = 1
                AND customer_client.status = 'ENABLED'
        `);

        const customers = rows
            .filter((r) => r.customer_client.id !== credentials.customer_id)
            .map((r) => ({
                id: r.customer_client.id,
                name: r.customer_client.descriptive_name,
            }));

        return NextResponse.json({ customers });
    } catch (err) {
        console.error('Customers fetch error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
