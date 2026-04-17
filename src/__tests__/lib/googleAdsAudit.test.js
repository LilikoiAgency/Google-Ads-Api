import { describe, it, expect } from 'vitest';
import {
  fmtCurrency,
  fmtPct,
  fmtCvr,
  getCampaignVerdict,
  analyzeSearchTerms,
  analyzeStructure,
  computeLRRatio,
  analyzeKeywords,
  analyzeAdStrength,
  analyzePMax,
  analyzeBidding,
  analyzeAssets,
  buildActionPlan,
  runAudit,
} from '../../lib/googleAdsAudit.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MICROS = 1_000_000;

function makeCampaign(overrides = {}) {
  return {
    campaignId: '111',
    campaignName: 'Test Campaign',
    cost: 500 * MICROS,
    clicks: 200,
    conversions: 10,
    impressions: 5000,
    channelType: 'SEARCH',
    searchBudgetLostImpressionShare: 0.1,
    searchRankLostImpressionShare: 0.05,
    searchTerms: [],
    ...overrides,
  };
}

function makeKeyword(overrides = {}) {
  return {
    text: 'test keyword',
    matchType: 'BROAD',
    status: 'ENABLED',
    qualityScore: 7,
    expectedCtr: 'ABOVE_AVERAGE',
    adRelevance: 'AVERAGE',
    lpExperience: 'ABOVE_AVERAGE',
    campaignId: '111',
    campaignName: 'Test Campaign',
    adGroupId: '222',
    adGroupName: 'Test Ad Group',
    impressions: 1000,
    clicks: 50,
    cost: 100 * MICROS,
    conversions: 5,
    ...overrides,
  };
}

function makeSearchTerm(overrides = {}) {
  return {
    term: 'test search term',
    clicks: 10,
    conversions: 1,
    cost: 20 * MICROS,
    ...overrides,
  };
}

// ── fmtCurrency ───────────────────────────────────────────────────────────────

describe('fmtCurrency', () => {
  it('formats micros under $1000 as dollars', () => {
    expect(fmtCurrency(500 * MICROS)).toBe('$500');
  });
  it('formats micros over $1000 as k', () => {
    expect(fmtCurrency(1500 * MICROS)).toBe('$1.5k');
  });
  it('handles zero', () => {
    expect(fmtCurrency(0)).toBe('$0');
  });
  it('handles null/undefined gracefully', () => {
    expect(fmtCurrency(null)).toBe('$0');
    expect(fmtCurrency(undefined)).toBe('$0');
  });
});

// ── fmtPct ────────────────────────────────────────────────────────────────────

describe('fmtPct', () => {
  it('formats ratio as percentage', () => {
    expect(fmtPct(0.25)).toBe('25%');
    expect(fmtPct(1)).toBe('100%');
  });
  it('returns em dash for null', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });
});

// ── fmtCvr ────────────────────────────────────────────────────────────────────

describe('fmtCvr', () => {
  it('computes conversion rate', () => {
    expect(fmtCvr(100, 5)).toBe('5.0%');
  });
  it('returns em dash when no clicks', () => {
    expect(fmtCvr(0, 5)).toBe('—');
  });
});

// ── getCampaignVerdict ────────────────────────────────────────────────────────

