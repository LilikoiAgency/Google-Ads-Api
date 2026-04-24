import dbConnect from './mongoose';

const DB = 'tokensApi';
const COLLECTION = 'ApiUsage';

const COST_PER_M = {
  'claude-opus-4-6':           { input: 15.0,  output: 75.0  },
  'claude-sonnet-4-6':         { input: 3.0,   output: 15.0  },
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

export async function getMonthlyClaudeCost() {
  try {
    const client = await dbConnect();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const result = await client.db(DB).collection(COLLECTION).aggregate([
      { $match: { type: 'claude_tokens', timestamp: { $gte: monthStart } } },
      { $group: { _id: null, totalCost: { $sum: '$estimatedCostUsd' } } },
    ]).toArray();
    return result[0]?.totalCost ?? 0;
  } catch {
    return 0;
  }
}

export async function getClaudeBudgetCap() {
  try {
    const client = await dbConnect();
    const doc = await client.db(DB).collection('Settings').findOne({ key: 'claude_monthly_budget_usd' });
    return doc?.value ?? 50;
  } catch {
    return 50;
  }
}
