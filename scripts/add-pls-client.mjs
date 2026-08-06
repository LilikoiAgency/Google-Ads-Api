// One-off: add PLS to the live PacingConfig singleton in Mongo.
//
// Run disabled first (safe before the sheet is shared with the service account):
//   node scripts/add-pls-client.mjs
// Then enable once `node scripts/verify-pls-sheet.mjs` passes:
//   node scripts/add-pls-client.mjs --enable
//
// Talks to MongoDB directly rather than importing loadPacingConfig /
// savePacingConfig: src/lib/pacingPipeline.js uses an extensionless import
// (`from './mongoose'`) that Next's bundler resolves but plain Node ESM rejects.
// DB name, collection and _id are copied from pacingPipeline.js.
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const DB = 'tokensApi';
const CONFIG_COLL = 'PacingConfig';
const CONFIG_ID = 'singleton';

const enable = process.argv.includes('--enable');

const PLS = {
  key: 'PLS',
  name: 'Payless For Solar',
  sheetId: '1FKPACgebq2_YAAsgswGeBROzJm5JH45c2s2G2k-siyo',
  enabled: enable,
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const coll = client.db(DB).collection(CONFIG_COLL);

const cfg = await coll.findOne({ _id: CONFIG_ID });
if (!cfg) {
  console.error('No PacingConfig singleton found. Load /dashboard/pacing once to seed it, then re-run.');
  await client.close();
  process.exit(1);
}

const label = (c) => `${c.key}${c.enabled ? '' : ' (disabled)'}`;
console.log('before:', cfg.clients.map(label).join(', '));

const clients = [...cfg.clients];
const idx = clients.findIndex((c) => c.key === 'PLS');
if (idx >= 0) clients[idx] = { ...clients[idx], ...PLS };
else clients.push(PLS);

await coll.updateOne(
  { _id: CONFIG_ID },
  { $set: { clients, updatedAt: new Date() } },
);

const after = await coll.findOne({ _id: CONFIG_ID });
console.log('after: ', after.clients.map(label).join(', '));

await client.close();
