// src/lib/sheetsClient.js
// Service-account Google Sheets reader shared by every sheet-backed report.

import { google } from 'googleapis';

function getAuth() {
  const raw = process.env.GOOGLE_SHEETS_SA_KEY;
  if (!raw) throw new Error('GOOGLE_SHEETS_SA_KEY env var not set');
  let creds;
  try { creds = JSON.parse(raw); }
  catch { throw new Error('GOOGLE_SHEETS_SA_KEY is not valid JSON'); }
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export async function readTab(sheetId, tabName) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: tabName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.data.values || [];
}
