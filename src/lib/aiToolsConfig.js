// src/lib/aiToolsConfig.js
export const AI_TOOLS = [
  { key: 'brief',      label: 'Account Brief',   icon: '📋', routes: ['/dashboard/google/ads'] },
  { key: 'audit',      label: 'Ads Audit',        icon: '🔍', routes: ['/dashboard/google/ads'] },
  { key: 'ad-copy',    label: 'Ad Copy Strategy', icon: '✏️', routes: ['/dashboard/google/ads'] },
  { key: 'meta-copy',  label: 'Meta Ad Copy',     icon: '✏️', routes: ['/dashboard/meta'] },
  { key: 'seo-meta',   label: 'SEO Meta',         icon: '📝', routes: ['*'] },
];

export function getToolsForRoute(pathname) {
  if (!pathname) return AI_TOOLS.filter((t) => t.routes.includes('*'));
  return AI_TOOLS.filter(
    (t) => t.routes.includes('*') || t.routes.some((r) => pathname === r || pathname.startsWith(r + '/'))
  );
}
