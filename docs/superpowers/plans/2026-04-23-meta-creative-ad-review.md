# Meta Creative Ad Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered LeadsIcon ad-review scoring (Hook/Proof/CTA/Visual) to the creatives gallery page — "Review All" batch mode (text-only, 10 ads/call) and "Review" single mode (multimodal with image).

**Architecture:** New Claude route `/api/claude/ad-review` handles auth + daily limits + prompt building + JSON parsing. The existing creatives page (`/dashboard/meta/creatives`) gains review state, a "Review All" batch orchestrator, per-card review buttons, verdict footer strips, and a full review modal. Zero new Meta API calls — all data comes from the already-fetched top-creatives payload.

**Tech Stack:** Next.js App Router, Anthropic SDK (`claude-sonnet-4-6`), React client state, MongoDB `UsageLimits` collection for daily limits.

---

## File Map

| File | Action |
|------|--------|
| `src/app/api/claude/ad-review/route.js` | **Create** — Claude route: auth, daily limit, batch + single prompt, JSON parse, usage increment |
| `src/app/dashboard/meta/creatives/page.js` | **Modify** — review state, Review All button, batch orchestration, per-card Review button, footer strip, ReviewModal |

---

### Task 1: Create `/api/claude/ad-review/route.js`

**Files:**
- Create: `src/app/api/claude/ad-review/route.js`

- [ ] **Step 1: Create the route file**

```javascript
// src/app/api/claude/ad-review/route.js
export const maxDuration = 180;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { logApiUsage, estimateClaudeCost } from '../../../../lib/usageLogger';
import { isAdmin } from '../../../../lib/admins';
import dbConnect from '../../../../lib/mongoose';

const DAILY_LIMIT = parseInt(process.env.META_AD_REVIEW_DAILY_LIMIT || '10');
const DB = 'tokensApi';

const SYSTEM_PROMPT = `You are an expert ad creative reviewer applying the LeadsIcon ad-review rubric.

Score each ad on four categories (25 pts each, 100 total):
- Hook (25): Stops scroll in 1–3s, creates curiosity, relevant to avatar, doesn't reveal product too soon
- Proof (25): Social proof, authority, results/data, believable demonstration
- CTA (25): Clear next step, natural urgency, risk reversal, correct placement (not too early)
- Visual (25): Platform-native quality (not over-produced), genuine/authentic feel, clear audio and text

Authenticity test: "Would comments call this fake?" If yes → needs work.
Platform native test: "Does this look like content or an ad?" Content = good.

