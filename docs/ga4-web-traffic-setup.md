# GA4 Web Traffic report setup

## What it does

Sidebar -> Organic & Reports -> Web Traffic (GA4), at `/dashboard/google/analytics`. Pick a client's GA4 property, a date range and a view (Organic search, All non-paid, Paid, Everything). It shows channel, source/medium and landing page tables plus a trend chart, with period-over-period or year-over-year comparison, and can download a standalone HTML report for the client.

## Service account

Data is read with `lilikoi-reporting@lilikoi-ads-analytics.iam.gserviceaccount.com` (GCP project `lilikoi-ads-analytics`). The Analytics Data API and Analytics Admin API are enabled in that project. No Cloud IAM roles are needed; access is granted inside GA4 only.

## Connect a new client

1. The client's GA Administrator opens Admin -> Account access management and adds the service account email above as **Viewer** at the **account** level, with "Notify new users by email" **unticked**.
2. On the Web Traffic page, click **Refresh list**. The property then appears in the picker (the list is otherwise cached for up to an hour).

## Vercel

Add the env var `GA4_SA_KEY` = the raw service account JSON, pasted as-is with no wrapping quotes. Enable it for Production (and Preview), then redeploy. (In local `.env` it is single-quoted, like `GOOGLE_SHEETS_SA_KEY`.)

## Metric notes

- **Users = GA4 `activeUsers`**, which is what the "Users" column shows in GA's Traffic acquisition report (Session primary channel group). Totals per view come from a GA request filtered to that view's channels; channel rows are never summed, since users overlap across channels.
- **Unassigned** sessions are counted only under **Everything**, not in Organic, All non-paid or Paid. Any channel GA returns that is not in the bucket table is shown under its own name and also counted only in Everything.
- The **untagged-paid warning** (traffic that looks paid by source/medium but isn't in a Paid channel) is internal. It is shown on the page only and is never included in client downloads.

## Parity check (Oct 1-31, 2026)

The project's `fetchTrafficReport` output was compared to a raw GA Data API `runReport` (`sessionPrimaryChannelGroup`, `activeUsers`, `sessions`) for Semper Solaris - GA4 and Ranger Electric - Website. Users and Sessions matched exactly for every channel and for the unfiltered total (Semper 36,637 users / 44,210 sessions; Ranger 442 / 690). A final eyeball check against GA4's own Traffic acquisition report in the GA UI is still to be done by Frank.