describe('getCampaignVerdict', () => {
  it('returns SCALE when profitable and budget constrained', () => {
    const v = getCampaignVerdict(makeCampaign({ conversions: 5, searchBudgetLostImpressionShare: 0.3 }));
    expect(v.key).toBe('SCALE');
  });

  it('returns PAUSE when high spend and zero conversions', () => {
    const v = getCampaignVerdict(makeCampaign({ conversions: 0, cost: 400 * MICROS }));
    expect(v.key).toBe('PAUSE');
  });

  it('does NOT pause if spend is under $300', () => {
    const v = getCampaignVerdict(makeCampaign({ conversions: 0, cost: 100 * MICROS }));
    expect(v.key).not.toBe('PAUSE');
  });

  it('returns FIX_QS when losing impressions to rank', () => {
    const v = getCampaignVerdict(makeCampaign({
      conversions: 2,
      searchBudgetLostImpressionShare: 0.05,
      searchRankLostImpressionShare: 0.35,
    }));
    expect(v.key).toBe('FIX_QS');
  });

  it('returns OPTIMIZE when converting with no flags', () => {
    const v = getCampaignVerdict(makeCampaign({ conversions: 5, searchBudgetLostImpressionShare: 0.1, searchRankLostImpressionShare: 0.1 }));
    expect(v.key).toBe('OPTIMIZE');
  });

  it('returns REVIEW when no conversions and low spend', () => {
    const v = getCampaignVerdict(makeCampaign({ conversions: 0, cost: 50 * MICROS }));
    expect(v.key).toBe('REVIEW');
  });

  it('SCALE takes priority over FIX_QS (budget loss checked first)', () => {
    const v = getCampaignVerdict(makeCampaign({
      conversions: 5,
      searchBudgetLostImpressionShare: 0.4,
      searchRankLostImpressionShare: 0.4,
    }));
    expect(v.key).toBe('SCALE');
  });
});

// ── analyzeSearchTerms ────────────────────────────────────────────────────────

describe('analyzeSearchTerms', () => {
  const terms = [
    makeSearchTerm({ term: 'wasted term', conversions: 0, cost: 50 * MICROS }),
    makeSearchTerm({ term: 'winner term', conversions: 3, cost: 30 * MICROS }),
    makeSearchTerm({ term: 'another winner', conversions: 1, cost: 10 * MICROS }),
  ];

  it('separates wasted and winning terms', () => {
    const r = analyzeSearchTerms(terms);
    expect(r.wasted).toHaveLength(1);
    expect(r.wasted[0].term).toBe('wasted term');
    expect(r.winners).toHaveLength(2);
  });

  it('calculates waste ratio correctly', () => {
    const r = analyzeSearchTerms(terms);
    const totalCost = 90 * MICROS;
    const wastedCost = 50 * MICROS;
    expect(r.wasteRatio).toBeCloseTo(wastedCost / totalCost, 5);
  });

  it('returns empty arrays for no search terms', () => {
    const r = analyzeSearchTerms([]);
    expect(r.wasted).toHaveLength(0);
    expect(r.winners).toHaveLength(0);
    expect(r.wasteRatio).toBe(0);
  });

  it('identifies winners not covered by exact match keywords', () => {
    const keywords = [
      makeKeyword({ text: 'exact match kw', matchType: 'EXACT' }),
    ];
    const r = analyzeSearchTerms(terms, keywords);
    // 'winner term' and 'another winner' are not covered
    expect(r.uncoveredWinners).toHaveLength(2);
  });

  it('excludes winner if covered by exact match', () => {
    const keywords = [
      makeKeyword({ text: 'winner term', matchType: 'EXACT' }),
    ];
    const r = analyzeSearchTerms(terms, keywords);
    expect(r.uncoveredWinners).toHaveLength(1);
    expect(r.uncoveredWinners[0].term).toBe('another winner');
  });

  it('is case-insensitive for exact match comparison', () => {
    const keywords = [makeKeyword({ text: 'WINNER TERM', matchType: 'EXACT' })];
    const r = analyzeSearchTerms(terms, keywords);
    expect(r.uncoveredWinners.map(t => t.term)).not.toContain('winner term');
  });
});

// ── analyzeStructure ──────────────────────────────────────────────────────────

describe('analyzeStructure', () => {
  const campaigns = [makeCampaign(), makeCampaign({ campaignId: '112', campaignName: 'Camp 2' })];
  const keywords = [
    makeKeyword({ adGroupId: 'ag1' }),
    makeKeyword({ adGroupId: 'ag1' }),
    makeKeyword({ adGroupId: 'ag2' }),
  ];

  it('counts campaigns and ad groups', () => {
    const r = analyzeStructure(campaigns, keywords);
    expect(r.campaignCount).toBe(2);
    expect(r.adGroupCount).toBe(2);
    expect(r.keywordCount).toBe(3);
  });

  it('calculates average keywords per ad group', () => {
    const r = analyzeStructure(campaigns, keywords);
    expect(r.avgKeywordsPerAdGroup).toBe(1.5);
  });

  it('detects bloated ad groups (>20 keywords)', () => {
    const bigGroup = Array.from({ length: 25 }, () => makeKeyword({ adGroupId: 'bigAg' }));
    const r = analyzeStructure(campaigns, bigGroup);
    expect(r.bloatedAdGroups).toHaveLength(1);
    expect(r.bloatedAdGroups[0].keywordCount).toBe(25);
  });

  it('returns empty bloated list when no ad group exceeds 20', () => {
    const r = analyzeStructure(campaigns, keywords);
    expect(r.bloatedAdGroups).toHaveLength(0);
  });

  it('handles no keywords gracefully', () => {
    const r = analyzeStructure(campaigns, []);
    expect(r.keywordCount).toBe(0);
    expect(r.adGroupCount).toBe(0);
    expect(r.avgKeywordsPerAdGroup).toBe(0);
  });
});

