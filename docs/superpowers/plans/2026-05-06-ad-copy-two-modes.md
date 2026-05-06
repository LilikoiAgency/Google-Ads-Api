# Ad Copy Generator — Two Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Google Ads and Meta ad copy panels to support two distinct modes — New campaign (generate from scratch) and Existing campaign (pull current copy and generate improvement recommendations).

**Architecture:** Add mode toggle to both panels; new routes + prompts handle scratch generation; existing routes + prompts are reframed to reference current copy explicitly. State for each mode is kept separately so switching tabs does not clear inputs.

**Tech Stack:** Next.js App Router, React 18 (use client), Anthropic SDK (claude-sonnet-4-6), MongoDB (UsageLimits), Vitest + React Testing Library

---

## File Map

**Create:**
- `src/lib/adCopyNewPrompt.js` — system prompt for Google Ads new campaign generation
- `src/app/api/claude/ad-copy-new/route.js` — POST handler for new Google Ads copy
- `src/__tests__/api/ad-copy-new.test.js` — API route tests
- `src/lib/metaAdCopyNewPrompt.js` — system prompt for Meta new campaign generation
- `src/app/api/claude/meta-ad-copy-new/route.js` — POST handler for new Meta copy
- `src/__tests__/api/meta-ad-copy-new.test.js` — API route tests

**Modify:**
- `src/lib/adCopyStrategyPrompt.js` — update framing to "improvement recommendations"
- `src/lib/metaAdCopyPrompt.js` — same update
- `src/app/dashboard/google/ads/components/AdCopyPanel.jsx` — add mode toggle + new campaign form
- `src/__tests__/components/AdCopyPanel.test.jsx` — update tests for new UI
- `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx` — same changes, audience instead of keywords
- `src/__tests__/components/MetaAdCopyPanel.test.jsx` — update tests for new UI

---

### Task 1: Google Ads new campaign prompt + API route

**Files:**
- Create: `src/lib/adCopyNewPrompt.js`
- Create: `src/app/api/claude/ad-copy-new/route.js`
- Create: `src/__tests__/api/ad-copy-new.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// src/__tests__/api/ad-copy-new.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: 'test@lilikoiagency.com' } }),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/mongoose', () => ({
  default: vi.fn().mockResolvedValue({
    db: () => ({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
      }),
    }),
  }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn(),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));

const { POST } = await import('@/app/api/claude/ad-copy-new/route.js');

function makeRequest(body) {
  return new Request('http://localhost/api/claude/ad-copy-new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/claude/ad-copy-new', () => {
  it('returns 401 when unauthenticated', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ product: 'p', keywords: 'k', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when product is missing', async () => {
    const res = await POST(makeRequest({ keywords: 'k', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/product/i);
  });

  it('returns 400 when keywords is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/keywords/i);
  });

  it('returns 400 when usps is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', keywords: 'k', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/usps/i);
  });

  it('returns 400 when cta is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', keywords: 'k', usps: 'u' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cta/i);
  });

  it('returns 429 when monthly budget cap is reached', async () => {
    const { getMonthlyClaudeCost, getClaudeBudgetCap } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(200);
    getClaudeBudgetCap.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ product: 'p', keywords: 'k', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/monthly/i);
  });

  it('returns 429 when daily limit is reached', async () => {
    const mongooseConnect = (await import('@/lib/mongoose')).default;
    mongooseConnect.mockResolvedValueOnce({
      db: () => ({
        collection: () => ({
          findOne: vi.fn().mockResolvedValue({ adCopyNewCount: 10 }),
          updateOne: vi.fn(),
        }),
      }),
    });
    const res = await POST(makeRequest({ product: 'p', keywords: 'k', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/__tests__/api/ad-copy-new.test.js
```

Expected: FAIL — cannot find module `@/app/api/claude/ad-copy-new/route.js`

- [ ] **Step 3: Create the system prompt**

Create `src/lib/adCopyNewPrompt.js`:

```javascript
export function getAdCopyNewSystemPrompt() {
  return `You are a Google Ads copywriting expert. Generate high-performing Responsive Search Ad copy from scratch based on the user's product, keywords, USPs, and CTA.

Output ONLY valid JSON in this exact schema:
{
  "headlines": [
    { "text": "string (≤30 chars)", "rationale": "one-line explanation of the angle" }
  ],
  "descriptions": [
    { "text": "string (≤90 chars)", "rationale": "one-line explanation" }
  ]
}

Rules:
- Provide exactly 5 headline variants and 2 description variants
- Every headline must contain or directly mirror at least one provided keyword
- Never invent claims not present in the product description, USPs, or page content
- Each variant must be meaningfully different in angle, not just word order
- All character limits are strict — count carefully`;
}
```

- [ ] **Step 4: Create the API route**

Create `src/app/api/claude/ad-copy-new/route.js`:

```javascript
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import mongooseConnect from '@/lib/mongoose';
import { getCredentials } from '@/lib/dbFunctions';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '@/lib/usageLogger';
import { getAdCopyNewSystemPrompt } from '@/lib/adCopyNewPrompt';

const DAILY_LIMIT = parseInt(process.env.AD_COPY_NEW_DAILY_LIMIT || '10');

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const record = await db.collection('UsageLimits').findOne({ email, date: today });
  return record?.adCopyNewCount || 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { adCopyNewCount: 1 } },
    { upsert: true }
  );
}

function buildUserPrompt({ product, keywords, usps, cta, goal, tone, pageContent }) {
  let prompt = `Product / service: ${product}
Target keywords: ${keywords}
What makes us different (USPs): ${usps}
Main offer / CTA: ${cta}`;

  if (goal) prompt += `\nCampaign goal: ${goal}`;
  if (tone) prompt += `\nTone: ${tone}`;
  if (pageContent) prompt += `\n\nLanding page content (use for additional context only — do not invent new claims):\n${pageContent.slice(0, 20000)}`;

  prompt += '\n\nGenerate the ad copy now.';
  return prompt;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = session.user.email;
  if (!email.endsWith('@' + allowedEmailDomain)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { product, keywords, usps, cta, goal, tone, pageContent } = body;

  if (!product?.trim()) return Response.json({ error: 'product is required' }, { status: 400 });
  if (!keywords?.trim()) return Response.json({ error: 'keywords is required' }, { status: 400 });
  if (!usps?.trim()) return Response.json({ error: 'usps is required' }, { status: 400 });
  if (!cta?.trim()) return Response.json({ error: 'cta is required' }, { status: 400 });

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return Response.json({ error: 'Monthly AI budget reached. Contact your admin.' }, { status: 429 });
  }

  const mongoose = await mongooseConnect();
  const db = mongoose.db();

  const dailyCount = await getDailyUsageCount(db, email);
  if (dailyCount >= DAILY_LIMIT) {
    return Response.json({ error: "You've used your daily AI limit. Try again tomorrow." }, { status: 429 });
  }

  const credentials = await getCredentials(email);
  const client = new Anthropic({ apiKey: credentials.anthropic_api_key });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: getAdCopyNewSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt({ product, keywords, usps, cta, goal, tone, pageContent }) }],
  });

  const rawText = message.content[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  let data;
  try {
    data = JSON.parse(jsonMatch[0]);
  } catch {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  await incrementDailyUsage(db, email);
  await logApiUsage({
    email,
    event: 'ad_copy_new',
    model: 'claude-sonnet-4-6',
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cost: estimateClaudeCost('claude-sonnet-4-6', message.usage.input_tokens, message.usage.output_tokens),
  });

  return Response.json({ data });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run src/__tests__/api/ad-copy-new.test.js
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/adCopyNewPrompt.js src/app/api/claude/ad-copy-new/route.js src/__tests__/api/ad-copy-new.test.js
git commit -m "feat: add Google Ads new campaign copy API route and prompt"
```

---

### Task 2: Meta new campaign prompt + API route

**Files:**
- Create: `src/lib/metaAdCopyNewPrompt.js`
- Create: `src/app/api/claude/meta-ad-copy-new/route.js`
- Create: `src/__tests__/api/meta-ad-copy-new.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// src/__tests__/api/meta-ad-copy-new.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: 'test@lilikoiagency.com' } }),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/mongoose', () => ({
  default: vi.fn().mockResolvedValue({
    db: () => ({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
      }),
    }),
  }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn(),
  estimateClaudeCost: vi.fn().mockReturnValue(0.01),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn().mockReturnValue(true) }));

const { POST } = await import('@/app/api/claude/meta-ad-copy-new/route.js');

function makeRequest(body) {
  return new Request('http://localhost/api/claude/meta-ad-copy-new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/claude/meta-ad-copy-new', () => {
  it('returns 401 when unauthenticated', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when product is missing', async () => {
    const res = await POST(makeRequest({ audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/product/i);
  });

  it('returns 400 when audience is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/audience/i);
  });

  it('returns 400 when usps is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', audience: 'a', cta: 'c' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/usps/i);
  });

  it('returns 400 when cta is missing', async () => {
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cta/i);
  });

  it('returns 429 when monthly budget cap is reached', async () => {
    const { getMonthlyClaudeCost, getClaudeBudgetCap } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(200);
    getClaudeBudgetCap.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/monthly/i);
  });

  it('returns 429 when daily limit is reached', async () => {
    const mongooseConnect = (await import('@/lib/mongoose')).default;
    mongooseConnect.mockResolvedValueOnce({
      db: () => ({
        collection: () => ({
          findOne: vi.fn().mockResolvedValue({ metaAdCopyNewCount: 10 }),
          updateOne: vi.fn(),
        }),
      }),
    });
    const res = await POST(makeRequest({ product: 'p', audience: 'a', usps: 'u', cta: 'c' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/__tests__/api/meta-ad-copy-new.test.js
```