Return ONLY a valid JSON array — no markdown, no explanation — with one object per ad.
Each object must have: adId, status ("APPROVED"|"REVISE"|"REJECT"), overallScore (0-100),
scores {hook, proof, cta, visual}, summary (one sentence), hook {strengths[], issues[], recommendation},
proof {elements[], missing[], recommendation}, cta {placement, clarity, urgency, recommendation},
visual {productionQuality, authenticity, issues[]}, platformFit (string[]),
actionItems {required[], recommended[]}, prediction ("High potential"|"Medium"|"Low").`;

function buildBatchUserMessage(ads, accountId) {
  const lines = [`Review these ${ads.length} ads for account ${accountId}:\n`];
  ads.forEach((ad, i) => {
    const ins = ad.metrics || {};
    lines.push(`--- Ad ${i + 1} ---`);
    lines.push(`ID: ${ad.id}`);
    lines.push(`Name: ${ad.name || '(none)'}`);
    lines.push(`Headline: ${ad.title || '(none)'}`);
    lines.push(`Copy: ${ad.body || '(none)'}`);
    lines.push(`CTA Button: ${ad.ctaType || '(none)'}`);
    lines.push(`Performance: $${(ins.spend || 0).toFixed(2)} spend · ${((ins.ctr || 0) * 100).toFixed(2)}% CTR · ${ins.conversions || 0} conversions · ${ins.roas != null ? ins.roas.toFixed(2) + 'x' : '—'} ROAS · ${(ins.frequency || 0).toFixed(2)}x frequency\n`);
  });
  return lines.join('\n');
}

async function getDailyUsageCount(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('UsageLimits').findOne({ email, date: today });
  return doc?.adReviewCount ?? 0;
}

async function incrementDailyUsage(db, email) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('UsageLimits').updateOne(
    { email, date: today },
    { $inc: { adReviewCount: 1 }, $setOnInsert: { email, date: today } },
    { upsert: true },
  );
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 }); }

  const { ads, mode, accountId } = body;
  if (!Array.isArray(ads) || ads.length === 0 || !accountId) {
    return NextResponse.json({ error: 'ads (non-empty array) and accountId are required', requestId }, { status: 400 });
  }
  if (!['batch', 'single'].includes(mode)) {
    return NextResponse.json({ error: 'mode must be "batch" or "single"', requestId }, { status: 400 });
  }

  const dbClient = await dbConnect();
  const db = dbClient.db(DB);

  if (!isAdmin(email)) {
    const usedToday = await getDailyUsageCount(db, email);
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json({
        error: `Daily ad review limit reached (${DAILY_LIMIT}/day). Resets at midnight.`,
        limitReached: true,
        usage: { count: usedToday, limit: DAILY_LIMIT, remaining: 0 },
        requestId,
      }, { status: 429 });
    }
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

  // Build messages array based on mode
  let messages;
  if (mode === 'batch') {
    messages = [{ role: 'user', content: buildBatchUserMessage(ads, accountId) }];
  } else {
    // single mode: text + optional image
    const ad = ads[0];
    const textBlock = { type: 'text', text: buildBatchUserMessage([ad], accountId) };
    const contentBlocks = [textBlock];
    if (ad.imageUrl) {
      contentBlocks.unshift({ type: 'image', source: { type: 'url', url: ad.imageUrl } });
    }
    messages = [{ role: 'user', content: contentBlocks }];
  }

  const RETRY_DELAYS = [5_000, 15_000];
  let response;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      });
      break;
    } catch (err) {
      if (err?.status === 529 && attempt < 2) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      console.error('[claude/ad-review] Claude error:', err?.message);
      return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
    }
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let reviews;
  try {
    const clean = rawText.replace(/^```json\s*/m, '').replace(/^```\s*$/m, '').trim();
    const parsed = JSON.parse(clean);
    reviews = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error('[claude/ad-review] JSON parse failed:', rawText.slice(0, 500));
    return NextResponse.json({ error: 'Failed to parse AI response as JSON', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'ad_review',
    email,
    accountId: String(accountId),
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  let remainingToday = DAILY_LIMIT;
  if (!isAdmin(email)) {
    await incrementDailyUsage(db, email).catch(() => {});
    const newCount = await getDailyUsageCount(db, email).catch(() => DAILY_LIMIT);
    remainingToday = Math.max(0, DAILY_LIMIT - newCount);
  }

  return NextResponse.json({
    reviews,
    requestId,
    usage: { count: DAILY_LIMIT - remainingToday, limit: DAILY_LIMIT, remaining: remainingToday },
  });
}
```

- [ ] **Step 2: Verify the route file exists**

Run: `ls src/app/api/claude/ad-review/route.js`  
Expected: file listed

- [ ] **Step 3: Manual smoke test — confirm auth guard**

With the dev server running, run in a terminal:
```bash
curl -s -X POST http://localhost:3000/api/claude/ad-review \
  -H "Content-Type: application/json" \
  -d '{"ads":[],"mode":"batch","accountId":"test"}' | jq .
```
Expected: `{"error":"Unauthorized",...}` (401 — no session cookie)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/claude/ad-review/route.js
git commit -m "feat: add /api/claude/ad-review route (batch + single modes, daily limits)"
```

---

### Task 2: Add review state + "Review All" button + batch orchestration to `AllCreativesInner`

**Files:**
- Modify: `src/app/dashboard/meta/creatives/page.js`

The changes in this task are all inside `AllCreativesInner`. We add state variables, a `reviewAll()` async function, and a "Review All" button in the top filter bar. We do NOT touch `LazyCreativeCard` yet.

- [ ] **Step 1: Add review state declarations**

In `AllCreativesInner`, after the existing `const [error, setError] = useState(null);` line (line 89), add:

```javascript
  // ── Ad review state ──────────────────────────────────────────────────────────
  const [reviews, setReviews] = useState({});            // { [adId]: reviewResult }
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewProgress, setReviewProgress] = useState({ current: 0, total: 0 });
  const [reviewModal, setReviewModal] = useState(null);  // adId | null
  const [reviewUsage, setReviewUsage] = useState(null);  // { count, limit, remaining }
  const [reviewError, setReviewError] = useState(null);