// ── computeLRRatio ────────────────────────────────────────────────────────────

describe('computeLRRatio', () => {
  it('computes L/R ratio correctly', () => {
    const campaigns = [makeCampaign({ cost: 1000 * MICROS, conversions: 10 })];
    // blendedCPA = $100. Converting keyword CPA = $50 → ratio = 2.0
    const keywords = [makeKeyword({ cost: 500 * MICROS, conversions: 10 })];
    const r = computeLRRatio(campaigns, keywords);
    expect(r.blendedCPA).toBeCloseTo(100 * MICROS);
    expect(r.convertingKeywordCPA).toBeCloseTo(50 * MICROS);
    expect(r.lrRatio).toBeCloseTo(2.0);
    expect(r.interpretation).toBe('well managed');
  });

  it('returns null ratio when no conversions', () => {
    const campaigns = [makeCampaign({ conversions: 0 })];
    const keywords = [makeKeyword({ conversions: 0 })];
    const r = computeLRRatio(campaigns, keywords);
    expect(r.lrRatio).toBeNull();
    expect(r.blendedCPA).toBeNull();
  });

  it('labels ratio > 2.5 as bleeding', () => {
    const campaigns = [makeCampaign({ cost: 3000 * MICROS, conversions: 10 })];
    const keywords = [makeKeyword({ cost: 300 * MICROS, conversions: 10 })];
    const r = computeLRRatio(campaigns, keywords);
    expect(r.interpretation).toBe('bleeding');
  });

  it('labels ratio < 1.5 as too conservative', () => {
    const campaigns = [makeCampaign({ cost: 600 * MICROS, conversions: 10 })];
    const keywords = [makeKeyword({ cost: 500 * MICROS, conversions: 10 })];
    const r = computeLRRatio(campaigns, keywords);
    expect(r.interpretation).toBe('too conservative');
  });
});

// ── analyzeKeywords ───────────────────────────────────────────────────────────

