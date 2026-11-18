// Shared channel buckets, views and definitions for GA4 web traffic reports.
// Pure ESM, no imports: used by the page, the API and the download.

export const BUCKETS = {
  organic: ['Organic Search'],
  otherNonPaid: [
    'Direct', 'Referral', 'Organic Social', 'Organic Video', 'Organic Shopping',
    'Email', 'AI Assistant', 'SMS', 'Mobile Push Notifications',
  ],
  paid: [
    'Paid Search', 'Paid Social', 'Paid Video', 'Paid Shopping', 'Paid Other',
    'Display', 'Cross-network', 'Audio', 'Affiliates',
  ],
};

export const VIEWS = [
  { key: 'organic', label: 'Organic search', buckets: ['organic'] },
  { key: 'nonPaid', label: 'All non-paid', buckets: ['organic', 'otherNonPaid'] },
  { key: 'paid', label: 'Paid', buckets: ['paid'] },
  { key: 'all', label: 'Everything', buckets: ['organic', 'otherNonPaid', 'paid', 'unassigned'] },
];

// Any channel not in the table (including "Unassigned") is 'unassigned'.
export function bucketFor(channel) {
  for (const [bucket, channels] of Object.entries(BUCKETS)) {
    if (channels.includes(channel)) return bucket;
  }
  return 'unassigned';
}

// Known channel names for a view; null for 'all' (no filter).
export function channelsForView(viewKey) {
  if (viewKey === 'all') return null;
  const view = VIEWS.find((v) => v.key === viewKey);
  if (!view) return null;
  return view.buckets.flatMap((b) => BUCKETS[b] || []);
}

export function inView(channel, viewKey) {
  const view = VIEWS.find((v) => v.key === viewKey);
  if (!view) return false;
  return view.buckets.includes(bucketFor(channel));
}

export const CHANNEL_DEFINITIONS = [
  { name: 'Organic Search', text: 'Visitors who clicked an unpaid result on Google, Bing or another search engine.' },
  { name: 'Direct', text: "Visitors who typed the web address, used a bookmark, or came from a link Google Analytics couldn't trace, such as one in a text message or app." },
  { name: 'Referral', text: 'Visitors who clicked a link to the site from another website.' },
  { name: 'Organic Social', text: 'Visitors who clicked an unpaid post or profile link on Facebook, Instagram, TikTok or another social platform.' },
  { name: 'Organic Shopping / Organic Video / Email / AI Assistant', text: 'Free shopping listings, unpaid video such as YouTube, email links, and AI tools like ChatGPT.' },
  { name: 'Paid Search', text: 'Visitors who clicked a search ad, e.g. Google or Microsoft Ads.' },
  { name: 'Paid Social', text: 'Visitors who clicked a paid ad on Facebook, Instagram, TikTok, etc.' },
  { name: 'Paid Video / Display / Cross-network / Paid Other', text: 'Visitors who clicked other paid ads, including Performance Max for Cross-network.' },
  { name: 'Unassigned', text: "Visits GA couldn't put in any channel, usually from links with incomplete tracking tags." },
];

const PAID_SOURCE = /facebook|instagram|\bfb\b|\big\b|meta|tiktok|linkedin/i;
const PAID_MEDIUM = /cpc|ppc|paid|ads|cpm/i;
const PAID_MEDIUM_EXACT = /^(cpc|ppc|paid)$/i;

// sourceMedium is GA's "source / medium". Flags traffic outside the paid
// bucket that looks like untagged paid. Always false for the paid bucket.
export function isSuspectedPaid(sourceMedium, bucket) {
  if (bucket === 'paid') return false;
  const [source = '', medium = ''] = String(sourceMedium || '').split('/').map((s) => s.trim());
  if (PAID_SOURCE.test(source) && PAID_MEDIUM.test(medium)) return true;
  return PAID_MEDIUM_EXACT.test(medium);
}

export const CHANNEL_COLORS = {
  'Organic Search': '#2f7d32',
  'Direct': '#3d6f8f',
  'Referral': '#c9a227',
  'Organic Social': '#7fb069',
  'Organic Video': '#8c6bb1',
  'Organic Shopping': '#d98c5f',
  'Email': '#2a9d8f',
  'AI Assistant': '#6c5b7b',
  'SMS': '#5c7a99',
  'Mobile Push Notifications': '#9a8c5a',
  'Paid Search': '#c0392b',
  'Paid Social': '#e07a8f',
  'Paid Video': '#a4343a',
  'Paid Shopping': '#e0a458',
  'Paid Other': '#8e4a49',
  'Display': '#d1603d',
  'Cross-network': '#b5475b',
  'Audio': '#7d3c6e',
  'Affiliates': '#b08968',
  'Unassigned': '#a7b3a9',
  fallback: '#a7b3a9',
};
