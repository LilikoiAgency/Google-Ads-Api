# Google Ads Account Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins star Google Ads accounts so pinned ones appear first for all users, with unpinned accounts collapsed in a "Show more" accordion.

**Architecture:** A new `/api/googleads/preferences` route reads/writes a single MongoDB document in `GoogleAdsPreferences`. The dashboard fetches preferences on load, uses a `sortWithPinned` helper to split the account list, and renders star icons (admin-only) with optimistic toggle. Non-admin users see the sorted list and accordion but no stars.

**Tech Stack:** Next.js 14 App Router, MongoDB, Zod, React state, Tailwind CSS

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/app/api/googleads/preferences/route.js` | GET + POST preferences API |
| Create | `src/__tests__/api/googleads/preferences.test.js` | Zod schema tests |
| Modify | `src/lib/googleAdsHelpers.js` | Add `sortWithPinned` helper |
| Modify | `src/__tests__/lib/googleAdsHelpers.test.js` | Add `sortWithPinned` tests |
| Modify | `src/app/dashboard/google/ads/page.js` | UI changes — state, fetch, components |

---

## Task 1: Add sortWithPinned to googleAdsHelpers

**Files:**
- Modify: `src/lib/googleAdsHelpers.js`
- Modify: `src/__tests__/lib/googleAdsHelpers.test.js`

- [ ] **Step 1: Add the failing tests**

Open `src/__tests__/lib/googleAdsHelpers.test.js` and add these tests at the bottom (inside the existing file, after existing tests):

```js
import { sortWithPinned } from '@/lib/googleAdsHelpers.js';

