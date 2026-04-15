# Dashboard Redesign Design
**Date:** 2026-04-15
**File:** `src/app/dashboard/page.js`

---

## Overview

Redesign the internal dashboard hub (`/dashboard`) from its current white-card-on-dark-purple layout to a glassmorphism style with a radial gradient background, bigger tiles, and a persistent iOS-style dark/light mode toggle.

---

## Visual Direction

### Background
Replace the flat `bg-customPurple-dark` with a radial gradient:
```css
background: radial-gradient(ellipse at 25% 15%, #3b1278 0%, #1e0a38 45%, #0d0520 100%);
```
Two fixed ambient orbs (blurred radial blobs) sit behind the content to create depth — one top-left in purple, one bottom-right in indigo.

### Glass Tiles (dark mode)
- Background: `rgba(255,255,255,0.06)` with `backdrop-filter: blur(18px)`
- Border: `1px solid rgba(255,255,255,0.12)`
- Top shine: 1px linear-gradient highlight across the top edge
- Hover: lifts `-5px`, slight scale, brighter background, colored glow matching category color (`box-shadow` with `rgba(var(--c), 0.13)`)

### Glass Tiles (light mode)
- Background: `rgba(255,255,255,0.68)` with `backdrop-filter: blur(18px)`
- Border: `1px solid rgba(139,92,246,0.15)`
- Background gradient: `radial-gradient(ellipse at 25% 10%, #ede9fe 0%, #f5f3ff 40%, #faf5ff 70%, #ffffff 100%)`
- Hover: brighter white, category-colored shadow

---

## Dark / Light Mode Toggle

### Mechanism
- CSS custom properties (variables) scoped to `[data-theme="dark"]` and `[data-theme="light"]` on `<html>`
- `localStorage` key `lik-theme` persists the user's preference across sessions
- Default: `dark`

### Toggle UI (iOS-style)
Placed in the header, left of the user pill:
- Track: 56×30px pill, color shifts from `#3a3a5c` (dark) to `#a78bfa` (light)
- Thumb: 24×24px white circle with drop shadow, slides from left (dark) to right (light) with `cubic-bezier(0.34, 1.56, 0.64, 1)` (Apple spring)
- Emoji inside thumb: 🌙 in dark mode, ☀️ in light mode
- Labels: "Dark" / "Light" text on either side in `--toggle-label` color

---

## Tile Sizing (increased from current)

| Property | Before | After |
|----------|--------|-------|
| Padding | `p-5` (20px) | 28px |
| Border radius | `rounded-xl` (12px) | 22px |
| Icon box | 48×48px | 56×56px |
| Icon box radius | — | 16px |
| Title font | `text-base` (16px) | 17px, weight 700 |
| Description font | `text-xs` (12px) | 13.5px |
| Min height | none | 200px |
| Grid gap | `gap-4` (16px) | 18px |

---

## Header

### Dark mode
- Sticky, `rgba(14,5,32,0.65)` with `backdrop-filter: blur(28px)`
- Border-bottom: `rgba(255,255,255,0.08)`
- Brand name and avatar unchanged in position; text colors adapt via CSS vars

### Light mode
- `rgba(255,255,255,0.72)` with blur
- Border-bottom: `rgba(139,92,246,0.12)`
- Brand name renders dark (`#1e0a38`)

---

## Hero Section

- Heading: 42px, weight 800, letter-spacing -1px
- Gradient text: white→lavender in dark; dark purple→violet in light
- Subtitle: 17px, muted color via `--hero-sub`

---

## Category Color System

Each tile carries a `--c` CSS variable (RGB triplet) for its category color. Used for:
- Icon box background tint + glow
- Tag badge background + border + text
- Hover shadow glow (dark mode only)

| Category | Color |
|----------|-------|
| Paid (Google) | `168,85,247` (purple) |
| Meta Ads | `24,119,242` (Meta blue) |
| Microsoft | `0,120,212` (MS blue) |
| Organic | `34,197,94` (green) |
| Report | `245,158,11` (amber) |
| AI Audit | `13,148,136` (teal) |
| Portals | `109,40,217` (violet) |
| Segments | `168,85,247` (purple) |
| Streaming | `14,165,233` (sky blue) |
| Admin | `236,72,153` (pink) |

---

## Implementation Notes

- All styles will be written as **inline styles** (no new Tailwind classes needed) — the page already uses a mix; keeping it inline avoids config changes.
- `localStorage` read happens on mount via `useEffect` to avoid SSR mismatch.
- The `signOut` button styling adapts to theme via CSS vars.
- No changes to tile data (`SECTIONS` array), icons, routes, or auth logic — visual only.
- The Admin section (shown only to admins) gets the same treatment automatically.

---

## Out of Scope

- Changing tile content, descriptions, or routes
- Responsive/mobile layout changes beyond what already exists
- Animating sections or adding loading skeletons
