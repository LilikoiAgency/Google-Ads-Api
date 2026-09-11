// One-off: confirm the Targeted Streaming sheet is readable and parses as expected.
// Run: node scripts/verify-streaming-sheet.mjs
//
// Imports the .js modules directly with explicit extensions because plain Node ESM
// does not resolve the extensionless imports Next uses inside src/lib.
import 'dotenv/config';
import { fetchStreamingSheet } from '../src/lib/streamingPacingSheets.js';

const SHEET_ID = '1oD3I5rxg0BRylFm-JzGJlyE477foZ3shgBnjncqCDvU';
const CLIENTS = [
  { key: 'SMP', name: 'Semper Solaris' },
  { key: 'BBT', name: 'Big Bully Turf' },
];

const { info, budgets, clients } = await fetchStreamingSheet(SHEET_ID, CLIENTS);

console.log('\ninfo:', info);
console.log('budgets byClient:', budgets.byClient);
console.log('budgets byClientVertical:', JSON.stringify(budgets.byClientVertical, null, 2));
for (const c of clients) {
  console.log(`\n${c.key} (${c.name}) budget=${c.budget} lines=${c.lines.length} error=${c.error}`);
  for (const l of c.lines) {
    const geo = l.geos.map((g) => `${g.name}:${g.pacing.toFixed(0)}`).join(' ');
    console.log(`  ${l.platform.padEnd(12)} ${l.vertical.padEnd(8)} spend=${l.spendMtd?.toFixed(2)} eom=${l.eomPacing?.toFixed(2)}  ${geo}`);
  }
}