describe('sortWithPinned', () => {
  const accounts = [
    { id: '1', name: 'Zebra Co' },
    { id: '2', name: 'Alpha Inc' },
    { id: '3', name: 'Middle LLC' },
  ];

  it('returns pinned accounts in pin order', () => {
    const { pinned } = sortWithPinned(accounts, ['3', '1']);
    expect(pinned.map((a) => a.id)).toEqual(['3', '1']);
  });

  it('returns unpinned accounts sorted alphabetically', () => {
    const { unpinned } = sortWithPinned(accounts, ['3']);
    expect(unpinned.map((a) => a.name)).toEqual(['Alpha Inc', 'Zebra Co']);
  });

  it('returns all accounts as unpinned when pinnedIds is empty', () => {
    const { pinned, unpinned } = sortWithPinned(accounts, []);
    expect(pinned).toHaveLength(0);
    expect(unpinned.map((a) => a.name)).toEqual(['Alpha Inc', 'Middle LLC', 'Zebra Co']);
  });

  it('silently skips pinnedIds not present in accounts', () => {
    const { pinned } = sortWithPinned(accounts, ['999', '1']);
    expect(pinned.map((a) => a.id)).toEqual(['1']);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- googleAdsHelpers 2>&1 | tail -15
```
Expected: FAIL — `sortWithPinned` is not exported.

- [ ] **Step 3: Add sortWithPinned to src/lib/googleAdsHelpers.js**

Append this function to the end of the file:

```js
/**
 * Splits an account list into pinned (in pin order) and unpinned (alphabetical).
 * @param {Array<{id: string, name: string}>} accounts
 * @param {string[]} pinnedIds - ordered array of pinned account IDs
 * @returns {{ pinned: Array, unpinned: Array }}
 */
export function sortWithPinned(accounts, pinnedIds) {
  const pinnedSet = new Set(pinnedIds);
  const pinned = pinnedIds
    .map((id) => accounts.find((a) => a.id === id))
    .filter(Boolean);
  const unpinned = accounts
    .filter((a) => !pinnedSet.has(a.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { pinned, unpinned };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- googleAdsHelpers 2>&1 | tail -15
```
Expected: PASS — all tests green.

- [ ] **Step 5: Run full suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/googleAdsHelpers.js src/__tests__/lib/googleAdsHelpers.test.js
git commit -m "feat: add sortWithPinned helper to googleAdsHelpers"
```

---

## Task 2: Preferences API Route

**Files:**
- Create: `src/app/api/googleads/preferences/route.js`
- Create: `src/__tests__/api/googleads/preferences.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/api/googleads/preferences.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: { json: vi.fn((body, init) => ({ body, init })) },
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/admins', () => ({
  isAdmin: vi.fn((email) => email === 'frank@lilikoiagency.com'),
}));

const { preferencesPostSchema } = await import('@/app/api/googleads/preferences/route.js');

describe('preferencesPostSchema', () => {
  it('accepts a valid accountId string', () => {
    expect(preferencesPostSchema.safeParse({ accountId: '1234567890' }).success).toBe(true);
  });

  it('rejects an empty string accountId', () => {
    expect(preferencesPostSchema.safeParse({ accountId: '' }).success).toBe(false);
  });

  it('rejects a missing accountId', () => {
    expect(preferencesPostSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a numeric accountId', () => {
    expect(preferencesPostSchema.safeParse({ accountId: 12345 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- preferences 2>&1 | tail -15
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the preferences route**

Create `src/app/api/googleads/preferences/route.js`:

```js
// src/app/api/googleads/preferences/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../lib/auth';
import { isAdmin } from '../../../lib/admins';
import dbConnect from '../../../lib/mongoose';

const DB = 'tokensApi';
const COLLECTION = 'GoogleAdsPreferences';

export const preferencesPostSchema = z.object({
  accountId: z.string().min(1),
});

export async function GET() {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  const client = await dbConnect();
  const doc = await client.db(DB).collection(COLLECTION).findOne({});

  return NextResponse.json({
    data: { pinnedAccountIds: doc?.pinnedAccountIds ?? [] },
    requestId,
  });
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';

  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Forbidden — admin only', requestId }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 });
  }

  const parsed = preferencesPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, requestId },
      { status: 400 }
    );
  }

  const { accountId } = parsed.data;
  const client = await dbConnect();
  const col = client.db(DB).collection(COLLECTION);
  const existing = await col.findOne({});
  const current = existing?.pinnedAccountIds ?? [];

  const next = current.includes(accountId)
    ? current.filter((id) => id !== accountId)   // unpin
    : [...current, accountId];                    // pin

  await col.updateOne(
    {},
    { $set: { pinnedAccountIds: next, updatedAt: new Date(), updatedBy: email } },
    { upsert: true }
  );

  return NextResponse.json({ data: { pinnedAccountIds: next }, requestId });
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- preferences 2>&1 | tail -15
```
Expected: PASS — 4/4 tests green.

- [ ] **Step 5: Run full suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/googleads/preferences/route.js src/__tests__/api/googleads/preferences.test.js
git commit -m "feat: add GET/POST /api/googleads/preferences for account pinning"
```

---

## Task 3: Update Google Ads Dashboard UI

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

This task makes 6 targeted changes to the file. Read the file before each edit.

### Change 1: Update imports and useSession destructure

- [ ] **Step 1: Add new imports**

At the top of the file, the current imports are:
```js
"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import "../../../globals.css";
import ContentArea from "../../components/ContentArea";
```

Replace with:
```js
"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import "../../../globals.css";
import ContentArea from "../../components/ContentArea";
import { isAdmin } from "../../../lib/admins";
import { sortWithPinned } from "../../../lib/googleAdsHelpers";
```

- [ ] **Step 2: Update useSession destructure in GoogleAdsDashboard**

Find this line inside `GoogleAdsDashboard` (around line 292):
```js
  const { status } = useSession();
```
Replace with:
```js
  const { data: session, status } = useSession();
```

- [ ] **Step 3: Add new state variables**

After the existing state declarations (after `const [showPicker, setShowPicker] = useState(null);` block), add:
```js
  const [pinnedAccountIds, setPinnedAccountIds] = useState([]);
  const [pickerShowAll, setPickerShowAll]       = useState(false);
```

- [ ] **Step 4: Add isAdminUser derived value**

Immediately after the new state declarations, add:
```js
  const isAdminUser = isAdmin(session?.user?.email || '');
```

### Change 2: Fetch preferences alongside accounts

- [ ] **Step 5: Update the picker useEffect to fetch preferences**

Find the picker useEffect (starts with `useEffect(() => {` and contains `sessionStorage.getItem("gads_customer_id")`). Replace the entire useEffect with:

```js
  useEffect(() => {
    if (status !== "authenticated") return;
    const savedId = sessionStorage.getItem("gads_customer_id");

    // Always fetch preferences (needed for both picker and dropdown)
    fetch("/api/googleads/preferences")
      .then((r) => r.json())
      .then((d) => setPinnedAccountIds(d?.data?.pinnedAccountIds ?? []))
      .catch(() => {});

    if (savedId) {
      setShowPicker(false);
    } else {
      setShowPicker(true);
      setPickerLoading(true);
      const cached = sessionStorage.getItem("gads_customers_list");
      if (cached) {
        try { setPickerCustomers(JSON.parse(cached)); } catch {}
        setPickerLoading(false);
      } else {
        fetch("/api/customers")
          .then((r) => r.json())
          .then((d) => {
            const list = d.customers || [];
            setPickerCustomers(list);
            sessionStorage.setItem("gads_customers_list", JSON.stringify(list));
          })
          .catch(() => setPickerCustomers([]))
          .finally(() => setPickerLoading(false));
      }
    }
  }, [status]);
```

Note: `prioritySort` is removed from the customer list here — `sortWithPinned` now handles ordering.

### Change 3: Add handleTogglePin

- [ ] **Step 6: Add the toggle handler**

After the `refreshData` function (around line 473), add:

```js
  const handleTogglePin = async (accountId) => {
    // Optimistic update
    const optimistic = pinnedAccountIds.includes(accountId)
      ? pinnedAccountIds.filter((id) => id !== accountId)
      : [...pinnedAccountIds, accountId];
    setPinnedAccountIds(optimistic);

    try {
      const res = await fetch("/api/googleads/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) throw new Error("Failed to update pin");
      const { data } = await res.json();
      setPinnedAccountIds(data.pinnedAccountIds);
    } catch {
      // Revert on error
      setPinnedAccountIds(pinnedAccountIds);
    }
  };
```

### Change 4: Update AccountDropdown component

- [ ] **Step 7: Replace the AccountDropdown function**

Find the entire `AccountDropdown` function (lines 126–175) and replace it with:

```js
function AccountDropdown({ accounts, selectedId, onChange, pinnedAccountIds, isAdminUser, onTogglePin }) {
  const [open, setOpen]       = useState(false);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setShowAll(false); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = accounts.find((a) => a.id === selectedId);
  const { pinned, unpinned } = sortWithPinned(accounts, pinnedAccountIds);

  const StarButton = ({ accountId, isPinned }) =>
    isAdminUser ? (
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(accountId); }}
        title={isPinned ? "Unpin account" : "Pin account"}
        className="ml-2 text-base leading-none flex-shrink-0 hover:scale-110 transition-transform"
      >
        {isPinned ? "⭐" : "☆"}
      </button>
    ) : null;

  const AccountRow = ({ a, isPinned }) => (
    <button
      key={a.id}
      onClick={() => { onChange(a.id); setOpen(false); }}
      className={`flex items-center justify-between w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
        a.id === selectedId ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{a.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">ID: {a.id}</p>
      </div>
      <div className="flex items-center ml-3 flex-shrink-0">
        <StarButton accountId={a.id} isPinned={isPinned} />
        {a.id === selectedId && (
          <svg className="w-4 h-4 text-purple-600 ml-2" fill="none" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[180px]"
      >
        <span className="flex-1 text-left truncate font-medium">{current?.name || "Select account"}</span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[240px] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          {/* Pinned accounts */}
          {pinned.map((a) => <AccountRow key={a.id} a={a} isPinned />)}

          {/* Divider + show-more toggle */}
          {unpinned.length > 0 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
                className="w-full px-4 py-2 text-xs text-gray-400 text-left hover:bg-gray-50 border-t border-gray-100 flex items-center gap-1"
              >
                {showAll ? "▲ Show less" : `▾ ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
              </button>
              {showAll && unpinned.map((a) => <AccountRow key={a.id} a={a} isPinned={false} />)}
            </>
          )}

          {/* Empty state */}
          {pinned.length === 0 && unpinned.length === 0 && (
            <p className="px-4 py-4 text-sm text-gray-400 text-center">No accounts found.</p>
          )}
        </div>
      )}
    </div>
  );
}
```

### Change 5: Update AccountDropdown usage to pass new props

- [ ] **Step 8: Update the AccountDropdown call site**

Find the `<AccountDropdown` usage in the JSX (around line 623). It currently looks like:
```jsx
              <AccountDropdown
                accounts={allCampaignData.map((d) => ({
                  id: String(d.customer.customer_client.id),
                  name: d.customer.customer_client.descriptive_name,
                }))}
                selectedId={String(selectedCustomerId)}
                onChange={(id) => {
                  localStorage.setItem(SELECTED_CUSTOMER_KEY, id);
                  sessionStorage.setItem("gads_customer_id", id);
                  setSelectedCustomerId(id);
                  setSelectedCampaign(null);
                }}
              />
```

Replace with:
```jsx
              <AccountDropdown
                accounts={allCampaignData.map((d) => ({
                  id: String(d.customer.customer_client.id),
                  name: d.customer.customer_client.descriptive_name,
                }))}
                selectedId={String(selectedCustomerId)}
                onChange={(id) => {
                  localStorage.setItem(SELECTED_CUSTOMER_KEY, id);
                  sessionStorage.setItem("gads_customer_id", id);
                  setSelectedCustomerId(id);
                  setSelectedCampaign(null);
                }}
                pinnedAccountIds={pinnedAccountIds}
                isAdminUser={isAdminUser}
                onTogglePin={handleTogglePin}
              />
```

### Change 6: Update the account picker screen

- [ ] **Step 9: Replace the picker account list JSX**

Find the picker's account list section (inside `if (showPicker === true)`). The current list starts at `<div className="space-y-2">` and maps `pickerCustomers`. Replace that entire section (from `<div className="space-y-2">` through its closing `</div>`) with:

```jsx
            {(() => {
              const { pinned, unpinned } = sortWithPinned(pickerCustomers, pinnedAccountIds);

              const PickerRow = ({ c, isPinned }) => (
                <div key={c.id} className="relative group">
                  <button
                    onClick={() => {
                      sessionStorage.setItem("gads_customer_id", c.id);
                      localStorage.setItem(SELECTED_CUSTOMER_KEY, c.id);
                      setShowPicker(false);
                    }}
                    className="w-full flex items-center gap-4 rounded-2xl bg-white/10 border border-white/10 px-5 py-4 hover:bg-white/20 hover:border-white/20 transition text-left"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 flex-shrink-0">
                      <svg viewBox="0 0 48 48" className="w-5 h-5"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">ID: {c.id}</p>
                    </div>
                    {isPinned && <span className="text-base flex-shrink-0">⭐</span>}
                    {!isPinned && <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>

                  {/* Admin star toggle — positioned top-right of the card */}
                  {isAdminUser && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTogglePin(c.id); }}
                      title={isPinned ? "Unpin account" : "Pin account"}
                      className="absolute top-3 right-3 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity"
                    >
                      {isPinned ? "⭐" : "☆"}
                    </button>
                  )}
                </div>
              );

              return (
                <div className="space-y-2">
                  {pinned.map((c) => <PickerRow key={c.id} c={c} isPinned />)}

                  {unpinned.length > 0 && (
                    <>
                      <button
                        onClick={() => setPickerShowAll((v) => !v)}
                        className="w-full text-center text-sm text-gray-400 hover:text-gray-300 py-2 transition"
                      >
                        {pickerShowAll
                          ? "▲ Show less"
                          : `▾ Show ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
                      </button>
                      {pickerShowAll && unpinned.map((c) => <PickerRow key={c.id} c={c} isPinned={false} />)}
                    </>
                  )}

                  {pinned.length === 0 && unpinned.length === 0 && (
                    <div className="rounded-2xl bg-white/10 p-8 text-center text-gray-400 text-sm">No accounts found.</div>
                  )}
                </div>
              );
            })()}
```

- [ ] **Step 10: Run the full test suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -10
```
Expected: all tests green.

- [ ] **Step 11: Build check**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm run build 2>&1 | tail -15
```
Expected: build succeeds with no errors.

- [ ] **Step 12: Commit**

```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: account pinning — star icons for admin, pinned accounts first, accordion for rest"
```