describe('analyzeKeywords', () => {
  const keywords = [
    makeKeyword({ qualityScore: 2, matchType: 'BROAD',  cost: 200 * MICROS, impressions: 500 }),
    makeKeyword({ qualityScore: 5, matchType: 'PHRASE', cost: 150 * MICROS, impressions: 300 }),
    makeKeyword({ qualityScore: 8, matchType: 'EXACT',  cost: 100 * MICROS, impressions: 200 }),
    makeKeyword({ qualityScore: 3, matchType: 'BROAD',  cost: 50  * MICROS, impressions: 100 }),
  ];

  it('segments keywords into QS buckets', () => {
    const r = analyzeKeywords(keywords);
    expect(r.qs1to3).toHaveLength(2);
    expect(r.qs4to6).toHaveLength(1);
    expect(r.qs7to10).toHaveLength(1);
  });

  it('computes impression-weighted average QS', () => {
    const r = analyzeKeywords(keywords);
    const totalImp = 500 + 300 + 200 + 100;
    const weighted = (2*500 + 5*300 + 8*200 + 3*100) / totalImp;
    expect(r.weightedAvgQS).toBeCloseTo(weighted, 1);
  });

  it('calculates match type spend percentages', () => {
    const r = analyzeKeywords(keywords);
    const total = 500 * MICROS;
    expect(r.matchTypeSpend.BROAD).toBeCloseTo(250 / 500);
    expect(r.matchTypeSpend.PHRASE).toBeCloseTo(150 / 500);
    expect(r.matchTypeSpend.EXACT).toBeCloseTo(100 / 500);
  });

  it('identifies bottom keywords by QS then cost', () => {
    const r = analyzeKeywords(keywords);
    expect(r.bottom10[0].qualityScore).toBe(2);
  });

  it('returns all zeros for empty keyword list', () => {
    const r = analyzeKeywords([]);
    expect(r.qs1to3).toHaveLength(0);
    expect(r.weightedAvgQS).toBeNull();
    expect(r.matchTypeSpend.BROAD).toBe(0);
  });

  it('returns null weightedAvgQS when no QS scores available', () => {
    const noQS = [makeKeyword({ qualityScore: null })];
    const r = analyzeKeywords(noQS);
    expect(r.totalWithQS).toBe(0);
    expect(r.weightedAvgQS).toBeNull();
  });

  it('counts QS component breakdowns', () => {
    const kws = [
      makeKeyword({ expectedCtr: 'BELOW_AVERAGE', adRelevance: 'AVERAGE', lpExperience: 'ABOVE_AVERAGE' }),
      makeKeyword({ expectedCtr: 'ABOVE_AVERAGE', adRelevance: 'ABOVE_AVERAGE', lpExperience: 'BELOW_AVERAGE' }),
    ];
    const r = analyzeKeywords(kws);
    expect(r.componentBreakdown.expectedCtr.BELOW_AVERAGE).toBe(1);
    expect(r.componentBreakdown.expectedCtr.ABOVE_AVERAGE).toBe(1);
    expect(r.componentBreakdown.adRelevance.ABOVE_AVERAGE).toBe(1);
    expect(r.componentBreakdown.lpExperience.BELOW_AVERAGE).toBe(1);
  });
});

// ── analyzeAdStrength ─────────────────────────────────────────────────────────

describe('analyzeAdStrength', () => {
  const campaigns = [makeCampaign({ campaignId: '111' }), makeCampaign({ campaignId: '222', campaignName: 'Camp 2' })];

  it('counts strength distribution', () => {
    const ads = [
      { campaignId: '111', adGroupId: 'ag1', strength: 'EXCELLENT', headlineCount: 15, pinnedHeadlines: 0 },
      { campaignId: '111', adGroupId: 'ag1', strength: 'POOR',      headlineCount: 5,  pinnedHeadlines: 2 },
      { campaignId: '222', adGroupId: 'ag2', strength: 'GOOD',      headlineCount: 12, pinnedHeadlines: 0 },
    ];
    const r = analyzeAdStrength(ads, campaigns);
    expect(r.distribution.EXCELLENT).toBe(1);
    expect(r.distribution.POOR).toBe(1);
    expect(r.distribution.GOOD).toBe(1);
    expect(r.totalRSAs).toBe(3);
  });

  it('identifies campaigns with poor ads', () => {
    const ads = [{ campaignId: '111', strength: 'POOR', headlineCount: 5, pinnedHeadlines: 0 }];
    const r = analyzeAdStrength(ads, campaigns);
    expect(r.campaignsWithPoorAds).toHaveLength(1);
    expect(r.campaignsWithPoorAds[0].campaignId).toBe('111');
  });

  it('flags under-headlined RSAs (< 10 headlines)', () => {
    const ads = [
      { campaignId: '111', strength: 'GOOD', headlineCount: 8,  pinnedHeadlines: 0 },
      { campaignId: '222', strength: 'GOOD', headlineCount: 15, pinnedHeadlines: 0 },
    ];
    const r = analyzeAdStrength(ads, campaigns);
    expect(r.underHeadlined).toHaveLength(1);
    expect(r.underHeadlined[0].headlineCount).toBe(8);
  });

  it('counts pinned headlines', () => {
    const ads = [
      { campaignId: '111', strength: 'GOOD', headlineCount: 15, pinnedHeadlines: 2 },
      { campaignId: '222', strength: 'GOOD', headlineCount: 15, pinnedHeadlines: 0 },
    ];
    const r = analyzeAdStrength(ads, campaigns);
    expect(r.pinnedCount).toBe(1);
  });

  it('returns zero counts for empty input', () => {
    const r = analyzeAdStrength([], campaigns);
    expect(r.totalRSAs).toBe(0);
    expect(r.pinnedCount).toBe(0);
    expect(r.underHeadlined).toHaveLength(0);
  });
});