Expected: FAIL — cannot find module `@/app/api/claude/meta-ad-copy-new/route.js`

- [ ] **Step 3: Create the system prompt**

Create `src/lib/metaAdCopyNewPrompt.js`:

```javascript
export function getMetaAdCopyNewSystemPrompt() {
  return `You are a Meta Ads (Facebook/Instagram) copywriting expert. Generate high-performing ad copy from scratch based on the user's product, target audience, USPs, and CTA.

Output ONLY valid JSON in this exact schema:
{
  "primaryTexts": [
    { "text": "string (≤125 chars)", "rationale": "one-line explanation of the angle" }
  ],
  "headlines": [
    { "text": "string (≤40 chars)", "rationale": "one-line explanation" }
  ],
  "descriptions": [
    { "text": "string (≤30 chars)", "rationale": "one-line explanation" }
  ],
  "ctaRecommendation": {
    "cta": "string (e.g. Learn More, Shop Now, Get Quote)",
    "rationale": "one-line explanation"
  }
}

Rules:
- Provide exactly 3 primary text variants, 3 headline variants, and 3 description variants
- Every primary text must speak directly to the stated target audience
- Never invent claims not present in the product description, USPs, or page content
- Each variant must be meaningfully different in angle, not just word order
- All character limits are strict — count carefully`;
}
```

- [ ] **Step 4: Create the API route**

Create `src/app/api/claude/meta-ad-copy-new/route.js`:

```javascript
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import mongooseConnect from '@/lib/mongoose';
import { getCredentials } from '@/lib/dbFunctions';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '@/lib/usageLogger';
import { getMetaAdCopyNewSystemPrompt } from '@/lib/metaAdCopyNewPrompt';

const DAILY_LIMIT = parseInt(process.env.META_AD_COPY_NEW_DAILY_LIMIT || '10');

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const record = await db.collection('UsageLimits').findOne({ email, date: today });
  return record?.metaAdCopyNewCount || 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { metaAdCopyNewCount: 1 } },
    { upsert: true }
  );
}

function buildUserPrompt({ product, audience, usps, cta, goal, tone, pageContent }) {
  let prompt = `Product / service: ${product}
Target audience: ${audience}
What makes us different (USPs): ${usps}
Main offer / CTA: ${cta}`;

  if (goal) prompt += `\nCampaign goal: ${goal}`;
  if (tone) prompt += `\nTone: ${tone}`;
  if (pageContent) prompt += `\n\nLanding page content (use for additional context only — do not invent new claims):\n${pageContent.slice(0, 20000)}`;

  prompt += '\n\nGenerate the ad copy now.';
  return prompt;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = session.user.email;
  if (!email.endsWith('@' + allowedEmailDomain)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { product, audience, usps, cta, goal, tone, pageContent } = body;

  if (!product?.trim()) return Response.json({ error: 'product is required' }, { status: 400 });
  if (!audience?.trim()) return Response.json({ error: 'audience is required' }, { status: 400 });
  if (!usps?.trim()) return Response.json({ error: 'usps is required' }, { status: 400 });
  if (!cta?.trim()) return Response.json({ error: 'cta is required' }, { status: 400 });

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return Response.json({ error: 'Monthly AI budget reached. Contact your admin.' }, { status: 429 });
  }

  const mongoose = await mongooseConnect();
  const db = mongoose.db();

  const dailyCount = await getDailyUsageCount(db, email);
  if (dailyCount >= DAILY_LIMIT) {
    return Response.json({ error: "You've used your daily AI limit. Try again tomorrow." }, { status: 429 });
  }

  const credentials = await getCredentials(email);
  const client = new Anthropic({ apiKey: credentials.anthropic_api_key });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: getMetaAdCopyNewSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt({ product, audience, usps, cta, goal, tone, pageContent }) }],
  });

  const rawText = message.content[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  let data;
  try {
    data = JSON.parse(jsonMatch[0]);
  } catch {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  await incrementDailyUsage(db, email);
  await logApiUsage({
    email,
    event: 'meta_ad_copy_new',
    model: 'claude-sonnet-4-6',
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cost: estimateClaudeCost('claude-sonnet-4-6', message.usage.input_tokens, message.usage.output_tokens),
  });

  return Response.json({ data });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run src/__tests__/api/meta-ad-copy-new.test.js
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/metaAdCopyNewPrompt.js src/app/api/claude/meta-ad-copy-new/route.js src/__tests__/api/meta-ad-copy-new.test.js
git commit -m "feat: add Meta new campaign copy API route and prompt"
```

---

### Task 3: Update existing prompts framing

**Files:**
- Modify: `src/lib/adCopyStrategyPrompt.js`
- Modify: `src/lib/metaAdCopyPrompt.js`

No new tests needed — the prompt modules are pure functions tested implicitly through the route tests.