```

- [ ] **Step 2: Add `reviewAll()` function**

Add this function inside `AllCreativesInner`, after the `filtered` useMemo (after line 135):

```javascript
  async function reviewAll() {
    if (!filtered.length || reviewLoading) return;
    setReviewLoading(true);
    setReviewError(null);
    setReviewProgress({ current: 0, total: filtered.length });

    const CHUNK = 10;
    const chunks = [];
    for (let i = 0; i < filtered.length; i += CHUNK) chunks.push(filtered.slice(i, i + CHUNK));

    let processed = 0;
    for (const chunk of chunks) {
      const adPayloads = chunk.map((ad) => ({
        id: ad.id,
        name: ad.name || '',
        title: ad.creative?.title || '',
        body: ad.creative?.body || '',
        ctaType: ad.creative?.call_to_action_type || '',
        imageUrl: null, // batch mode: text-only
        metrics: ad.insights || {},
      }));

      try {
        const res = await fetch('/api/claude/ad-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ads: adPayloads, mode: 'batch', accountId }),
        });
        const json = await res.json();

        if (res.status === 429 || json.limitReached) {
          setReviewError(json.error || 'Daily review limit reached.');
          if (json.usage) setReviewUsage(json.usage);
          break;
        }
        if (!res.ok) {
          setReviewError(json.error || `Error ${res.status}`);
          break;
        }

        if (json.usage) setReviewUsage(json.usage);
        const newReviews = {};
        (json.reviews || []).forEach((r) => { newReviews[r.adId] = r; });
        setReviews((prev) => ({ ...prev, ...newReviews }));
      } catch (err) {
        setReviewError(err.message || 'Network error');
        break;
      }

      processed += chunk.length;
      setReviewProgress({ current: processed, total: filtered.length });
      if (processed < filtered.length) await new Promise((r) => setTimeout(r, 500));
    }

    setReviewLoading(false);
  }
