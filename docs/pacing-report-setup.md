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
