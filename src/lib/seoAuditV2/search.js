// Web search check for SEO Audit v2: one capped Claude call with the web search
// tool runs a handful of buyer queries and records who shows up. Results are a
// snapshot of what a search returned, never Google rankings or positions.

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from '../usageLogger';
import {
  AUDIT_MODEL, CALL_TIMEOUT_MS, FALLBACK, PassError, resolveApiKey, estimateCost, usageOf, isAbort,
} from './llm';
import { bareHost } from './options';

const MAX_BUYER_QUERIES = 6;
const MAX_QUERIES = 8;
const MAX_RESUMES = 2;
const MAX_TOKENS = 16000;
const GENERIC_WORDS = new Set([
  'electric', 'electrical', 'electrician', 'roofing', 'roofer', 'solar', 'plumbing', 'plumber', 'hvac', 'heating',
  'cooling', 'air', 'turf', 'landscaping', 'lawn', 'construction', 'contractors', 'contractor', 'services', 'service',
  'company', 'co', 'inc', 'llc', 'group', 'pros', 'home', 'homes', 'the', 'and',
]);

const wordsOf = (text) => String(text || '').toLowerCase().split(/\s+/)
  .map((t) => t.replace(/[^a-z0-9]/g, ''))
  .filter(Boolean);

const isServicePage = (p) => {
  let path = '';
  try { path = new URL(p.url).pathname.toLowerCase(); } catch { /* bad url: no path */ }
  return p.page_type !== 'homepage' && /\/[^?#]*service/.test(path);
};

// Words the site itself uses for what it sells: service-page H1s and service nav links.
function siteServiceWords(crawl) {
  const words = new Set();
  const pages = crawl?.pages_crawled || [];
  for (const p of pages) {
    if (isServicePage(p)) wordsOf(p.h1_tags?.[0]).forEach((w) => words.add(w));
  }
  const home = pages.find((p) => p.page_type === 'homepage');
  for (const link of home?.navigation_links || []) {
    if (/service/i.test(String(link?.href || link?.url || ''))) wordsOf(link?.text).forEach((w) => words.add(w));
  }
  return words;
}

// A query is "brand" only if it holds a distinctive brand word (not a trade word),
// or, when every brand word is generic, the whole brand phrase.
function brandMatcher(brand, crawl) {
  const generic = siteServiceWords(crawl);
  const distinctive = wordsOf(brand).filter((t) => t.length >= 3 && !GENERIC_WORDS.has(t) && !generic.has(t));
  if (distinctive.length) return (text) => distinctive.some((tok) => text.toLowerCase().includes(tok));
  const phrase = wordsOf(brand).join(' ');
  return (text) => !!phrase && wordsOf(text).join(' ').includes(phrase);
}

const withCity = (text, city) => (city && !text.toLowerCase().includes(city.toLowerCase()) ? `${text} ${city}` : text);

export function buildSearchQueries({ gscPages, crawl, brand, city } = {}) {
  const isBrandy = brandMatcher(brand, crawl);

  const impressions = new Map();
  for (const page of gscPages || []) {
    for (const row of page?.queries || []) {
      const text = String(row?.query || '').trim().toLowerCase();
      if (!text || isBrandy(text)) continue;
      impressions.set(text, (impressions.get(text) || 0) + (row.impressions || 0));
    }
  }
  const buyer = [...impressions.entries()].sort((a, b) => b[1] - a[1]).map(([text]) => withCity(text, city));

  if (buyer.length < 3) {
    for (const p of crawl?.pages_crawled || []) {
      if (p.page_type !== 'homepage' && !isServicePage(p)) continue;
      const h1 = String(p.h1_tags?.[0] || '').trim();
      if (h1 && !isBrandy(h1)) buyer.push(withCity(h1, city));
    }
  }

  const brandQueries = brand ? [`${brand} reviews`, brand] : [];
  const seen = new Set();
  return [...buyer.slice(0, MAX_BUYER_QUERIES), ...brandQueries]
    .filter((text) => { const k = text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_QUERIES);
}

function buildPrompt({ queries, brand, domain }) {
  return [
    `Business: ${brand} (${domain})`,
    '',
    'Run each of these queries exactly once with the web_search tool, in this order:',
    ...queries.map((text, i) => `${i + 1}. ${text}`),
    '',
    'Then write short notes for each query: whether the business or its website appears in the results,',
    'which competing businesses appear, which third-party sites (directories, lists, review sites) appear,',
    'and anything said about the business. These are internal notes for a later analysis.',
    'Describe what the results contain only; never describe them as Google rankings or positions.',
  ].join('\n');
}

const hostOf = (url) => {
  try { return bareHost(new URL(url).hostname); } catch { return ''; }
};

const normQuery = (text) => String(text || '').trim().toLowerCase();

function collect(blocks, queries, domain) {
  const queryByCall = new Map();
  for (const b of blocks) {
    if (b?.type === 'server_tool_use' && b.name === 'web_search') queryByCall.set(b.id, normQuery(b.input?.query));
  }
  // A slightly rewritten query still counts: pair leftover calls with leftover queries, in order.
  const wanted = queries.map(normQuery);
  const issued = new Set(queryByCall.values());
  const leftoverQueries = wanted.filter((q) => !issued.has(q));
  const leftoverCalls = [...queryByCall.entries()].filter(([, q]) => !wanted.includes(q)).map(([id]) => id);
  leftoverCalls.forEach((id, i) => { if (i < leftoverQueries.length) queryByCall.set(id, leftoverQueries[i]); });
  const found = new Map(); // normalized query -> { results } | { error }
  for (const b of blocks) {
    if (b?.type !== 'web_search_tool_result') continue;
    const key = queryByCall.get(b.tool_use_id);
    if (key == null || found.has(key)) continue;
    if (Array.isArray(b.content)) {
      const results = b.content.filter((r) => r?.type === 'web_search_result' && r.url)
        .map((r) => ({ title: r.title || '', url: r.url, host: hostOf(r.url) }));
      found.set(key, { results });
    } else {
      found.set(key, { error: b.content?.error_code || 'search_error' });
    }
  }
  const want = bareHost(domain || '');
  return queries.map((query) => {
    const hit = found.get(normQuery(query));
    if (!hit) return { query, you_appear: false, results: [], error: 'not searched' };
    if (hit.error) return { query, you_appear: false, results: [], error: hit.error };
    return { query, you_appear: !!want && hit.results.some((r) => r.host === want), results: hit.results };
  });
}

export async function runWebSearch({ queries, brand, domain, city, region, email } = {}) {
  const apiKey = await resolveApiKey();
  if (!apiKey) return { status: 'error', error: 'API key not configured', queries: [], notes: '' };
  const client = new Anthropic({ apiKey });

  const tool = { type: 'web_search_20260209', name: 'web_search', max_uses: queries.length + 2 };
  if (city) tool.user_location = { type: 'approximate', city, ...(region ? { region } : {}), country: 'US' };
  const userMessage = { role: 'user', content: buildPrompt({ queries, brand, domain }) };
  const base = {
    model: AUDIT_MODEL,
    max_tokens: MAX_TOKENS,
    tools: [tool],
    output_config: { effort: 'medium' },
  };

  // One deadline for the call and its resumes together.
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const blocks = [];
  const total = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: AUDIT_MODEL };
  let searches = 0;
  let stop = null;
  let messages = [userMessage];

  try {
    for (let attempt = 0; attempt <= MAX_RESUMES; attempt += 1) {
      const message = await client.beta.messages.stream({ ...base, messages, ...FALLBACK }, { signal }).finalMessage();
      blocks.push(...(message.content || []));
      const u = usageOf(message);
      total.model = u.model;
      for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) total[k] += u[k];
      searches += message.usage?.server_tool_use?.web_search_requests || 0;
      stop = message.stop_reason;
      if (stop !== 'pause_turn') break;
      messages = [userMessage, { role: 'assistant', content: [...blocks] }];
    }
  } catch (err) {
    if (isAbort(err, signal)) throw new PassError('timeout', 'The request timed out');
    return { status: 'error', error: err?.message || String(err), queries: [], notes: '' };
  } finally {
    const input = total.input_tokens + total.cache_read_input_tokens + total.cache_creation_input_tokens;
    if (input || total.output_tokens) {
      logApiUsage({
        type: 'claude_tokens',
        email,
        model: total.model,
        feature: 'seo_audit_v2',
        label: 'search',
        webSearchRequests: searches,
        inputTokens: input,
        outputTokens: total.output_tokens,
        cacheReadTokens: total.cache_read_input_tokens,
        cacheWriteTokens: total.cache_creation_input_tokens,
        totalTokens: input + total.output_tokens,
        estimatedCostUsd: estimateCost(total),
      })?.catch?.(() => {});
    }
  }

  if (stop === 'refusal') return { status: 'error', error: 'Declined', queries: [], notes: '' };

  const mapped = collect(blocks, queries, domain);
  const notes = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('').trim();
  if (mapped.every((x) => x.error)) {
    return { status: 'error', error: mapped[0]?.error || 'No searches completed', queries: mapped, notes };
  }
  return { status: 'ok', queries: mapped, notes };
}