```

- [ ] **Step 3: Add "Review All" button to the filter bar**

In the filter bar `<div>` (the `mt-4 flex items-center gap-2 flex-wrap` div, after the `<input>` for search), add the Review All button and progress/error display. Replace the closing `</div>` of that filter bar div with:

```jsx
          <button
            onClick={reviewAll}
            disabled={reviewLoading || !ads?.length}
            style={{
              marginLeft: "auto",
              background: reviewLoading ? "#93c5fd" : ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: reviewLoading || !ads?.length ? "not-allowed" : "pointer",
              opacity: !ads?.length ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
            {reviewLoading ? (
              <>
                <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
                Reviewing {reviewProgress.current}–{Math.min(reviewProgress.current + 10, reviewProgress.total)} of {reviewProgress.total}…
              </>
            ) : (
              <>★ Review All</>
            )}
          </button>
        </div>
        {reviewError && (
          <div className="mt-2 text-xs text-red-500 font-medium">{reviewError}</div>
        )}
        {reviewUsage && !reviewError && (
          <div className="mt-2 text-[11px] text-gray-400">{reviewUsage.remaining} reviews remaining today</div>
        )}
```

- [ ] **Step 4: Pass review props down to `LazyCreativeCard`**

In the grid render (around line 200–202), change:
```jsx
            {filtered.map((ad, i) => (
              <LazyCreativeCard key={ad.id} ad={ad} rank={i + 1} />
            ))}
```
to:
```jsx
            {filtered.map((ad, i) => (
              <LazyCreativeCard
                key={ad.id}
                ad={ad}
                rank={i + 1}
                accountId={accountId}
                review={reviews[ad.id] || null}
                batchReviewInProgress={reviewLoading}
                onOpenReviewModal={() => setReviewModal(ad.id)}
                onReviewDone={(result, usage) => {
                  setReviews((prev) => ({ ...prev, [ad.id]: result }));
                  if (usage) setReviewUsage(usage);
                }}
              />
            ))}
```

- [ ] **Step 5: Manual verification**

With the dev server running, navigate to a creatives page with an account that has ads. Verify:
- "★ Review All" button appears in the filter bar
- Button is disabled while ads are loading
- No console errors in `AllCreativesInner`

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/meta/creatives/page.js
git commit -m "feat: add Review All button + batch orchestration to creatives page"
```

---

### Task 3: Add per-card "Review" button + `reviewSingle()` to `LazyCreativeCard`

**Files:**
- Modify: `src/app/dashboard/meta/creatives/page.js`

- [ ] **Step 1: Update `LazyCreativeCard` signature to accept new props**

Change the function signature from:
```javascript
function LazyCreativeCard({ ad, rank }) {
```
to:
```javascript
function LazyCreativeCard({ ad, rank, accountId, review, batchReviewInProgress, onOpenReviewModal, onReviewDone }) {
```

- [ ] **Step 2: Add single-review loading state inside `LazyCreativeCard`**

After `const cardRef = useRef(null);` (currently last state/ref declaration), add:
```javascript
  const [singleReviewLoading, setSingleReviewLoading] = useState(false);
```

- [ ] **Step 3: Add `reviewSingle()` function inside `LazyCreativeCard`**

Add after the existing `useEffect` for preview fetching (after the `// eslint-disable-next-line` comment block, around line 267):

```javascript
  async function reviewSingle() {
    if (singleReviewLoading || batchReviewInProgress) return;
    setSingleReviewLoading(true);
    try {
      const res = await fetch('/api/claude/ad-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ads: [{
            id: ad.id,
            name: ad.name || '',
            title: ad.creative?.title || '',
            body: ad.creative?.body || '',
            ctaType: ad.creative?.call_to_action_type || '',
            imageUrl: ad.creative?.image_url || null,
            metrics: ad.insights || {},
          }],
          mode: 'single',
          accountId,
        }),
      });
      const json = await res.json();
      if (res.ok && json.reviews?.length) {
        onReviewDone(json.reviews[0], json.usage);
      }
    } catch (err) {
      console.error('[reviewSingle]', err);
    } finally {
      setSingleReviewLoading(false);
    }
  }
```

- [ ] **Step 4: Add the "Review" pill button to the card header**

In the card header `<div className="flex items-center justify-between gap-3 mb-2">`, the current content is:
```jsx
          <span style={{ background: ACCENT, ... }}>#{rank}</span>
          <span className="text-[10px] ..." style={{ ... }}>{ad.effective_status || ...}</span>
```

Change to add the Review button between the rank badge and status badge:
```jsx
          <span style={{ background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, letterSpacing: 0.3 }}>
            #{rank}
          </span>
          <button
            onClick={review ? onOpenReviewModal : reviewSingle}
            disabled={singleReviewLoading || batchReviewInProgress}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 999,
              border: `1px solid ${ACCENT}`,
              background: review ? ACCENT : "transparent",
              color: review ? "#fff" : ACCENT,
              cursor: singleReviewLoading || batchReviewInProgress ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: batchReviewInProgress && !singleReviewLoading ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {singleReviewLoading ? (
              <span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${ACCENT}40`, borderTopColor: ACCENT, borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
            ) : (
              "★"
            )}
            {review ? "Reviewed" : "Review"}
          </button>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
            style={{
              background: statusOk ? "rgba(34,197,94,0.12)" : "rgba(100,116,139,0.12)",
              color: statusOk ? "#16a34a" : "#64748b",
            }}
          >
            {ad.effective_status || ad.status || "—"}
          </span>
