// One-off: confirm the PLS sheet is readable and parses into the expected lines.
// Run: node scripts/verify-pls-sheet.mjs
import 'dotenv/config';
import { fetchClientSheet } from '../src/lib/pacingSheets.js';

const SHEET_ID = '1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo';

const { pacing, validation } = await fetchClientSheet(SHEET_ID, 'PLS');

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