- [ ] **Step 1: Update `adCopyStrategyPrompt.js`**

Read the current file first, then replace the system prompt string. The key change is adding an explicit instruction to reference current copy by name and focus only on what needs to change.

Open `src/lib/adCopyStrategyPrompt.js`. Find the returned system prompt string and add these rules to the end of the existing rules section:

```
- Reference the current copy explicitly: "Your current headline 'X' has low Ad Relevance because..."
- Do not repeat what is already working — focus output on what needs to change and why
- Replacement variants must be meaningfully different from the originals, not minor rewrites
- Frame all output as improvement recommendations on the current copy, not as new suggestions
```

The full updated export should look like:

```javascript
export function getAdCopyStrategySystemPrompt() {
  return `You are a Google Ads copywriting expert. Analyze the provided campaign's current ad copy and performance metrics, then generate targeted improvement recommendations.

Output ONLY valid JSON in this exact schema:
{
  "campaigns": [
    {
      "campaignId": "string",
      "diagnosis": "2-3 sentence diagnosis of why the current copy is underperforming",
      "strategy": "1-2 sentence strategy for the recommended changes",
      "headlines": [
        { "text": "string (≤30 chars)", "rationale": "one-line explanation referencing the specific weakness being fixed" }
      ],
      "descriptions": [
        { "text": "string (≤90 chars)", "rationale": "one-line explanation" }
      ]
    }
  ]
}

Rules:
- Provide exactly 5 headline variants and 2 description variants per campaign
- Reference the current copy explicitly: "Your current headline 'X' has low Ad Relevance because..."
- Do not repeat what is already working — focus output on what needs to change and why
- Replacement variants must be meaningfully different from the originals, not minor rewrites
- Frame all output as improvement recommendations on the current copy, not as new suggestions
- Never invent claims not supported by the campaign's existing copy or context
- All character limits are strict — count carefully`;
}
```

- [ ] **Step 2: Update `metaAdCopyPrompt.js`**

Same framing update. Open `src/lib/metaAdCopyPrompt.js` and update the system prompt:

```javascript
export function getMetaAdCopySystemPrompt() {
  return `You are a Meta Ads (Facebook/Instagram) copywriting expert. Analyze the provided campaign's current ad copy and performance metrics, then generate targeted improvement recommendations.

Output ONLY valid JSON in this exact schema:
{
  "diagnosis": "2-3 sentence diagnosis of why the current copy is underperforming",
  "strategy": "1-2 sentence strategy for the recommended changes",
  "primaryTexts": [
    { "text": "string (≤125 chars)", "rationale": "one-line explanation referencing the specific weakness being fixed" }
  ],
  "headlines": [
    { "text": "string (≤40 chars)", "rationale": "one-line explanation" }
  ],
  "descriptions": [
    { "text": "string (≤30 chars)", "rationale": "one-line explanation" }
  ],
  "ctaRecommendation": {
    "cta": "string (e.g. Learn More, Shop Now, Get Quote)",
    "rationale": "one-line explanation"
  }
}

Rules:
- Provide exactly 3 primary text variants, 3 headline variants, and 3 description variants
- Reference the current copy explicitly: "Your current primary text 'X' is not connecting because..."
- Do not repeat what is already working — focus output on what needs to change and why
- Replacement variants must be meaningfully different from the originals, not minor rewrites
- Frame all output as improvement recommendations on the current copy, not as new suggestions
- Never invent claims not supported by the campaign's existing copy or context
- All character limits are strict — count carefully`;
}
```

- [ ] **Step 3: Run the full test suite to verify nothing broke**

```
npx vitest run
```

Expected: All tests PASS (same pass count as before this task)

- [ ] **Step 4: Commit**

```bash
git add src/lib/adCopyStrategyPrompt.js src/lib/metaAdCopyPrompt.js
git commit -m "feat: reframe existing copy prompts as improvement recommendations"
```

---

### Task 4: Update AdCopyPanel.jsx + component tests

