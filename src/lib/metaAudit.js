// src/lib/metaAudit.js
// Pure audit logic — no React, no side effects.
// Consumed by /api/meta/audit which fetches raw Meta data.

export function fmtCurrency(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function fmtPct(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

export function fmtCvr(clicks, conversions) {
  if (!clicks) return '—';
  return `${((conversions / clicks) * 100).toFixed(1)}%`;
}

// ── Campaign-level verdict ────────────────────────────────────────────────────
export function getCampaignVerdict(campaign) {
  const conv  = campaign.conversions || 0;
  const spend = campaign.spend || 0;
  const freq  = campaign.frequency || 0;
  if (conv === 0 && spend > 300) {
    return { key: 'PAUSE', label: 'PAUSE', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)', icon: '⚫' };
  }
  if (freq > 5 && spend > 100) {
    return { key: 'FATIGUED', label: 'FATIGUED', color: '#dd6b20', bg: 'rgba(221,107,32,0.14)', icon: '🔥' };
  }
  if (conv > 10 && spend > 0) {
    return { key: 'SCALE', label: 'SCALE', color: '#38a169', bg: 'rgba(56,161,105,0.14)', icon: '🚀' };
  }
  return { key: 'REVIEW', label: 'REVIEW', color: '#4ecca3', bg: 'rgba(78,204,163,0.12)', icon: '👀' };
}

// ── Pillar 1: Account Structure ───────────────────────────────────────────────
export function analyzeStructure(campaigns) {
  const active = campaigns.filter((c) => c.status === 'ACTIVE' || c.effective_status === 'ACTIVE');
  const objectives = {};
  active.forEach((c) => {
    const k = c.objective || 'UNKNOWN';
    objectives[k] = (objectives[k] || 0) + 1;
  });
  const cboCount = active.filter((c) => c.budget_remaining != null || c.daily_budget != null || c.lifetime_budget != null).length;
  const cboPct   = active.length ? cboCount / active.length : 0;

  const lowSpend = active.filter((c) => (c.spend || 0) < 500).length;
  const fragmentationRatio = active.length ? lowSpend / active.length : 0;

  let score = 7;
  if (active.length > 0) {
    if (fragmentationRatio > 0.6) score -= 3;
    else if (fragmentationRatio > 0.4) score -= 2;
    else if (fragmentationRatio > 0.2) score -= 1;
    if (cboPct >= 0.6) score += 1;
    if (Object.keys(objectives).length <= 3 && active.length > 5) score += 1;
  }
  score = Math.max(1, Math.min(10, score));

  return {
    activeCampaignCount: active.length,
    objectives,
    cboPct,
    fragmentationRatio,
    lowSpendCount: lowSpend,
    score,
  };
}

// ── Pillar 2: Ad Fatigue (frequency) ──────────────────────────────────────────
export function analyzeFatigue(adSets) {
  const totalSpend = adSets.reduce((s, a) => s + (a.spend || 0), 0);
  const fatigued = adSets.filter((a) => (a.frequency || 0) > 4);
  const fatiguedSpend = fatigued.reduce((s, a) => s + (a.spend || 0), 0);
  const fatiguedPct = totalSpend > 0 ? fatiguedSpend / totalSpend : 0;

  let score;
  if (fatiguedPct < 0.05) score = 9;
  else if (fatiguedPct < 0.15) score = 7;
  else if (fatiguedPct < 0.30) score = 5;
  else if (fatiguedPct < 0.50) score = 3;
  else score = 1;

  return {
    fatiguedAdSets: fatigued.map((a) => ({
      id: a.id,
      name: a.name,
      campaignName: a.campaign_name,
      frequency: a.frequency,
      spend: a.spend,
    })),
    fatiguedSpendPct: fatiguedPct,
    fatiguedSpend,
    totalSpend,
    score,
  };
}

// ── Pillar 3: Creative Diversity ──────────────────────────────────────────────
export function analyzeCreative(adSets, ads) {
  const adsByAdSet = {};
  ads.forEach((ad) => {
    const k = ad.ad_set_id;
    if (!adsByAdSet[k]) adsByAdSet[k] = [];
    adsByAdSet[k].push(ad);
  });

  const perAdSetCounts = adSets.map((as) => (adsByAdSet[as.id] || []).length);
  const avgCreatives = perAdSetCounts.length
    ? perAdSetCounts.reduce((s, n) => s + n, 0) / perAdSetCounts.length
    : 0;

  const singleCreativeAdSets = adSets.filter((as) => (adsByAdSet[as.id] || []).length === 1).length;
  const singleCreativePct = adSets.length ? singleCreativeAdSets / adSets.length : 0;

  let score;
  if (avgCreatives >= 4) score = 9;
  else if (avgCreatives >= 3) score = 7;
  else if (avgCreatives >= 2) score = 5;
  else score = 2;
  if (singleCreativePct > 0.5) score = Math.max(1, score - 2);

  return {
    avgCreativesPerAdSet: avgCreatives,
    singleCreativeAdSetCount: singleCreativeAdSets,
    singleCreativePct,
    score,
  };
}

// ── Pillar 4: Audience Targeting ──────────────────────────────────────────────
export function analyzeAudience(adSets) {
  let broadSpend = 0;
  let narrowSpend = 0;
  let lookalikeCount = 0;
  let expansionCount = 0;

  adSets.forEach((as) => {
    const spend = as.spend || 0;
    const t = as.targeting || {};
    const hasDetailed = Array.isArray(t.flexible_spec) && t.flexible_spec.length > 0;
    const hasCustomAudience = Array.isArray(t.custom_audiences) && t.custom_audiences.length > 0;
    const hasLookalike = hasCustomAudience && (t.custom_audiences || []).some(
      (c) => (c.name || '').toLowerCase().includes('lookalike') || (c.name || '').toLowerCase().includes('lal'),
    );
    if (hasLookalike) lookalikeCount += 1;
    if (t.targeting_automation?.advantage_audience === 1 || t.targeting_automation?.individual_setting?.age === 1) {
      expansionCount += 1;
    }
    if (hasDetailed && !hasLookalike) narrowSpend += spend;
    else broadSpend += spend;
  });

  const totalSpend = broadSpend + narrowSpend;
  const broadPct = totalSpend > 0 ? broadSpend / totalSpend : 0;

  let score;
  if (broadPct >= 0.7) score = 9;
  else if (broadPct >= 0.5) score = 7;
  else if (broadPct >= 0.3) score = 5;
  else score = 3;
  if (lookalikeCount > 0) score = Math.min(10, score + 1);

  return { broadPct, broadSpend, narrowSpend, lookalikeCount, expansionCount, score };
}

// ── Pillar 5: Placements ──────────────────────────────────────────────────────
export function analyzePlacements(adSets) {
  const advantagePlacementCount = adSets.filter(
    (as) => as.targeting?.publisher_platforms == null,
  ).length;
  const advantagePct = adSets.length ? advantagePlacementCount / adSets.length : 0;

  let score;
  if (advantagePct >= 0.8) score = 9;
  else if (advantagePct >= 0.6) score = 7;
  else if (advantagePct >= 0.4) score = 5;
  else score = 3;

  return { advantagePlacementCount, advantagePct, score };
}

// ── Pillar 6: Bidding & Budget ────────────────────────────────────────────────
export function analyzeBidding(adSets, campaigns) {
  const learning = adSets.filter((as) => as.learning_stage_info?.status === 'LEARNING');
  const learningPct = adSets.length ? learning.length / adSets.length : 0;

  const bidStrategies = {};
  [...campaigns, ...adSets].forEach((x) => {
    const k = x.bid_strategy || 'UNKNOWN';
    bidStrategies[k] = (bidStrategies[k] || 0) + 1;
  });

  const lowestCostCount = bidStrategies['LOWEST_COST_WITHOUT_CAP'] || 0;
  const bidCapCount = (bidStrategies['LOWEST_COST_WITH_BID_CAP'] || 0) + (bidStrategies['COST_CAP'] || 0);
  const smartBidFit = lowestCostCount > bidCapCount;

  let score;
  if (learningPct < 0.1 && smartBidFit) score = 9;
  else if (learningPct < 0.25) score = 7;
  else if (learningPct < 0.5) score = 5;
  else score = 3;

  return {
    learningCount: learning.length,
    learningPct,
    bidStrategies,
    smartBidFit,
    score,
  };
}

// ── Pillar 7: Conversion Tracking ─────────────────────────────────────────────
export function analyzeTracking(pixels, accountInsights) {
  const hasPixel = Array.isArray(pixels) && pixels.length > 0;
  const recentlyFired = hasPixel && pixels.some((p) => {
    if (!p.last_fired_time) return false;
    const ago = Date.now() - new Date(p.last_fired_time).getTime();
    return ago < 7 * 24 * 3600 * 1000;
  });
  const accountConversions = accountInsights?.conversions || 0;

  let score;
  if (hasPixel && recentlyFired && accountConversions > 0) score = 9;
  else if (hasPixel && recentlyFired) score = 7;
  else if (hasPixel) score = 5;
  else score = 2;

  return {
    hasPixel,
    pixelCount: pixels?.length || 0,
    recentlyFired,
    conversions: accountConversions,
    score,
  };
}

// ── Pillar 8: Performance ─────────────────────────────────────────────────────
export function analyzePerformance(campaigns, adSets) {
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalConv  = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const blendedCPA = totalConv > 0 ? totalSpend / totalConv : null;

  const zeroConvHighSpend = adSets.filter((as) => (as.conversions || 0) === 0 && (as.spend || 0) > 100);
  const zeroConvSpend = zeroConvHighSpend.reduce((s, a) => s + (a.spend || 0), 0);
  const zeroConvPct = totalSpend > 0 ? zeroConvSpend / totalSpend : 0;

  let score;
  if (zeroConvPct < 0.05) score = 9;
  else if (zeroConvPct < 0.15) score = 7;
  else if (zeroConvPct < 0.30) score = 5;
  else score = 2;

  return {
    totalSpend,
    totalConversions: totalConv,
    blendedCPA,
    zeroConvHighSpend: zeroConvHighSpend.slice(0, 20),
    zeroConvPct,
    score,
  };
}

// ── Action Plan ───────────────────────────────────────────────────────────────
export function buildActionPlan({ structure, fatigue, creative, audience, placements, bidding, tracking, performance }) {
  const actions = [];
  if (fatigue.fatiguedSpendPct > 0.3) {
    actions.push({
      priority: 'critical',
      category: 'Ad Fatigue',
      issue: `${Math.round(fatigue.fatiguedSpendPct * 100)}% of spend on fatigued ad sets (frequency > 4)`,
      action: 'Refresh creative on top 3 fatigued ad sets this week',
      ice: 700,
    });
  }
  if (performance.zeroConvPct > 0.2) {
    actions.push({
      priority: 'critical',
      category: 'Performance',
      issue: `${Math.round(performance.zeroConvPct * 100)}% of spend producing zero conversions`,
      action: `Pause or restructure ${performance.zeroConvHighSpend.length} high-spend 0-conversion ad sets`,
      ice: 650,
    });
  }
  if (!tracking.hasPixel) {
    actions.push({
      priority: 'critical',
      category: 'Tracking',
      issue: 'No Meta Pixel attached to this ad account',
      action: 'Attach Pixel and set up standard events (Purchase, Lead, etc.)',
      ice: 800,
    });
  } else if (!tracking.recentlyFired) {
    actions.push({
      priority: 'high',
      category: 'Tracking',
      issue: 'Pixel exists but no events fired in last 7 days',
      action: 'Verify Pixel is installed on site and events are firing',
      ice: 500,
    });
  }
  if (placements.advantagePct < 0.5) {
    actions.push({
      priority: 'medium',
      category: 'Placements',
      issue: `Only ${Math.round(placements.advantagePct * 100)}% of ad sets use Advantage+ Placements`,
      action: 'Enable Advantage+ Placements on manual-placement campaigns to expand reach',
      ice: 350,
    });
  }
  if (creative.avgCreativesPerAdSet < 2) {
    actions.push({
      priority: 'medium',
      category: 'Creative',
      issue: `Average ${creative.avgCreativesPerAdSet.toFixed(1)} creatives per ad set — target 4+`,
      action: 'Add 3-4 creative variants to under-served ad sets to give Meta room to optimize',
      ice: 300,
    });
  }
  if (bidding.learningPct > 0.4) {
    actions.push({
      priority: 'high',
      category: 'Bidding',
      issue: `${Math.round(bidding.learningPct * 100)}% of ad sets stuck in learning phase`,
      action: 'Consolidate low-event ad sets so each gets 50+ optimization events per 7 days',
      ice: 450,
    });
  }
  if (audience.broadPct < 0.3) {
    actions.push({
      priority: 'medium',
      category: 'Audience',
      issue: `Only ${Math.round(audience.broadPct * 100)}% of spend on broad targeting`,
      action: 'Test broad audiences — Meta recommends creative leverage over narrow targeting',
      ice: 300,
    });
  }
  if (structure.fragmentationRatio > 0.5) {
    actions.push({
      priority: 'high',
      category: 'Structure',
      issue: `${structure.lowSpendCount} campaigns under $500 spend — heavy fragmentation`,
      action: 'Consolidate low-spend campaigns; Meta optimizes better with fewer, larger budgets',
      ice: 450,
    });
  }
  return actions.sort((a, b) => b.ice - a.ice);
}

export function runAudit(accountData) {
  const { campaigns = [], adSets = [], ads = [], pixels = [], accountInsights = {} } = accountData || {};

  const structure   = analyzeStructure(campaigns);
  const fatigue     = analyzeFatigue(adSets);
  const creative    = analyzeCreative(adSets, ads);
  const audience    = analyzeAudience(adSets);
  const placements  = analyzePlacements(adSets);
  const bidding     = analyzeBidding(adSets, campaigns);
  const tracking    = analyzeTracking(pixels, accountInsights);
  const performance = analyzePerformance(campaigns, adSets);

  const pillars = { structure, fatigue, creative, audience, placements, bidding, tracking, performance };
  const actionPlan = buildActionPlan(pillars);

  const scores = [structure.score, fatigue.score, creative.score, audience.score, placements.score, bidding.score, tracking.score, performance.score];
  const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
  let grade;
  if (avg >= 8.0) grade = 'A';
  else if (avg >= 6.5) grade = 'B';
  else if (avg >= 5.0) grade = 'C';
  else if (avg >= 3.5) grade = 'D';
  else grade = 'F';

  return {
    summary: {
      totalSpend: performance.totalSpend,
      totalConversions: performance.totalConversions,
      blendedCPA: performance.blendedCPA,
      accountGrade: grade,
      avgScore: Math.round(avg * 10) / 10,
      criticalCount: actionPlan.filter((a) => a.priority === 'critical').length,
      warningCount:  actionPlan.filter((a) => a.priority === 'high').length,
      campaignCount: campaigns.length,
      adSetCount: adSets.length,
      adCount: ads.length,
    },
    pillars,
    campaigns: campaigns.map((c) => ({ ...c, verdict: getCampaignVerdict(c) })),
    adSets,
    ads,
    actionPlan,
  };
}
