// One-off: add REC to the live PacingConfig singleton in Mongo.
//
// Run disabled first (safe before the sheet is shared with the service account):
//   node scripts/add-rec-client.mjs
// Then enable once `node scripts/verify-rec-sheet.mjs` passes:
//   node scripts/add-rec-client.mjs --enable
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

const REC = {
  key: 'REC',
  name: 'Ranger Electric',
  sheetId: '1kmQ7NngORpNgGl1ywLdvfdMbv4dTxWVjxkfDgnpVztE',
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
const idx = clients.findIndex((c) => c.key === 'REC');
if (idx >= 0) clients[idx] = { ...clients[idx], ...REC };
else clients.push(REC);

await coll.updateOne(
  { _id: CONFIG_ID },
  { $set: { clients, updatedAt: new Date() } },
);

const after = await coll.findOne({ _id: CONFIG_ID });
console.log('after: ', after.clients.map(label).join(', '));

await client.close();
