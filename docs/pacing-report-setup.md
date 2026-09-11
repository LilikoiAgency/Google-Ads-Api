# Daily Budget Pacing Report — Setup

One-time setup steps before the cron can run.

## 1. Resend — verify the sending domain

1. Log in to [resend.com](https://resend.com) and create (or open) the Lilikoi workspace.
2. **Domains → Add Domain** → `lilikoiagency.com`.
3. Resend gives you a set of DNS records (SPF, DKIM, optionally DMARC). Add them to the `lilikoiagency.com` DNS zone.
4. Wait for Resend to show the domain as **Verified**.
5. Generate an API key (**API Keys → Create**). Copy the `re_...` value.

Sender address used by this app: `reports@lilikoiagency.com` (override with `PACING_REPORT_FROM` if needed).

## 2. Google Sheets — service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → pick (or create) a project.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create service account**
   - Name: `pacing-report-reader`
   - Role: none needed at project level
4. Open the service account → **Keys → Add Key → JSON**. A JSON file downloads. Keep it — you'll paste it into an env var.
5. Note the service account's email address (looks like `pacing-report-reader@your-project.iam.gserviceaccount.com`).
6. For each of the four client sheets (BBT, SMP, CMK, MSP):
   - Open the sheet → **Share** → paste the service account email → **Viewer** → Send.

## 3. Env vars

Add to Vercel project settings (and `.env.local` for local dev):

| Var | Value |
|---|---|
| `RESEND_API_KEY` | `re_...` from step 1 |
| `PACING_REPORT_FROM` | `reports@lilikoiagency.com` (optional override) |
| `GOOGLE_SHEETS_SA_KEY` | **Entire JSON from step 2.4**, as a single-line string. Easiest: paste the file contents into Vercel's multi-line env var field. |
| `CRON_SECRET` | Any random 32-byte string (`openssl rand -hex 32`). Vercel Cron will send this as a `Bearer` header. |

## 4. Seed the Mongo config

First time: open the dashboard **Pacing Reports** page. If no config exists, a default one is created. Fill in the four sheet IDs:

- BBT: `1MSsCNhqCA53ToFAeAxIC45nxwETMWhg6Ip7eT9RBRgc`
- SMP: `1xvWA1WWDHBrABYoWjMJJaaCCV3aQgofSV0m4GT4Eahw`
- CMK: `14hQSB8fQjDxNQ21qSoNeqgzd9RcVU3SahV5AyvKDiwY`
- MSP: `1qzAYyXUbtZ1FwXRkznvlna5g2OMAmby6GcF1sNBqlXE`

Recipients default: `kevinw@, lance@, pierre@, danielle@, sophia@, nicole@` (all `@lilikoiagency.com`). Edit in the UI.

## 5. Vercel Cron

Already wired in `vercel.json` — `0 13 * * 1-5` UTC = **9:00 AM EDT / 8:00 AM EST, Mon–Fri**.

Vercel Cron only runs in UTC, so the local send time shifts by 1 hour between daylight time (March–Nov) and standard time (Nov–March). If you want exactly 9:00 AM ET year-round, add a second cron entry at `0 14 * * 1-5` and dedupe in the handler — for v1 we accept the 1-hour drift.

## 6. First run checklist

1. All env vars set in Vercel.
2. Service account has Viewer access to all four sheets.
3. Config doc populated with sheet IDs + recipients.
4. Click **Preview** in the dashboard — renders the HTML without sending.
5. Click **Send Now** → confirm email arrives.
6. Cron takes over the next weekday at 9 AM ET.

## Troubleshooting

- **"The caller does not have permission"** from Sheets API → the service account isn't shared on that sheet. Re-share as Viewer.
- **Resend 403** → domain not verified yet, or the `from` address doesn't match the verified domain.
- **Cron didn't run** → check Vercel dashboard **Crons** tab for last execution. The `CRON_SECRET` must match between Vercel's generated header and your env var.

---

## Targeted Streaming Pacing Report

A second daily email fed by the shared **Targeted Streaming Spends** sheet
(`1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU`). Same service account, same Resend sender, same `CRON_SECRET`.

- Cron: `/api/cron/streaming-pacing-report` at `5 12 * * 1-5` UTC (five minutes after Paid Search).
- Config: Mongo `tokensApi.StreamingPacingConfig` (`_id: 'singleton'`), seeded on first load of **/dashboard/streaming-pacing**. Holds one shared `sheetId`, the client list (`SMP`, `BBT`), recipients, subject prefix, from address.
- History: `tokensApi.StreamingPacingReports`.
- Tabs read: `Client Information`, `Budget`, and `<KEY> Pacing` for each enabled client. Nothing else.

### Adding a client

1. Make sure the sheet has a `<KEY> Pacing` tab for the client and its rows appear in the `Budget` tab.
2. In **/dashboard/streaming-pacing → Config**, there is no add-client control yet. Use a one-off script modelled on `scripts/add-rec-client.mjs` but against collection `StreamingPacingConfig`, with entries of the form `{ key, name, enabled }` (no `sheetId` per client).
3. Run `node scripts/verify-streaming-sheet.mjs` after adding the key to its `CLIENTS` array to confirm the tab parses.

### Month rollover

The sheet's `Client Information!C2` (Current Month) and `E2` (Last Updated) are typed by hand. When they lag the calendar, the report shows a yellow "Sheet is still on <month>" banner and a Recommended Action. That is expected; fix it in the sheet, not the code.

### First run checklist

1. `node scripts/verify-streaming-sheet.mjs` prints SMP and BBT lines with no errors.
2. Open **/dashboard/streaming-pacing** once to seed the config; confirm recipients.
3. Click **Preview** — the report renders with a "Data as of" line.
4. Temporarily set recipients to yourself, **Send now**, check Gmail rendering (inline styles only), restore recipients.
5. Deploy; the cron takes over the next weekday.