```

- [ ] **Step 5: Manual verification**

Navigate to a creatives page. Verify:
- Each card now shows a "★ Review" pill button between the rank badge and status badge
- Clicking "★ Review" on a card with no session makes no network call (no session = route returns 401)
- When logged in: clicking "★ Review" shows a spinner on that card only
- Other cards remain unaffected while one card is reviewing
- "Review All" button disables per-card Review buttons while batch is running

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/meta/creatives/page.js
git commit -m "feat: add per-card Review button with single-mode image review"
```

---

### Task 4: Add review verdict footer strip to `LazyCreativeCard`

**Files:**
- Modify: `src/app/dashboard/meta/creatives/page.js`

The footer strip appears at the bottom of the card when `review` is non-null. Clicking it opens the modal.

- [ ] **Step 1: Add the footer strip helper**

Add this helper function near the bottom of the file, before `function MetricCell`:

```javascript
const VERDICT_COLORS = {
  APPROVED: { bg: "rgba(22,163,74,0.1)",  border: "#16a34a", text: "#15803d" },
  REVISE:   { bg: "rgba(217,119,6,0.1)",  border: "#d97706", text: "#b45309" },
  REJECT:   { bg: "rgba(220,38,38,0.1)",  border: "#dc2626", text: "#b91c1c" },
};

function ReviewFooterStrip({ review, onClick }) {
  const colors = VERDICT_COLORS[review.status] || VERDICT_COLORS.REVISE;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "10px 20px",
        background: colors.bg,
        borderTop: `2px solid ${colors.border}`,
        cursor: "pointer",
        textAlign: "left",
        border: "none",
        borderTop: `2px solid ${colors.border}`,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1,
          color: colors.text,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          padding: "2px 7px",
        }}>
          {review.status}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
          {review.overallScore}/100
        </span>
        <span style={{ fontSize: 11, color: "#64748b", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {review.summary}
        </span>
      </span>
      <span style={{ fontSize: 11, color: colors.text, fontWeight: 600, flexShrink: 0 }}>
        View full review →
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Render the footer strip inside `LazyCreativeCard`**

In `LazyCreativeCard`, the card's closing `</div>` is after the frequency line (after `<div className="px-5 pb-3 -mt-2 ...">...</div>`). Add the footer strip just before that closing `</div>`:

```jsx
      {review && (
        <ReviewFooterStrip review={review} onClick={onOpenReviewModal} />
      )}
```

So the end of the card JSX looks like:
```jsx
      <div className="px-5 pb-3 -mt-2 text-[10px] text-gray-400 font-medium">
        Frequency {fmtFreq(ins.frequency)} · {fmtCount(ins.impressions)} impressions
      </div>
      {review && (
        <ReviewFooterStrip review={review} onClick={onOpenReviewModal} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

With a reviewed ad (trigger a single review), verify:
- The footer strip appears below the frequency line
- APPROVED shows green tint, REVISE shows amber, REJECT shows red
- Summary text is truncated with ellipsis if long
- Clicking the strip calls `onOpenReviewModal` (currently no modal yet — console.log or verify the state is set in parent if you add a temporary log)

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/meta/creatives/page.js
git commit -m "feat: add review verdict footer strip to creative cards"
```

---

### Task 5: Add `ReviewModal` component and wire it up

**Files:**
- Modify: `src/app/dashboard/meta/creatives/page.js`

- [ ] **Step 1: Add the `ReviewModal` component**

Add this component near the bottom of the file, after `PreviewPlaceholder`:

```javascript
function ScoreBar({ label, score, max = 25 }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 50, fontSize: 12, fontWeight: 600, color: "#64748b" }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: "#e2e8f0", borderRadius: 99 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
      </div>
      <span style={{ width: 36, fontSize: 12, fontWeight: 700, color, textAlign: "right" }}>{score}/{max}</span>
    </div>
  );
}

