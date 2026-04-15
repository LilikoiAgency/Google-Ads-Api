# Google Ads Account Favorites Design
**Date:** 2026-04-15
**Files affected:** `src/app/dashboard/google/ads/page.js`, new API route, new MongoDB collection

---

## Overview

Add a star-based account pinning system to the Google Ads dashboard. Admins pin the active accounts once; all users see the same ordered view with pinned accounts at the top and unused accounts collapsed into a "Show more" accordion.

---

## Data

**MongoDB:** `tokensApi` database, `GoogleAdsPreferences` collection.

Single document (upserted, not versioned):
```js
{
  pinnedAccountIds: ["1234567890", "9876543210"],  // ordered by pin time, oldest first
  updatedAt: ISODate,
  updatedBy: "frank@lilikoiagency.com"
}
```

- `pinnedAccountIds` is an ordered array. New pins are appended to the end.
- Only one document exists in this collection (no per-user documents).

---

## API

### `GET /api/googleads/preferences`
- Auth: any `@lilikoiagency.com` user
- Returns `{ data: { pinnedAccountIds: string[] }, requestId }`
- Returns `{ data: { pinnedAccountIds: [] }, requestId }` if no document exists yet

### `POST /api/googleads/preferences`
- Auth: admin only (`ADMIN_EMAILS` check)
- Body: `{ accountId: string }`
- Behavior: toggles — if `accountId` is in the list, removes it; if not, appends it
- Returns `{ data: { pinnedAccountIds: string[] }, requestId }`
- Non-admins get `403`

Both routes include `requestId` via `crypto.randomUUID()` and Zod body validation on POST.

---

## Frontend

### Data fetching
The dashboard fetches preferences in parallel with campaign data on mount:
```js
const [campaignData, preferences] = await Promise.all([
  fetch('/api/googleads?...'),
  fetch('/api/googleads/preferences'),
]);
```

`pinnedAccountIds` is stored in React state. The account list is sorted on every render:
```js
// pinned first (in pin order), then unpinned alphabetically
const sorted = [
  ...pinned,   // accounts whose id is in pinnedAccountIds, in pin order
  ...unpinned, // remaining accounts, sorted alphabetically by name
];
```

### Account Picker (full-screen modal)
- Pinned accounts render at top with a filled ⭐ button
- Unpinned accounts are hidden behind **"Show X more accounts ▾"** toggle (accordion)
- Accordion is closed by default
- Admins see a hollow ☆ on each unpinned account row to pin it
- Non-admins see no star at all

### Account Dropdown (header)
- Same split: pinned accounts listed first, then a "Show X more ▾" toggle
- Admin star visible inline on each row
- Dropdown closes after account selection (existing behavior preserved)

### Star interaction
1. Admin clicks ⭐ or ☆
2. Optimistic update: immediately flip the star state and re-sort the list in local state
3. POST to `/api/googleads/preferences`
4. On success: update state with server-confirmed `pinnedAccountIds`
5. On failure: revert local state and show a brief error toast

---

## Visibility rules

| User type | Sees stars | Can toggle stars | Sees accordion |
|-----------|-----------|-----------------|----------------|
| Admin | ✓ (filled on pinned, hollow on unpinned) | ✓ | ✓ |
| Regular user | ✗ | ✗ | ✓ (can open it) |

---

## Out of scope
- Drag-to-reorder pinned accounts (pins are ordered by time, not manually sortable)
- Per-user preferences (one shared list for all users)
- Hiding accounts permanently (unpinned accounts always accessible via accordion)
