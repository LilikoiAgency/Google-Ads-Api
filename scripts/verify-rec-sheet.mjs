// One-off: confirm the REC sheet is readable and parses into the expected lines.
// Run: node scripts/verify-pls-sheet.mjs
import 'dotenv/config';
import { fetchClientSheet } from '../src/lib/pacingSheets.js';

const SHEET_ID = '1kmQ7NngORpNgGl1ywLdvfdMbv4dTxWVjxkfDgnpVztE';

const { pacing, validation } = await fetchClientSheet(SHEET_ID, 'REC');

if (pacing.error) {
  console.error('PACING fetch failed:', pacing.error);
  process.exit(1);
}

console.log(`lines: ${pacing.lines.length}`);
for (const l of pacing.lines) {
  console.log(`  ${l.displayPlatform} / ${l.vertical}: budget=${l.budget} spend=${l.spendMtd} eom=${l.eomPacing} campaignBudget=${l.campaignBudget}`);
}
console.log('remainingDays:', pacing.header.remainingDays);
console.log('validation platforms:', validation.platforms.length, validation.error ? `(${validation.error})` : '');