function ReviewModal({ adId, ads, review, onClose }) {
  const ad = (ads || []).find((a) => a.id === adId);

  // Close on ESC
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!review) return null;

  const verdictColors = VERDICT_COLORS[review.status] || VERDICT_COLORS.REVISE;
  const imageUrl = ad?.creative?.image_url || null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        overflowY: "auto", padding: "40px 16px",
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 700,
          boxShadow: "0 25px 60px rgba(0,0,0,0.25)", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Ad Review</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1.3 }}>{ad?.name || adId}</p>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 22, color: "#94a3b8", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1, color: verdictColors.text,
              background: verdictColors.bg, border: `1px solid ${verdictColors.border}`,
              borderRadius: 6, padding: "3px 10px",
            }}>
              {review.status}
            </span>
            <span style={{ fontSize: 24, fontWeight: 900, color: verdictColors.text }}>{review.overallScore}<span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>/100</span></span>
            <span style={{ fontSize: 13, color: "#64748b", flex: 1 }}>{review.summary}</span>
          </div>
        </div>

        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Optional image */}
          {imageUrl && (
            <img src={imageUrl} alt="" style={{ width: "100%", maxHeight: 300, objectFit: "cover", borderRadius: 10 }} />
          )}

          {/* Score grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Scores</p>
            <ScoreBar label="Hook"   score={review.scores?.hook  ?? 0} />
            <ScoreBar label="Proof"  score={review.scores?.proof ?? 0} />
            <ScoreBar label="CTA"    score={review.scores?.cta   ?? 0} />
            <ScoreBar label="Visual" score={review.scores?.visual ?? 0} />
          </div>

          {/* Hook */}
          {review.hook && (
            <ReviewSection title="Hook">
              {review.hook.strengths?.length > 0 && <TagList label="Strengths" items={review.hook.strengths} color="#16a34a" />}
              {review.hook.issues?.length > 0 && <TagList label="Issues" items={review.hook.issues} color="#dc2626" />}
              {review.hook.recommendation && <Rec text={review.hook.recommendation} />}
            </ReviewSection>
          )}

          {/* Proof */}
          {review.proof && (
            <ReviewSection title="Proof">
              {review.proof.elements?.length > 0 && <TagList label="Present" items={review.proof.elements} color="#16a34a" />}
              {review.proof.missing?.length > 0 && <TagList label="Missing" items={review.proof.missing} color="#d97706" />}
              {review.proof.recommendation && <Rec text={review.proof.recommendation} />}
            </ReviewSection>
          )}

          {/* CTA */}
          {review.cta && (
            <ReviewSection title="CTA">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                {[["Placement", review.cta.placement], ["Clarity", review.cta.clarity], ["Urgency", review.cta.urgency]].map(([k, v]) => v && (
                  <span key={k} style={{ fontSize: 12, color: "#475569" }}><b>{k}:</b> {v}</span>
                ))}
              </div>
              {review.cta.recommendation && <Rec text={review.cta.recommendation} />}
            </ReviewSection>
          )}

          {/* Visual */}
          {review.visual && (
            <ReviewSection title="Visual / Authenticity">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                {review.visual.productionQuality && <span style={{ fontSize: 12, color: "#475569" }}><b>Quality:</b> {review.visual.productionQuality}</span>}
                {review.visual.authenticity && <span style={{ fontSize: 12, color: "#475569" }}><b>Authenticity:</b> {review.visual.authenticity}</span>}
              </div>
              {review.visual.issues?.length > 0 && <TagList label="Issues" items={review.visual.issues} color="#dc2626" />}
            </ReviewSection>
          )}

          {/* Platform fit */}
          {review.platformFit?.length > 0 && (
            <ReviewSection title="Platform Fit">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {review.platformFit.map((p) => (
                  <span key={p} style={{ fontSize: 11, fontWeight: 600, background: "#eff6ff", color: "#1d4ed8", borderRadius: 6, padding: "3px 10px" }}>{p}</span>
                ))}
              </div>
            </ReviewSection>
          )}

          {/* Action items */}
          {review.actionItems && (
            <ReviewSection title="Action Items">
              {review.actionItems.required?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Required</p>
                  {review.actionItems.required.map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 3 }}>
                      <span style={{ color: "#dc2626", fontSize: 14, lineHeight: 1.2 }}>•</span>
                      <span style={{ fontSize: 13, color: "#1e293b" }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {review.actionItems.recommended?.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Recommended</p>
                  {review.actionItems.recommended.map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 3 }}>
                      <span style={{ color: "#d97706", fontSize: 14, lineHeight: 1.2 }}>•</span>
                      <span style={{ fontSize: 13, color: "#1e293b" }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </ReviewSection>
          )}

          {/* Prediction */}
          {review.prediction && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f8fafc", borderRadius: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>Prediction:</span>
              <span style={{
                fontSize: 13, fontWeight: 800,
                color: review.prediction === "High potential" ? "#16a34a" : review.prediction === "Medium" ? "#d97706" : "#dc2626",
              }}>
                {review.prediction}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewSection({ title, children }) {
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>{title}</p>
      {children}
    </div>
  );
}

function TagList({ label, items, color }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}: </span>
      {items.map((item, i) => (
        <span key={i} style={{ fontSize: 12, color: "#475569", marginRight: 6 }}>{item}{i < items.length - 1 ? " ·" : ""}</span>
      ))}
    </div>
  );
}