// ── analyzePMax ───────────────────────────────────────────────────────────────

describe('analyzePMax', () => {
  const campaigns = [
    makeCampaign({ campaignId: '300', channelType: 'PERFORMANCE_MAX', campaignName: 'PMax 1' }),
    makeCampaign({ campaignId: '111', channelType: 'SEARCH' }),
  ];

  it('returns null if no PMax campaigns', () => {
    const r = analyzePMax([makeCampaign({ channelType: 'SEARCH' })], [], []);
    expect(r).toBeNull();
  });

  it('flags missing brand exclusion', () => {
    const r = analyzePMax(campaigns, [], []);
    const pmax = r.find(p => p.campaignId === '300');
    expect(pmax.hasBrandExclusion).toBe(false);
    expect(pmax.flags.some(f => f.includes('brand exclusion'))).toBe(true);
  });

  it('does not flag brand exclusion when present', () => {
    const exclusions = [{ campaignId: '300' }];
    const r = analyzePMax(campaigns, [], exclusions);
    const pmax = r.find(p => p.campaignId === '300');
    expect(pmax.hasBrandExclusion).toBe(true);
    expect(pmax.flags.some(f => f.includes('brand exclusion'))).toBe(false);
  });

  it('flags poor asset groups', () => {
    const assetGroups = [
      { campaignId: '300', assetGroupId: 'ag1', adStrength: 'POOR' },
      { campaignId: '300', assetGroupId: 'ag2', adStrength: 'EXCELLENT' },
    ];
    const r = analyzePMax(campaigns, assetGroups, []);
    const pmax = r.find(p => p.campaignId === '300');
    expect(pmax.poorAssetGroups).toHaveLength(1);
    expect(pmax.assetGroupCount).toBe(2);
  });

  it('only includes PMax campaigns in results', () => {
    const r = analyzePMax(campaigns, [], []);
    expect(r).toHaveLength(1);
    expect(r[0].campaignId).toBe('300');
  });
});

// ── analyzeBidding ────────────────────────────────────────────────────────────

