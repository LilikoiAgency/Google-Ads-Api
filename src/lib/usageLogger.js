import dbConnect from './mongoose';

const DB = 'tokensApi';
const COLLECTION = 'ApiUsage';

const COST_PER_M = {
  'claude-opus-4-6':           { input: 15.0,  output: 75.0  },
  'claude-sonnet-4-20250514':  { input: 3.0,   output: 15.0  },
  'claude-haiku-4-5-20251001': { input: 0.25,  output: 1.25  },
};

export function estimateClaudeCost(model, inputTokens, outputTokens) {
  const rates = COST_PER_M[model] ?? { input: 3.0, output: 15.0 };
  return ((inputTokens / 1_000_000) * rates.input) + ((outputTokens / 1_000_000) * rates.output);
}

export async function logApiUsage(event) {
  try {
    const client = await dbConnect();
    await client.db(DB).collection(COLLECTION).insertOne({
      ...event,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('[usageLogger]', err.message);
  }
}