function Rec({ text }) {
  return (
    <p style={{ fontSize: 12, color: "#475569", fontStyle: "italic", marginTop: 4 }}>→ {text}</p>
  );
}
```

- [ ] **Step 2: Render `ReviewModal` in `AllCreativesInner`**

At the very bottom of `AllCreativesInner`'s return statement, just before the outer closing `</div>`, add:

```jsx
      {reviewModal && reviews[reviewModal] && (
        <ReviewModal
          adId={reviewModal}
          ads={filtered}
          review={reviews[reviewModal]}
          onClose={() => setReviewModal(null)}
        />
      )}
```

So the end of `AllCreativesInner`'s return looks like:
```jsx
      </div>
      {reviewModal && reviews[reviewModal] && (
        <ReviewModal
          adId={reviewModal}
          ads={filtered}
          review={reviews[reviewModal]}
          onClose={() => setReviewModal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual end-to-end verification**

1. Navigate to `/dashboard/meta/creatives?accountId=<your_account_id>`
2. Click "★ Review" on a card — verify spinner shows, then footer strip appears with verdict color
3. Click the footer strip → verify review modal opens with:
   - Ad name in header
   - Status badge + overall score
   - Four score bars (Hook / Proof / CTA / Visual)
   - Sections for hook/proof/cta/visual/platformFit/actionItems/prediction
4. Press ESC → modal closes
5. Click backdrop → modal closes
6. Click "★ Review All" → verify progress label updates per chunk, footer strips appear progressively
7. After limit is reached → verify error message appears and already-reviewed cards keep their badges

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/meta/creatives/page.js
git commit -m "feat: add full ReviewModal with LeadsIcon rubric sections"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `/api/claude/ad-review` route with auth + daily limits — Task 1
- [x] `mode: "batch"` text-only, 10 ads per call — Tasks 1 + 2
- [x] `mode: "single"` with multimodal image_url — Tasks 1 + 3
- [x] `META_AD_REVIEW_DAILY_LIMIT` env var, `adReviewCount` in `UsageLimits` — Task 1
- [x] Review All button with progress label — Task 2
- [x] Per-card Review button, spinner while in-flight — Task 3
- [x] Review button disabled during batch — Task 3
- [x] Footer strip (APPROVED/REVISE/REJECT + score) — Task 4
- [x] Footer strip click opens modal — Tasks 4 + 5
- [x] Modal with all 9 sections — Task 5
- [x] ESC + backdrop close modal — Task 5
- [x] Image displayed in modal if available — Task 5
- [x] Daily limit error stops batch, existing reviews remain — Task 2
- [x] 500 ms gap between chunks — Task 2
- [x] No new Meta API calls (images passed as CDN URL to Claude) — Task 1
- [x] In-session only, no MongoDB persistence — correct (no save logic added)

**Type consistency:** `ad.id` used as key throughout. `reviewResult` object shape matches response (`adId`, `status`, `overallScore`, `scores`, `summary`, `hook`, `proof`, `cta`, `visual`, `platformFit`, `actionItems`, `prediction`). All consistent across Tasks 1–5.