describe('analyzeBidding', () => {
  it('flags Manual CPC campaigns with 30+ conversions', () => {
    const config = [{ campaignId: '111', campaignName: 'Test', biddingStrategyType: 'MANUAL_CPC', enhancedCpc: false, budget: 100 * MICROS, targetCpa: null, targetRoas: null }];
    const campaigns = [makeCampaign({ campaignId: '111', conversions: 35 })];
    const r = analyzeBidding(config, campaigns);
    expect(r[0].status).toBe('warn');
    expect(r[0].recommendation).toMatch(/Smart Bidding/);
  });

  it('flags Enhanced CPC as deprecated', () => {
    const config = [{ campaignId: '111', campaignName: 'Test', biddingStrategyType: 'ENHANCED_CPC', enhancedCpc: true, budget: 100 * MICROS, targetCpa: null, targetRoas: null }];
    const campaigns = [makeCampaign({ campaignId: '111', conversions: 5 })];
    const r = analyzeBidding(config, campaigns);
    expect(r[0].status).toBe('warn');
    expect(r[0].recommendation).toMatch(/deprecated/);
  });

  it('flags Target CPA set too high vs actual CPA', () => {
    const config = [{ campaignId: '111', campaignName: 'Test', biddingStrategyType: 'TARGET_CPA', enhancedCpc: false, budget: 100 * MICROS, targetCpa: 200 * MICROS, targetRoas: null }];
    // actual CPA = 1000/10 = $100, targetCPA = $200 → ratio 2.0 > 1.3 → warn
    const campaigns = [makeCampaign({ campaignId: '111', cost: 1000 * MICROS, conversions: 10 })];
    const r = analyzeBidding(config, campaigns);
    expect(r[0].status).toBe('warn');
    expect(r[0].recommendation).toMatch(/above actual CPA/);
  });

  it('returns ok for well-configured campaigns', () => {
    const config = [{ campaignId: '111', campaignName: 'Test', biddingStrategyType: 'TARGET_CPA', enhancedCpc: false, budget: 100 * MICROS, targetCpa: 110 * MICROS, targetRoas: null }];
    const campaigns = [makeCampaign({ campaignId: '111', cost: 1000 * MICROS, conversions: 10 })];
    const r = analyzeBidding(config, campaigns);
    expect(r[0].status).toBe('ok');
    expect(r[0].recommendation).toBeNull();
  });

  it('flags Maximize Conversions with no target CPA', () => {
    const config = [{ campaignId: '111', campaignName: 'Test', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', enhancedCpc: false, budget: 100 * MICROS, targetCpa: null, targetRoas: null }];
    const campaigns = [makeCampaign({ campaignId: '111' })];
    const r = analyzeBidding(config, campaigns);
    expect(r[0].status).toBe('info');
  });

  it('handles missing campaign data gracefully', () => {
    const config = [{ campaignId: '999', campaignName: 'Missing', biddingStrategyType: 'MANUAL_CPC', enhancedCpc: false, budget: 0, targetCpa: null, targetRoas: null }];
    const r = analyzeBidding(config, []);
    expect(r).toHaveLength(1);
    expect(r[0].conversions).toBe(0);
  });
});

// ── analyzeAssets ─────────────────────────────────────────────────────────────

describe('analyzeAssets', () => {
  const campaigns = [makeCampaign({ campaignId: '111' }), makeCampaign({ campaignId: '222', campaignName: 'Camp 2' })];

  it('marks asset as present when set at campaign level', () => {
    const assets = [
      { campaignId: '111', assetType: 'SITELINK' },
      { campaignId: '111', assetType: 'CALLOUT' },
    ];
    const r = analyzeAssets(assets, campaigns);
    const camp = r.find(c => c.campaignId === '111');
    expect(camp.presentTypes).toContain('SITELINK');
    expect(camp.presentTypes).toContain('CALLOUT');
    expect(camp.missingTypes).not.toContain('SITELINK');
  });

  it('marks asset as present for ALL campaigns when set at account level', () => {
    const r = analyzeAssets([], campaigns, ['SITELINK', 'CALLOUT']);
    r.forEach(camp => {
      expect(camp.presentTypes).toContain('SITELINK');
      expect(camp.presentTypes).toContain('CALLOUT');
    });
  });

  it('account-level assets override missing campaign-level assets', () => {
    const campaignAssets = [{ campaignId: '111', assetType: 'SITELINK' }];
    const accountAssets = ['CALLOUT'];
    const r = analyzeAssets(campaignAssets, campaigns, accountAssets);
    // Campaign 111 has sitelink at campaign level, callout at account level
    const camp = r.find(c => c.campaignId === '111');
    expect(camp.presentTypes).toContain('SITELINK');
    expect(camp.presentTypes).toContain('CALLOUT');
  });

  it('computes coverage score correctly', () => {
    const assets = [
      { campaignId: '111', assetType: 'SITELINK' },
      { campaignId: '111', assetType: 'CALLOUT' },
      { campaignId: '111', assetType: 'STRUCTURED_SNIPPET' },
      { campaignId: '111', assetType: 'CALL' },
      { campaignId: '111', assetType: 'MARKETING_IMAGE' },
    ];
    const r = analyzeAssets(assets, campaigns);
    const camp = r.find(c => c.campaignId === '111');
    expect(camp.coverageScore).toBeCloseTo(1.0);
  });

  it('returns 0% coverage when no assets at all', () => {
    const r = analyzeAssets([], campaigns, []);
    r.forEach(c => {
      expect(c.coverageScore).toBe(0);
      expect(c.missingTypes).toHaveLength(5);
    });
  });
});

// ── buildActionPlan ───────────────────────────────────────────────────────────

describe('buildActionPlan', () => {
  const scaleCampaign = {
    ...makeCampaign(),
    verdict: { key: 'SCALE', label: 'SCALE', color: '#4ecca3', bg: '', icon: '' },
    searchBudgetLostImpressionShare: 0.4,
    cpa: 50 * MICROS,
  };

  const pauseCampaign = {
    ...makeCampaign({ conversions: 0, cost: 500 * MICROS }),
    verdict: { key: 'PAUSE', label: 'PAUSE', color: '#9ca3af', bg: '', icon: '' },
    cpa: null,
  };

  const searchTermAnalysis = {
    wasteRatio: 0.15,
    totalWastedCost: 100 * MICROS,
    wasted: [{ term: 'waste 1', cost: 60 * MICROS }, { term: 'waste 2', cost: 40 * MICROS }, { term: 'waste 3', cost: 20 * MICROS }],
    winners: [],
    uncoveredWinners: [],
  };

  it('generates SCALE action for budget-constrained profitable campaign', () => {
    const plan = buildActionPlan([scaleCampaign], { wasteRatio: 0, wasted: [], winners: [], uncoveredWinners: [] });
    const action = plan.find(a => a.category === 'Budget');
    expect(action).toBeDefined();
    expect(action.fix).toMatch(/Increase daily budget/);
  });

  it('generates PAUSE action for zero-conversion campaign', () => {
    const plan = buildActionPlan([pauseCampaign], { wasteRatio: 0, wasted: [], winners: [], uncoveredWinners: [] });
    const action = plan.find(a => a.category === 'Campaign');
    expect(action).toBeDefined();
    expect(action.fix).toMatch(/Pause/);
  });

  it('generates search term waste action when wasteRatio > 8%', () => {
    const plan = buildActionPlan([scaleCampaign], searchTermAnalysis);
    const action = plan.find(a => a.category === 'Search Terms');
    expect(action).toBeDefined();
  });

  it('does not generate search term action when waste is low', () => {
    const plan = buildActionPlan([scaleCampaign], { wasteRatio: 0.03, wasted: [], winners: [], uncoveredWinners: [] });
    expect(plan.find(a => a.category === 'Search Terms')).toBeUndefined();
  });

  it('sorts actions by ICE score descending', () => {
    const plan = buildActionPlan([scaleCampaign, pauseCampaign], searchTermAnalysis);
    for (let i = 0; i < plan.length - 1; i++) {
      expect(plan[i].ice).toBeGreaterThanOrEqual(plan[i + 1].ice);
    }
  });

  it('attaches ICE score to each action', () => {
    const plan = buildActionPlan([scaleCampaign], { wasteRatio: 0, wasted: [], winners: [], uncoveredWinners: [] });
    plan.forEach(a => {
      expect(a.ice).toBe(a.impact * a.confidence * a.ease);
    });
  });

  it('generates broad match warning when spend > 60%', () => {
    const keywordAnalysis = {
      qs1to3: [], qs4to6: [], qs7to10: [], totalWithQS: 0,
      weightedAvgQS: null,
      matchTypeSpend: { BROAD: 0.75, PHRASE: 0.15, EXACT: 0.10 },
      bottom10: [], zeroConvHighSpend: [], componentBreakdown: {},
    };
    const plan = buildActionPlan([], { wasteRatio: 0, wasted: [], winners: [], uncoveredWinners: [] }, null, keywordAnalysis);
    expect(plan.find(a => a.category === 'Match Types')).toBeDefined();
  });

  it('generates PMax brand exclusion action', () => {
    const pmaxData = [{
      campaignId: '300',
      campaignName: 'PMax',
      hasBrandExclusion: false,
      poorAssetGroups: [],
      flags: ['No brand exclusion'],
    }];
    const plan = buildActionPlan([], { wasteRatio: 0, wasted: [], winners: [], uncoveredWinners: [] }, null, null, null, [], [], null, pmaxData);
    expect(plan.find(a => a.category === 'PMax')).toBeDefined();
  });
});

// ── runAudit ──────────────────────────────────────────────────────────────────

describe('runAudit', () => {
  const accountData = {
    campaigns: [
      makeCampaign({ campaignId: '111', conversions: 10, cost: 500 * MICROS, searchBudgetLostImpressionShare: 0.3 }),
      makeCampaign({ campaignId: '222', campaignName: 'Camp 2', conversions: 0, cost: 400 * MICROS }),
    ],
    searchTerms: [
      makeSearchTerm({ conversions: 2 }),
      makeSearchTerm({ term: 'waste', conversions: 0, cost: 80 * MICROS }),
    ],
    optimizationScore: 0.72,
    recommendations: [],
  };

  const auditData = {
    keywords: [
      makeKeyword({ campaignId: '111', matchType: 'BROAD',  qualityScore: 3, cost: 200 * MICROS }),
      makeKeyword({ campaignId: '111', matchType: 'EXACT',  qualityScore: 8, cost: 100 * MICROS }),
      makeKeyword({ campaignId: '222', matchType: 'PHRASE', qualityScore: 5, cost: 150 * MICROS }),
    ],
    campaignConfig: [
      { campaignId: '111', campaignName: 'Test Campaign', biddingStrategyType: 'MANUAL_CPC', enhancedCpc: false, budget: 100 * MICROS, targetCpa: null, targetRoas: null },
    ],
    campaignAssets: [
      { campaignId: '111', assetType: 'SITELINK' },
    ],
    accountAssetTypes: ['CALLOUT'],
    adStrength: [
      { campaignId: '111', adGroupId: 'ag1', strength: 'GOOD', headlineCount: 15, pinnedHeadlines: 0 },
    ],
    pmaxAssetGroups: [],
    pmaxBrandExclusions: [],
  };

  it('returns correct summary totals', () => {
    const r = runAudit(accountData, auditData);
    expect(r.summary.totalConversions).toBe(10);
    expect(r.summary.campaignCount).toBe(2);
  });

  it('assigns verdicts to all campaigns', () => {
    const r = runAudit(accountData, auditData);
    expect(r.campaigns).toHaveLength(2);
    r.campaigns.forEach(c => expect(c.verdict).toBeDefined());
  });

  it('runs Phase 1 only when auditData is null', () => {
    const r = runAudit(accountData, null);
    expect(r.keywords).toBeNull();
    expect(r.bidding).toHaveLength(0);
    expect(r.assets).toHaveLength(0);
    expect(r.campaigns).toHaveLength(2);
  });

  it('enriches with Phase 2 data when auditData provided', () => {
    const r = runAudit(accountData, auditData);
    expect(r.keywords).not.toBeNull();
    expect(r.bidding.length).toBeGreaterThan(0);
  });

  it('filters to single campaign when campaignId provided', () => {
    const r = runAudit(accountData, auditData, '111');
    expect(r.summary.campaignCount).toBe(1);
    expect(r.campaigns[0].campaignId).toBe('111');
  });

  it('campaign-level keywords are filtered by campaignId', () => {
    const r = runAudit(accountData, auditData, '111');
    // Should only include keywords for campaign 111
    const allCampaignIds = new Set(auditData.keywords.map(k => k.campaignId));
    expect(r.keywords).not.toBeNull();
    expect(r.keywords.totalWithQS).toBe(2); // 2 keywords for campaign 111
  });

  it('generates an action plan with ICE scores', () => {
    const r = runAudit(accountData, auditData);
    expect(r.actionPlan.length).toBeGreaterThan(0);
    r.actionPlan.forEach(a => expect(typeof a.ice).toBe('number'));
  });

  it('action plan is sorted by ICE descending', () => {
    const r = runAudit(accountData, auditData);
    for (let i = 0; i < r.actionPlan.length - 1; i++) {
      expect(r.actionPlan[i].ice).toBeGreaterThanOrEqual(r.actionPlan[i + 1].ice);
    }
  });

  it('includes account-level assets in asset analysis', () => {
    const r = runAudit(accountData, auditData);
    const camp111 = r.assets.find(a => a.campaignId === '111');
    expect(camp111.presentTypes).toContain('SITELINK');   // campaign-level
    expect(camp111.presentTypes).toContain('CALLOUT');    // account-level
  });

  it('blendedCPA is null when no conversions', () => {
    const noConvData = {
      ...accountData,
      campaigns: [makeCampaign({ conversions: 0, campaignId: '999' })],
      searchTerms: [],
    };
    const r = runAudit(noConvData, null);
    expect(r.summary.blendedCPA).toBeNull();
  });
});