**Files:**
- Modify: `src/app/dashboard/google/ads/components/AdCopyPanel.jsx`
- Modify: `src/__tests__/components/AdCopyPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Read `src/__tests__/components/AdCopyPanel.test.jsx` first to understand existing tests. Add these new tests at the end of the existing describe block (don't remove existing tests):

```javascript
describe('Mode toggle', () => {
  it('renders New campaign and Existing campaign toggle buttons', () => {
    render(<AdCopyPanel campaigns={mockCampaigns} />);
    // open panel
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    expect(screen.getByText('New campaign')).toBeInTheDocument();
    expect(screen.getByText('Existing campaign')).toBeInTheDocument();
  });

  it('shows existing campaign form by default when campaigns exist', () => {
    render(<AdCopyPanel campaigns={mockCampaigns} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    expect(screen.getByText(/select a campaign/i)).toBeInTheDocument();
  });

  it('switches to new campaign form when New campaign tab is clicked', () => {
    render(<AdCopyPanel campaigns={mockCampaigns} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    fireEvent.click(screen.getByText('New campaign'));
    expect(screen.getByPlaceholderText(/emergency plumbing/i)).toBeInTheDocument();
  });

  it('shows new campaign form by default when no campaigns exist', () => {
    render(<AdCopyPanel campaigns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    expect(screen.getByPlaceholderText(/emergency plumbing/i)).toBeInTheDocument();
  });
});

describe('New campaign form', () => {
  beforeEach(() => {
    render(<AdCopyPanel campaigns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
  });

  it('disables generate button when required fields are empty', () => {
    const btn = screen.getByRole('button', { name: /generate ad copy/i });
    expect(btn).toBeDisabled();
  });

  it('enables generate button when all required fields are filled', () => {
    fireEvent.change(screen.getByPlaceholderText(/emergency plumbing/i), { target: { value: 'Plumbing services' } });
    fireEvent.change(screen.getByPlaceholderText(/emergency plumber/i), { target: { value: 'plumber, repair' } });
    fireEvent.change(screen.getByPlaceholderText(/licensed/i), { target: { value: 'Licensed & insured' } });
    fireEvent.change(screen.getByPlaceholderText(/free estimate/i), { target: { value: 'Call now' } });
    const btn = screen.getByRole('button', { name: /generate ad copy/i });
    expect(btn).not.toBeDisabled();
  });

  it('toggles campaign goal pill selection', () => {
    const leadsBtn = screen.getByRole('button', { name: 'Leads' });
    fireEvent.click(leadsBtn);
    expect(leadsBtn).toHaveClass('selected'); // or aria-pressed="true" — adjust to actual implementation
    fireEvent.click(leadsBtn);
    expect(leadsBtn).not.toHaveClass('selected');
  });
});

describe('Existing campaign current copy preview', () => {
  const campaignsWithAds = [
    {
      campaignId: '1',
      name: 'Services',
      spend: 1000,
      ctr: 0.02,
      conversions: 5,
      verdict: 'Needs work',
      ads: [{ headlines: ['Headline One', 'Headline Two'], descriptions: ['Desc one here for the ad.'] }],
    },
  ];

  it('shows current copy preview when a campaign is selected', async () => {
    render(<AdCopyPanel campaigns={campaignsWithAds} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    // campaign auto-selected (underperforming)
    await waitFor(() => {
      expect(screen.getByText('Headline One')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

```
npx vitest run src/__tests__/components/AdCopyPanel.test.jsx
```

Expected: New tests FAIL, existing tests still PASS

- [ ] **Step 3: Update AdCopyPanel.jsx**

Read the full current file at `src/app/dashboard/google/ads/components/AdCopyPanel.jsx` (359 lines), then rewrite it with the following changes. Key structural changes:

**New state additions** (add to existing useState declarations):
```javascript
const [mode, setMode] = useState(() =>
  campaigns.some(c => c.verdict === 'Needs work' || c.verdict === 'Underperforming') ? 'existing' : 'new'
);
const [newProduct, setNewProduct] = useState('');
const [newKeywords, setNewKeywords] = useState('');
const [newUsps, setNewUsps] = useState('');
const [newCta, setNewCta] = useState('');
const [newGoal, setNewGoal] = useState(null);
const [newTone, setNewTone] = useState(null);
const [newPageUrl, setNewPageUrl] = useState('');
const [newPageContent, setNewPageContent] = useState('');
const [newFetchStatus, setNewFetchStatus] = useState('idle'); // 'idle' | 'loading' | 'error'
const [newFetchError, setNewFetchError] = useState('');
const [existingFocus, setExistingFocus] = useState('');
const newFetchAbortRef = useRef(null);
```

**Add `useRef` to React import.**

**Update `canGenerate`:**
```javascript
const canGenerateExisting = !!selectedId && business.trim() && audience.trim() && usps.trim() && !auditLoading;
const canGenerateNew = newProduct.trim() && newKeywords.trim() && newUsps.trim() && newCta.trim() && newFetchStatus !== 'loading';
const canGenerate = mode === 'existing' ? canGenerateExisting : canGenerateNew;
```

**Update `handleGenerate`** to branch on mode:
```javascript
async function handleGenerate() {
  setView('loading');
  setErrorMsg('');
  try {
    if (mode === 'new') {
      const res = await fetch('/api/claude/ad-copy-new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: newProduct,
          keywords: newKeywords,
          usps: newUsps,
          cta: newCta,
          ...(newGoal && { goal: newGoal }),
          ...(newTone && { tone: newTone }),
          ...(newPageContent && { pageContent: newPageContent }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setResults({ mode: 'new', ...json.data });
    } else {
      // existing mode — same as before, keep buildCampaignPayload logic
      const campaign = campaigns.find(c => String(c.campaignId) === selectedId);
      const payload = buildCampaignPayload(campaign, auditData);
      const res = await fetch('/api/claude/ad-copy-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: campaign.customerId,
          context: { business, audience, usps, tone, offer, focus: existingFocus },
          campaigns: [payload],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setResults({ mode: 'existing', ...json.data });
    }
    setView('results');
  } catch (err) {
    setErrorMsg(err.message);
    setView('form');
  }
}
```

**Add `NewCampaignForm` function component** (inside the file, before `FormView`):
```javascript
function NewCampaignForm({ product, setProduct, keywords, setKeywords, usps, setUsps, cta, setCta,
  goal, setGoal, tone, setTone, pageUrl, setPageUrl, pageContent, setPageContent,
  fetchStatus, fetchError, setFetchStatus, setFetchError, abortRef }) {

  const GOALS = ['Leads', 'Sales', 'Awareness', 'Traffic'];
  const TONES = ['Professional', 'Friendly', 'Urgent', 'Bold'];

  async function handleFetch() {
    if (!pageUrl.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFetchStatus('loading');
    setFetchError('');
    try {
      const res = await fetch('/api/fetch-page-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pageUrl }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fetch failed');
      setPageContent(json.content || '');
      setFetchStatus('idle');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setFetchError(err.message);
      setPageUrl('');
      setPageContent('');
      setFetchStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#111827', display: 'block', marginBottom: 4 }}>
          What are you selling? <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          value={product}
          onChange={e => setProduct(e.target.value)}
          placeholder="e.g. Emergency plumbing repair services in Miami"
          style={{ width: '100%', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box' }}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#111827', display: 'block', marginBottom: 4 }}>
          Target keywords <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="e.g. emergency plumber, burst pipe repair, 24 hour plumber"
          style={{ width: '100%', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box' }}
        />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Separate with commas.</div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#111827', display: 'block', marginBottom: 4 }}>
          What makes you different? <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <textarea
          rows={3}
          value={usps}
          onChange={e => setUsps(e.target.value)}
          placeholder="e.g. Licensed & insured, 60-min response, upfront pricing, 5-star rated"
          style={{ width: '100%', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box', resize: 'vertical' }}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#111827', display: 'block', marginBottom: 4 }}>
          Main offer or CTA <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          value={cta}
          onChange={e => setCta(e.target.value)}
          placeholder="e.g. Free estimate · Call now · 20% off first visit"
          style={{ width: '100%', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ borderTop: '1px solid #f1f5f9' }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
          Campaign goal <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>optional</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GOALS.map(g => (
            <button
              key={g}
              onClick={() => setGoal(goal === g ? null : g)}
              className={goal === g ? 'selected' : ''}
              style={{
                fontSize: 12,
                border: goal === g ? '1px solid #2563eb' : '1px solid #cbd5e1',
                borderRadius: 20,
                padding: '5px 14px',
                color: goal === g ? '#2563eb' : '#374151',
                background: goal === g ? '#eff6ff' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
          Tone <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>optional</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TONES.map(t => (
            <button
              key={t}
              onClick={() => setTone(tone === t ? null : t)}
              className={tone === t ? 'selected' : ''}
              style={{
                fontSize: 12,
                border: tone === t ? '1px solid #2563eb' : '1px solid #cbd5e1',
                borderRadius: 20,
                padding: '5px 14px',
                color: tone === t ? '#2563eb' : '#374151',
                background: tone === t ? '#eff6ff' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 5 }}>
          Landing page URL <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>optional</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={pageUrl}
            onChange={e => setPageUrl(e.target.value)}
            placeholder="https://"
            style={{ flex: 1, fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}
          />
          <button
            onClick={handleFetch}
            disabled={!pageUrl.trim() || fetchStatus === 'loading'}
            style={{ fontSize: 12, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {fetchStatus === 'loading' ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {fetchError && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{fetchError}</div>}
        {pageContent && <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>Page content loaded.</div>}
      </div>
    </div>
  );
}
```

**Update `FormView`** to:
1. Accept `mode`, `setMode`, `existingFocus`, `setExistingFocus` props alongside existing props
2. Add mode toggle at the top
3. Conditionally render `NewCampaignForm` or the existing campaign picker + current copy preview + focus field

Mode toggle JSX (add at top of FormView return, before existing content):
```javascript
{/* Mode toggle */}
<div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 3, gap: 2, marginBottom: 4 }}>
  {['new', 'existing'].map(m => (
    <button
      key={m}
      onClick={() => setMode(m)}
      style={{
        flex: 1,
        textAlign: 'center',
        fontSize: 12,
        fontWeight: mode === m ? 700 : 600,
        color: mode === m ? '#1d4ed8' : '#64748b',
        background: mode === m ? '#fff' : 'transparent',
        border: 'none',
        padding: '7px',
        borderRadius: 8,
        boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
        cursor: 'pointer',
      }}
    >
      {m === 'new' ? 'New campaign' : 'Existing campaign'}
    </button>
  ))}
</div>
```

Current copy preview in existing campaign section (add between campaign selector and focus field):
```javascript
{/* Current copy preview */}
{selectedId && (() => {
  const sel = campaigns.find(c => String(c.campaignId) === selectedId);
  const ads = sel?.ads || [];
  const headlines = ads.flatMap(ad => ad.headlines || []).filter(Boolean).slice(0, 10);
  const descriptions = ads.flatMap(ad => ad.descriptions || []).filter(Boolean).slice(0, 4);
  if (!headlines.length && !descriptions.length) return null;
  return (
    <div style={{ border: '1px solid #e0e7ff', background: '#f8faff', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6366f1', marginBottom: 8 }}>
        Current ad copy · pulled from your account
      </div>
      {headlines.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 6, fontWeight: 600 }}>Headlines</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
            {headlines.map((h, i) => (
              <span key={i} style={{ fontSize: 11, background: '#fff', border: '1px solid #e0e7ff', borderRadius: 6, padding: '3px 8px', color: '#374151' }}>
                {h}
              </span>
            ))}
          </div>
        </>
      )}
      {descriptions.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 6, fontWeight: 600 }}>Descriptions</div>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
            {descriptions.join(' ')}
          </div>
        </>
      )}
    </div>
  );
})()}
```

**Add `NewCampaignResultsView` function component:**
```javascript
function NewCampaignResultsView({ results, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} style={{ alignSelf: 'flex-start', fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        ← Back
      </button>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Headlines</div>
        {(results.headlines || []).map((h, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1d4ed8' }}>{h.text}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{h.rationale}</div>
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Descriptions</div>
        {(results.descriptions || []).map((d, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: '#374151' }}>{d.text}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{d.rationale}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Update `ResultsView`** to branch on `results.mode`:
```javascript
// At the top of ResultsView component:
if (results.mode === 'new') {
  return <NewCampaignResultsView results={results} onBack={onBack} />;
}
// ... rest of existing ResultsView for mode === 'existing'
```

**Update generate button label** based on mode:
```javascript
{mode === 'new' ? 'Generate ad copy' : 'Generate recommendations'}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/__tests__/components/AdCopyPanel.test.jsx
```

Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/google/ads/components/AdCopyPanel.jsx src/__tests__/components/AdCopyPanel.test.jsx
git commit -m "feat: add two-mode toggle to AdCopyPanel (new campaign + existing campaign)"
```

---

### Task 5: Update MetaAdCopyPanel.jsx + component tests

**Files:**
- Modify: `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx`
- Modify: `src/__tests__/components/MetaAdCopyPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Read `src/__tests__/components/MetaAdCopyPanel.test.jsx` first. Add these tests at the end:

```javascript
describe('Mode toggle', () => {
  it('renders New campaign and Existing campaign toggle buttons', () => {
    render(<MetaAdCopyPanel campaigns={mockCampaigns} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    expect(screen.getByText('New campaign')).toBeInTheDocument();
    expect(screen.getByText('Existing campaign')).toBeInTheDocument();
  });

  it('shows existing campaign form by default when campaigns with spend exist', () => {
    render(<MetaAdCopyPanel campaigns={mockCampaigns} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    expect(screen.getByText(/select a campaign/i)).toBeInTheDocument();
  });

  it('switches to new campaign form when New campaign tab is clicked', () => {
    render(<MetaAdCopyPanel campaigns={mockCampaigns} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    fireEvent.click(screen.getByText('New campaign'));
    expect(screen.getByPlaceholderText(/homeowners/i)).toBeInTheDocument(); // audience field
  });

  it('shows new campaign form by default when no campaigns exist', () => {
    render(<MetaAdCopyPanel campaigns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
    expect(screen.getByPlaceholderText(/homeowners/i)).toBeInTheDocument();
  });
});

describe('New campaign form — Meta', () => {
  beforeEach(() => {
    render(<MetaAdCopyPanel campaigns={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /ad copy/i }));
  });

  it('has Target audience field instead of keywords', () => {
    expect(screen.getByPlaceholderText(/homeowners/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/keyword/i)).not.toBeInTheDocument();
  });

  it('disables generate button when required fields are empty', () => {
    const btn = screen.getByRole('button', { name: /generate ad copy/i });
    expect(btn).toBeDisabled();
  });

  it('enables generate button when all required fields are filled', () => {
    fireEvent.change(screen.getByPlaceholderText(/emergency plumbing/i), { target: { value: 'Plumbing' } });
    fireEvent.change(screen.getByPlaceholderText(/homeowners/i), { target: { value: 'Homeowners 30-55' } });
    fireEvent.change(screen.getByPlaceholderText(/licensed/i), { target: { value: 'Licensed' } });
    fireEvent.change(screen.getByPlaceholderText(/free estimate/i), { target: { value: 'Call now' } });
    const btn = screen.getByRole('button', { name: /generate ad copy/i });
    expect(btn).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

```
npx vitest run src/__tests__/components/MetaAdCopyPanel.test.jsx
```

Expected: New tests FAIL, existing tests still PASS

- [ ] **Step 3: Update MetaAdCopyPanel.jsx**

Read the full current file at `src/app/dashboard/meta/components/MetaAdCopyPanel.jsx` (252 lines). Apply the same changes as Task 4 with these differences:

**New state** — same as Task 4 except `newKeywords` becomes `newAudience`:
```javascript
const [mode, setMode] = useState(() =>
  campaigns.some(c => c.spend > 0) ? 'existing' : 'new'
);
const [newProduct, setNewProduct] = useState('');
const [newAudience, setNewAudience] = useState('');
const [newUsps, setNewUsps] = useState('');
const [newCta, setNewCta] = useState('');
const [newGoal, setNewGoal] = useState(null);
const [newTone, setNewTone] = useState(null);
const [newPageUrl, setNewPageUrl] = useState('');
const [newPageContent, setNewPageContent] = useState('');
const [newFetchStatus, setNewFetchStatus] = useState('idle');
const [newFetchError, setNewFetchError] = useState('');
const [existingFocus, setExistingFocus] = useState('');
const newFetchAbortRef = useRef(null);
```

**`canGenerateNew`:**
```javascript
const canGenerateNew = newProduct.trim() && newAudience.trim() && newUsps.trim() && newCta.trim() && newFetchStatus !== 'loading';
```

**`handleGenerate` new mode branch** — POSTs to `/api/claude/meta-ad-copy-new` with `audience` instead of `keywords`:
```javascript
const res = await fetch('/api/claude/meta-ad-copy-new', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    product: newProduct,
    audience: newAudience,
    usps: newUsps,
    cta: newCta,
    ...(newGoal && { goal: newGoal }),
    ...(newTone && { tone: newTone }),
    ...(newPageContent && { pageContent: newPageContent }),
  }),
});
```

**`MetaNewCampaignForm`** — same as `NewCampaignForm` from Task 4 but the keywords field is replaced with audience:
```javascript
<div>
  <label style={{ fontSize: 12, fontWeight: 700, color: '#111827', display: 'block', marginBottom: 4 }}>
    Target audience <span style={{ color: '#dc2626' }}>*</span>
  </label>
  <input
    value={audience}
    onChange={e => setAudience(e.target.value)}
    placeholder="e.g. Homeowners 30–55, interested in home improvement"
    style={{ width: '100%', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box' }}
  />
</div>
```

**Current copy preview in existing mode** — uses `creatives` from the existing state:
```javascript
{selectedId && (() => {
  const sel = campaignsWithSpend.find(c => String(c.id) === selectedId);
  const topCreative = creatives[sel?.id]?.[0]?.creative;
  if (!topCreative) return null;
  return (
    <div style={{ border: '1px solid #e0e7ff', background: '#f8faff', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6366f1', marginBottom: 8 }}>
        Current ad copy · pulled from your account
      </div>
      {topCreative.body && (
        <>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>Primary text</div>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5, marginBottom: 10 }}>{topCreative.body}</div>
        </>
      )}
      {topCreative.title && (
        <>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>Headline</div>
          <div style={{ fontSize: 11, color: '#374151' }}>{topCreative.title}</div>
        </>
      )}
    </div>
  );
})()}
```

**`MetaNewCampaignResultsView`** — shows primaryTexts, headlines, descriptions, ctaRecommendation:
```javascript
function MetaNewCampaignResultsView({ results, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} style={{ alignSelf: 'flex-start', fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        ← Back
      </button>
      {results.primaryTexts?.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Primary Texts</div>
          {results.primaryTexts.map((pt, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: '#374151' }}>{pt.text}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{pt.rationale}</div>
            </div>
          ))}
        </div>
      )}
      {results.headlines?.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Headlines</div>
          {results.headlines.map((h, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1d4ed8' }}>{h.text}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{h.rationale}</div>
            </div>
          ))}
        </div>
      )}
      {results.descriptions?.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Descriptions</div>
          {results.descriptions.map((d, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: '#374151' }}>{d.text}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{d.rationale}</div>
            </div>
          ))}
        </div>
      )}
      {results.ctaRecommendation && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Recommended CTA</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1d4ed8' }}>{results.ctaRecommendation.cta}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{results.ctaRecommendation.rationale}</div>
        </div>
      )}
    </div>
  );
}
```

**Update existing `ResultsView`** to check `results.mode === 'new'` and delegate to `MetaNewCampaignResultsView`.

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/__tests__/components/MetaAdCopyPanel.test.jsx
```

Expected: All tests PASS

- [ ] **Step 5: Run the full test suite**

```
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/meta/components/MetaAdCopyPanel.jsx src/__tests__/components/MetaAdCopyPanel.test.jsx
git commit -m "feat: add two-mode toggle to MetaAdCopyPanel (new campaign + existing campaign)"
```
