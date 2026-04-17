// src/lib/googleAdsAudit.js
// Pure audit logic — no React, no side effects.

const MICROS = 1_000_000;

export function fmtCurrency(micros) {
  const dollars = (micros || 0) / MICROS;
  return dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${dollars.toFixed(0)}`;
}

export function fmtPct(ratio) {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 100)}%`;
}

export function fmtCvr(clicks, conversions) {
  if (!clicks) return '—';
  return `${((conversions / clicks) * 100).toFixed(1)}%`;
}

// ── Campaign verdict ──────────────────────────────────────────────────────────
export function getCampaignVerdict(campaign) {
  const conv  = campaign.conversions || 0;
  const cost  = campaign.cost || 0;
  const lostBudget = campaign.searchBudgetLostImpressionShare;
  const lostRank   = campaign.searchRankLostImpressionShare;

  if (conv === 0 && cost > 300_000) {
    return { key: 'PAUSE', label: 'PAUSE', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)', icon: '⚫' };
  }
  if (lostBudget != null && lostBudget > 0.25 && conv > 0) {
    return { key: 'SCALE', label: 'SCALE', color: '#4ecca3', bg: 'rgba(78,204,163,0.12)', icon: '🟢' };
  }
  if (lostRank != null && lostRank > 0.25) {
    return { key: 'FIX_QS', label: 'FIX QS/BIDS', color: '#e94560', bg: 'rgba(233,69,96,0.12)', icon: '🔴' };
  }
  if (conv > 0) {
    return { key: 'OPTIMIZE', label: 'OPTIMIZE', color: '#f5a623', bg: 'rgba(245,166,35,0.12)', icon: '🟡' };
  }
  return { key: 'REVIEW', label: 'REVIEW', color: '#f5a623', bg: 'rgba(245,166,35,0.12)', icon: '🟡' };
}

// ── Search term analysis ──────────────────────────────────────────────────────
export function analyzeSearchTerms(searchTerms, keywords = []) {
  const all = searchTerms || [];
  const wasted  = all.filter((t) => t.conversions === 0 && t.cost > 0).sort((a, b) => b.cost - a.cost);
  const winners = all.filter((t) => t.conversions > 0).sort((a, b) => b.conversions - a.conversions);
  const totalWastedCost = wasted.reduce((s, t) => s + t.cost, 0);
  const totalCost = all.reduce((s, t) => s + t.cost, 0);
  const wasteRatio = totalCost > 0 ? totalWastedCost / totalCost : 0;

  const exactKeywordTexts = new Set(
    keywords
      .filter((k) => k.matchType === 'EXACT')
      .map((k) => k.text?.toLowerCase().trim())
      .filter(Boolean)
  );
  const uncoveredWinners = winners.filter(
    (t) => !exactKeywordTexts.has(t.term?.toLowerCase().trim())
  );

  return {
    wasted:  wasted.slice(0, 12),
    winners: winners.slice(0, 10),
    totalWastedCost,
    wasteRatio,
    uncoveredWinners,
  };
}

// ── Pillar 1: Account structure ───────────────────────────────────────────────
export function analyzeStructure(campaigns, keywords) {
  const adGroupIds = new Set(keywords.map((k) => k.adGroupId).filter(Boolean));
  const adGroupCount = adGroupIds.size;
  const keywordCount = keywords.length;
  const avgKeywordsPerAdGroup = adGroupCount > 0 ? keywordCount / adGroupCount : 0;

  const kwPerAdGroup = {};
  keywords.forEach((k) => {
    if (!k.adGroupId) return;
    kwPerAdGroup[k.adGroupId] = (kwPerAdGroup[k.adGroupId] || { count: 0, name: k.adGroupName, campaignName: k.campaignName });
    kwPerAdGroup[k.adGroupId].count += 1;
  });
  const bloatedAdGroups = Object.entries(kwPerAdGroup)
    .filter(([, v]) => v.count > 20)
    .map(([id, v]) => ({ adGroupId: id, adGroupName: v.name, campaignName: v.campaignName, keywordCount: v.count }))
    .sort((a, b) => b.keywordCount - a.keywordCount);

  const campaignTypes = {};
  campaigns.forEach((c) => {
    const t = c.channelType || 'UNKNOWN';
    campaignTypes[t] = (campaignTypes[t] || 0) + 1;
  });

  return {
    campaignCount: campaigns.length,
    adGroupCount,
    keywordCount,
    avgKeywordsPerAdGroup: Math.round(avgKeywordsPerAdGroup * 10) / 10,
    bloatedAdGroups,
    campaignTypes,
  };
}

// ── Pillar 2: L/R ratio ───────────────────────────────────────────────────────
export function computeLRRatio(campaigns, keywords) {
  const totalCost = campaigns.reduce((s, c) => s + (c.cost || 0), 0);
  const totalConv = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const blendedCPA = totalConv > 0 ? totalCost / totalConv : null;

  const convertingKws = keywords.filter((k) => (k.conversions || 0) > 0);
  const convKwCost = convertingKws.reduce((s, k) => s + (k.cost || 0), 0);
  const convKwConv = convertingKws.reduce((s, k) => s + (k.conversions || 0), 0);
  const convertingKeywordCPA = convKwConv > 0 ? convKwCost / convKwConv : null;

  let lrRatio = null;
  let interpretation = null;
  if (blendedCPA != null && convertingKeywordCPA != null && convertingKeywordCPA > 0) {
    lrRatio = blendedCPA / convertingKeywordCPA;
    if (lrRatio < 1.5) interpretation = 'too conservative';
    else if (lrRatio <= 2.0) interpretation = 'well managed';
    else if (lrRatio <= 2.5) interpretation = 'aggressive';
    else interpretation = 'bleeding';
  }

  return { blendedCPA, convertingKeywordCPA, lrRatio, interpretation };
}

// ── Pillars 5 & 7: Keyword analysis ──────────────────────────────────────────
export function analyzeKeywords(keywords) {
  const withQS = keywords.filter((k) => k.qualityScore != null);
  const qs1to3 = withQS.filter((k) => k.qualityScore <= 3);
  const qs4to6 = withQS.filter((k) => k.qualityScore >= 4 && k.qualityScore <= 6);
  const qs7to10 = withQS.filter((k) => k.qualityScore >= 7);

  const totalImp = withQS.reduce((s, k) => s + (k.impressions || 0), 0);
  const weightedQS = totalImp > 0
    ? withQS.reduce((s, k) => s + (k.qualityScore * (k.impressions || 0)), 0) / totalImp
    : null;

  const spendByMatch = { BROAD: 0, PHRASE: 0, EXACT: 0 };
  let totalMatchSpend = 0;
  keywords.forEach((k) => {
    const mt = k.matchType;
    if (mt === 'BROAD' || mt === 'PHRASE' || mt === 'EXACT') {
      spendByMatch[mt] += (k.cost || 0);
      totalMatchSpend += (k.cost || 0);
    }
  });
  const matchTypeSpend = {
    BROAD:  totalMatchSpend > 0 ? spendByMatch.BROAD / totalMatchSpend : 0,
    PHRASE: totalMatchSpend > 0 ? spendByMatch.PHRASE / totalMatchSpend : 0,
    EXACT:  totalMatchSpend > 0 ? spendByMatch.EXACT / totalMatchSpend : 0,
  };

  const bottom10 = [...withQS]
    .sort((a, b) => {
      if (a.qualityScore !== b.qualityScore) return a.qualityScore - b.qualityScore;
      return (b.cost || 0) - (a.cost || 0);
    })
    .slice(0, 10);

  const zeroConvHighSpend = keywords
    .filter((k) => (k.conversions || 0) === 0 && (k.cost || 0) > 1_000_000)
    .sort((a, b) => (b.cost || 0) - (a.cost || 0));

  const components = ['expectedCtr', 'adRelevance', 'lpExperience'];
  const componentBreakdown = {};
  components.forEach((comp) => {
    componentBreakdown[comp] = { BELOW_AVERAGE: 0, AVERAGE: 0, ABOVE_AVERAGE: 0 };
    keywords.forEach((k) => {
      const val = k[comp];
      if (val && componentBreakdown[comp][val] != null) {
        componentBreakdown[comp][val] += 1;
      }
    });
  });

  return {
    qs1to3,
    qs4to6,
    qs7to10,
    totalWithQS: withQS.length,
    weightedAvgQS: weightedQS != null ? Math.round(weightedQS * 10) / 10 : null,
    matchTypeSpend,
    bottom10,
    zeroConvHighSpend,
    componentBreakdown,
  };
}

// ── Pillar 6: Ad strength ─────────────────────────────────────────────────────
export function analyzeAdStrength(adStrength, campaigns) {
  const distribution = { EXCELLENT: 0, GOOD: 0, AVERAGE: 0, POOR: 0 };
  adStrength.forEach((a) => {
    const s = a.strength;
    if (distribution[s] != null) distribution[s] += 1;
  });

  const poorCampaignIds = new Set(
    adStrength.filter((a) => a.strength === 'POOR').map((a) => String(a.campaignId))
  );
  const campaignsWithPoorAds = campaigns.filter((c) => poorCampaignIds.has(String(c.campaignId)));

  const totalRSAs = adStrength.length;

  const underHeadlined = adStrength.filter((a) => a.headlineCount > 0 && a.headlineCount < 10);
  const pinned = adStrength.filter((a) => a.pinnedHeadlines > 0);

  return {
    distribution,
    campaignsWithPoorAds,
    totalRSAs,
    underHeadlined,
    pinnedCount: pinned.length,
  };
}

// ── Pillar 10: PMax ───────────────────────────────────────────────────────────
export function analyzePMax(campaigns, pmaxAssetGroups = [], pmaxBrandExclusions = []) {
  const pmaxCampaigns = campaigns.filter((c) => c.channelType === 'PERFORMANCE_MAX');
  if (pmaxCampaigns.length === 0) return null;

  const exclusionCampaignIds = new Set(pmaxBrandExclusions.map((e) => String(e.campaignId)));
  const assetGroupsByCampaign = {};
  pmaxAssetGroups.forEach((ag) => {
    const id = String(ag.campaignId);
    if (!assetGroupsByCampaign[id]) assetGroupsByCampaign[id] = [];
    assetGroupsByCampaign[id].push(ag);
  });

  return pmaxCampaigns.map((c) => {
    const id = String(c.campaignId);
    const assetGroups = assetGroupsByCampaign[id] || [];
    const hasBrandExclusion = exclusionCampaignIds.has(id);
    const poorAssetGroups = assetGroups.filter((ag) =>
      ['POOR', 'AVERAGE', 'NO_ADS', 'PENDING'].includes(ag.adStrength)
    );
    return {
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      cost: c.cost,
      conversions: c.conversions,
      assetGroupCount: assetGroups.length,
      hasBrandExclusion,
      poorAssetGroups,
      flags: [
        !hasBrandExclusion && 'No brand exclusion — PMax may cannibalize your brand campaigns',
        assetGroups.length === 0 && 'No asset groups found',
        poorAssetGroups.length > 0 && `${poorAssetGroups.length} asset group(s) have poor/average strength`,
      ].filter(Boolean),
    };
  });
}

// ── Pillar 8: Bidding analysis ────────────────────────────────────────────────
export function analyzeBidding(campaignConfig, campaigns) {
  const campaignMap = {};
  campaigns.forEach((c) => {
    campaignMap[String(c.campaignId)] = c;
  });

  return campaignConfig.map((cfg) => {
    const live = campaignMap[String(cfg.campaignId)] || {};
    const actualConv = live.conversions || 0;
    const actualCost = live.cost || 0;
    const actualCPA = actualConv > 0 ? actualCost / actualConv : null;

    let status = 'ok';
    let recommendation = null;

    const strategy = cfg.biddingStrategyType;

    if (strategy === 'MANUAL_CPC' && !cfg.enhancedCpc && actualConv >= 30) {
      status = 'warn';
      recommendation = `Has ${actualConv.toFixed(0)} conversions — upgrade to Smart Bidding (Target CPA or Maximize Conversions) to let Google optimize bids automatically.`;
    } else if (strategy === 'MANUAL_CPC' && cfg.enhancedCpc) {
      status = 'warn';
      recommendation = 'Enhanced CPC is deprecated. Migrate to Target CPA, Maximize Conversions, or Maximize Conversion Value.';
    } else if (strategy === 'ENHANCED_CPC') {
      status = 'warn';
      recommendation = 'Enhanced CPC is deprecated. Migrate to Target CPA, Maximize Conversions, or Maximize Conversion Value.';
    } else if ((strategy === 'TARGET_CPA') && cfg.targetCpa && actualCPA) {
      const ratio = cfg.targetCpa / actualCPA;
      if (ratio > 1.3) {
        status = 'warn';
        recommendation = `Target CPA (${fmtCurrency(cfg.targetCpa)}) is ${Math.round((ratio - 1) * 100)}% above actual CPA (${fmtCurrency(actualCPA)}). Tighten target to improve efficiency.`;
      } else if (ratio < 0.7) {
        status = 'warn';
        recommendation = `Target CPA (${fmtCurrency(cfg.targetCpa)}) is ${Math.round((1 - ratio) * 100)}% below actual CPA (${fmtCurrency(actualCPA)}). Target may be too aggressive — consider raising it to get more volume.`;
      }
    } else if (strategy === 'MAXIMIZE_CONVERSIONS' && !cfg.targetCpa) {
      status = 'info';
      recommendation = 'No Target CPA set. Add a Target CPA to put a ceiling on costs and improve efficiency.';
    } else if (strategy === 'MAXIMIZE_CONVERSION_VALUE' && !cfg.targetRoas) {
      status = 'info';
      recommendation = 'No Target ROAS set. Add a Target ROAS to constrain spend and improve return.';
    }

    return {
      campaignId: cfg.campaignId,
      campaignName: cfg.campaignName,
      biddingStrategyType: strategy,
      budget: cfg.budget,
      targetCpa: cfg.targetCpa,
      targetRoas: cfg.targetRoas,
      actualCpa: actualCPA,
      conversions: actualConv,
      status,
      recommendation,
    };
  });
}

// ── Pillar 9: Asset coverage ──────────────────────────────────────────────────
const REQUIRED_ASSET_TYPES = ['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL', 'IMAGE'];

export function analyzeAssets(campaignAssets, campaigns) {
  const assetsByCampaign = {};
  campaignAssets.forEach((a) => {
    const id = String(a.campaignId);
    if (!assetsByCampaign[id]) assetsByCampaign[id] = new Set();
    assetsByCampaign[id].add(a.assetType);
  });

  return campaigns.map((c) => {
    const id = String(c.campaignId);
    const present = assetsByCampaign[id] || new Set();
    const presentTypes = REQUIRED_ASSET_TYPES.filter((t) => present.has(t));
    const missingTypes = REQUIRED_ASSET_TYPES.filter((t) => !present.has(t));
    const coverageScore = REQUIRED_ASSET_TYPES.length > 0
      ? presentTypes.length / REQUIRED_ASSET_TYPES.length
      : 1;

    return {
      campaignId: id,
      campaignName: c.campaignName,
      presentTypes,
      missingTypes,
      coverageScore,
    };
  });
}

// ── Extended action plan builder ──────────────────────────────────────────────
export function buildActionPlan(
  campaignAudits,
  searchTermAnalysis,
  structureData = null,
  keywordAnalysis = null,
  adStrengthData = null,
  biddingAudits = [],
  assetAnalysis = [],
  lrData = null,
  pmaxData = null,
) {
  const actions = [];

  campaignAudits.forEach((c) => {
    const { key } = c.verdict;

    if (key === 'SCALE') {
      const lostPct = Math.round((c.searchBudgetLostImpressionShare || 0) * 100);
      actions.push({
        category: 'Budget',
        issue: `"${c.campaignName}" is losing ${lostPct}% of impressions to budget limits`,
        fix: 'Increase daily budget. This campaign is profitable and demand exists — you are leaving conversions on the table.',
        path: 'Campaigns → Edit budget',
        impact: 9, confidence: 8, ease: 9,
      });
    }

    if (key === 'FIX_QS') {
      const lostPct = Math.round((c.searchRankLostImpressionShare || 0) * 100);
      actions.push({
        category: 'Bidding / QS',
        issue: `"${c.campaignName}" is losing ${lostPct}% of impressions to low Ad Rank`,
        fix: 'Do NOT add budget — that wastes money here. Instead: audit keyword QS, tighten ad group themes, improve ad relevance, or raise bids on high-value keywords.',
        path: 'Campaigns → Keywords → Quality Score column',
        impact: 8, confidence: 7, ease: 4,
      });
    }

    if (key === 'PAUSE') {
      actions.push({
        category: 'Campaign',
        issue: `"${c.campaignName}" spent ${fmtCurrency(c.cost)} with 0 conversions`,
        fix: 'Pause and review search terms for intent mismatch. Check conversion tracking. Reallocate budget to performing campaigns.',
        path: 'Campaigns → Status → Pause',
        impact: 7, confidence: 8, ease: 8,
      });
    }
  });

  if (searchTermAnalysis.wasteRatio > 0.08) {
    const top3 = searchTermAnalysis.wasted.slice(0, 3).map((t) => `"${t.term}"`).join(', ');
    actions.push({
      category: 'Search Terms',
      issue: `${fmtPct(searchTermAnalysis.wasteRatio)} of search term spend (${fmtCurrency(searchTermAnalysis.totalWastedCost)}) went to zero-conversion terms`,
      fix: `Add top wasted terms as negatives immediately: ${top3}. Review all zero-conversion terms over $10 spend.`,
      path: 'Search terms report → Select terms → Add as negative keyword',
      impact: 8, confidence: 9, ease: 8,
    });
  }

  if (structureData?.bloatedAdGroups?.length > 0) {
    const count = structureData.bloatedAdGroups.length;
    const examples = structureData.bloatedAdGroups.slice(0, 2).map((ag) => `"${ag.adGroupName}" (${ag.keywordCount} kws)`).join(', ');
    actions.push({
      category: 'Structure',
      issue: `${count} ad group${count > 1 ? 's have' : ' has'} more than 20 keywords: ${examples}`,
      fix: 'Split bloated ad groups into tighter themes. Tighter themes → better ad relevance → higher QS → lower CPA.',
      path: 'Ad Groups → select group → Keywords',
      impact: 6, confidence: 7, ease: 5,
    });
  }

  if (keywordAnalysis?.qs1to3?.length > 0) {
    const lowQsWithSpend = keywordAnalysis.qs1to3.filter((k) => (k.cost || 0) > 500_000);
    if (lowQsWithSpend.length > 0) {
      const totalSpend = lowQsWithSpend.reduce((s, k) => s + (k.cost || 0), 0);
      actions.push({
        category: 'Keywords',
        issue: `${lowQsWithSpend.length} keyword${lowQsWithSpend.length > 1 ? 's' : ''} with QS ≤3 spent ${fmtCurrency(totalSpend)} — poor Quality Score increases every click`,
        fix: 'For each low-QS keyword: tighten the ad group theme, rewrite ad copy to match keyword intent exactly, and improve the landing page relevance. Pause if QS cannot be improved.',
        path: 'Keywords → Quality Score column → sort ascending',
        impact: 8, confidence: 8, ease: 6,
      });
    }
  }

  if (keywordAnalysis?.matchTypeSpend?.BROAD > 0.6) {
    const broadPct = Math.round(keywordAnalysis.matchTypeSpend.BROAD * 100);
    actions.push({
      category: 'Match Types',
      issue: `Broad match accounts for ${broadPct}% of keyword spend — leaving Google with too much targeting latitude`,
      fix: 'Add phrase and exact match variants of top-performing search terms. Set broad match keywords to observation to identify what Google is actually matching.',
      path: 'Keywords → Match type column',
      impact: 7, confidence: 7, ease: 6,
    });
  }

  if (adStrengthData?.campaignsWithPoorAds?.length > 0) {
    const count = adStrengthData.campaignsWithPoorAds.length;
    const examples = adStrengthData.campaignsWithPoorAds.slice(0, 2).map((c) => `"${c.campaignName}"`).join(', ');
    actions.push({
      category: 'Ad Strength',
      issue: `${count} campaign${count > 1 ? 's have' : ' has'} POOR ad strength: ${examples}`,
      fix: 'Add more headlines (aim for 15) and descriptions (aim for 4). Make headlines distinct — avoid repeating the same theme. Include keywords in headlines.',
      path: 'Ads & extensions → Responsive Search Ads → Edit',
      impact: 7, confidence: 8, ease: 7,
    });
  }

  if (adStrengthData?.underHeadlined?.length > 0) {
    const count = adStrengthData.underHeadlined.length;
    actions.push({
      category: 'Ad Copy',
      issue: `${count} RSA${count > 1 ? 's have' : ' has'} fewer than 10 headlines`,
      fix: 'Add headlines up to 15. More unique headlines give Google more combinations to test. Include keywords, benefits, CTAs, and differentiators.',
      path: 'Ads → Responsive Search Ad → Edit → Add headlines',
      impact: 6, confidence: 8, ease: 8,
    });
  }

  if (adStrengthData?.pinnedCount > 0) {
    actions.push({
      category: 'Ad Copy',
      issue: `${adStrengthData.pinnedCount} RSA(s) have pinned headlines — this reduces ad strength`,
      fix: 'Remove pins unless legally required. Pinning forces Google to always show specific headlines in specific positions, severely limiting optimization.',
      path: 'Ads → Responsive Search Ad → Edit → Headlines → remove pin icons',
      impact: 5, confidence: 8, ease: 9,
    });
  }

  const manualCpcCandidates = biddingAudits.filter(
    (b) => b.biddingStrategyType === 'MANUAL_CPC' && !b.recommendation?.includes('deprecated') && b.conversions >= 30
  );
  if (manualCpcCandidates.length > 0) {
    const names = manualCpcCandidates.slice(0, 2).map((b) => `"${b.campaignName}"`).join(', ');
    actions.push({
      category: 'Bidding',
      issue: `${manualCpcCandidates.length} campaign${manualCpcCandidates.length > 1 ? 's are' : ' is'} on Manual CPC with 30+ conversions: ${names}`,
      fix: 'Switch to Target CPA or Maximize Conversions. With enough conversion data, Smart Bidding consistently outperforms manual bidding by adjusting bids for every auction signal.',
      path: 'Campaigns → Settings → Bidding',
      impact: 8, confidence: 8, ease: 7,
    });
  }

  const missingSitelinks = assetAnalysis.filter((a) => a.missingTypes.includes('SITELINK'));
  if (missingSitelinks.length > 0) {
    actions.push({
      category: 'Assets',
      issue: `${missingSitelinks.length} campaign${missingSitelinks.length > 1 ? 's are' : ' is'} missing sitelink extensions`,
      fix: 'Add at least 4 sitelinks per campaign. Sitelinks improve CTR by giving users more paths to convert and take up more SERP real estate.',
      path: 'Ads & extensions → Extensions → Sitelinks',
      impact: 6, confidence: 9, ease: 9,
    });
  }

  const missingCallouts = assetAnalysis.filter((a) => a.missingTypes.includes('CALLOUT'));
  if (missingCallouts.length > 0) {
    actions.push({
      category: 'Assets',
      issue: `${missingCallouts.length} campaign${missingCallouts.length > 1 ? 's are' : ' is'} missing callout extensions`,
      fix: 'Add 4–10 callout extensions highlighting your key benefits (e.g. "Free Shipping", "24/7 Support"). They cost nothing and improve ad visibility.',
      path: 'Ads & extensions → Extensions → Callouts',
      impact: 5, confidence: 9, ease: 9,
    });
  }

  if (lrData?.lrRatio != null && lrData.lrRatio > 2.5) {
    actions.push({
      category: 'Efficiency',
      issue: `L/R ratio is ${lrData.lrRatio.toFixed(2)} — blended CPA (${fmtCurrency(lrData.blendedCPA)}) is more than 2.5× converting keyword CPA (${fmtCurrency(lrData.convertingKeywordCPA)})`,
      fix: 'Too much spend is on non-converting keywords, campaigns, or match types. Pause zero-conversion keywords, add negatives for wasted search terms, and shift budget to proven converters.',
      path: 'Keywords → Columns → Conversions → sort by cost, filter conv = 0',
      impact: 8, confidence: 7, ease: 5,
    });
  }

  if (pmaxData) {
    pmaxData.forEach((p) => {
      if (!p.hasBrandExclusion) {
        actions.push({
          category: 'PMax',
          issue: `"${p.campaignName}" has no brand exclusion — PMax will bid on your brand terms and inflate CPA`,
          fix: 'Add brand exclusion list to this PMax campaign to prevent cannibalizing branded search campaigns.',
          path: 'Campaign settings → Brand exclusions → Add brand',
          impact: 9, confidence: 9, ease: 7,
        });
      }
      if (p.poorAssetGroups.length > 0) {
        actions.push({
          category: 'PMax',
          issue: `"${p.campaignName}" has ${p.poorAssetGroups.length} asset group(s) with poor/average strength`,
          fix: 'Add more asset variety: 15 headlines, 5 descriptions, 5 landscape images, 5 square images, 5 logos, 1+ video.',
          path: 'Campaigns → Asset groups → Edit assets',
          impact: 7, confidence: 8, ease: 6,
        });
      }
    });
  }

  return actions
    .map((a) => ({ ...a, ice: a.impact * a.confidence * a.ease }))
    .sort((a, b) => b.ice - a.ice);
}

// ── Main audit runner ─────────────────────────────────────────────────────────
export function runAudit(accountData, auditData = null, campaignId = null) {
  const campaignFilter = campaignId ? (c) => String(c.campaignId) === String(campaignId) : () => true;

  const campaigns = (accountData.campaigns || []).filter(campaignFilter);

  const searchTerms = campaignId
    ? ((accountData.campaigns || []).find((c) => String(c.campaignId) === String(campaignId))?.searchTerms || [])
    : (accountData.searchTerms || []);

  const keywords = auditData
    ? (auditData.keywords || []).filter(campaignId ? (k) => String(k.campaignId) === String(campaignId) : () => true)
    : [];

  const campaignConfig = auditData
    ? (auditData.campaignConfig || []).filter(campaignId ? (c) => String(c.campaignId) === String(campaignId) : () => true)
    : [];

  const campaignAssets = auditData
    ? (auditData.campaignAssets || []).filter(campaignId ? (a) => String(a.campaignId) === String(campaignId) : () => true)
    : [];

  const adStrengthRaw = auditData
    ? (auditData.adStrength || []).filter(campaignId ? (a) => String(a.campaignId) === String(campaignId) : () => true)
    : [];

  const pmaxAssetGroups = auditData
    ? (auditData.pmaxAssetGroups || []).filter(campaignId ? (a) => String(a.campaignId) === String(campaignId) : () => true)
    : [];

  const pmaxBrandExclusions = auditData
    ? (auditData.pmaxBrandExclusions || []).filter(campaignId ? (a) => String(a.campaignId) === String(campaignId) : () => true)
    : [];

  const totalCost        = campaigns.reduce((s, c) => s + (c.cost || 0), 0);
  const totalConversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalClicks      = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const blendedCPA       = totalConversions > 0 ? totalCost / totalConversions : null;

  const campaignAudits = campaigns.map((c) => ({
    ...c,
    verdict: getCampaignVerdict(c),
    cpa: c.conversions > 0 ? c.cost / c.conversions : null,
  }));

  const stTerms = analyzeSearchTerms(searchTerms, keywords);

  const structureData       = auditData ? analyzeStructure(campaigns, keywords) : null;
  const lrData              = auditData ? computeLRRatio(campaigns, keywords) : null;
  const keywordAnalysis     = auditData ? analyzeKeywords(keywords) : null;
  const adStrengthAnalysis  = auditData ? analyzeAdStrength(adStrengthRaw, campaigns) : null;
  const biddingAudits       = auditData ? analyzeBidding(campaignConfig, campaigns) : [];
  const assetAnalysis       = auditData ? analyzeAssets(campaignAssets, campaigns) : [];
  const pmaxData            = auditData ? analyzePMax(campaigns, pmaxAssetGroups, pmaxBrandExclusions) : null;

  const actionPlan = buildActionPlan(
    campaignAudits,
    stTerms,
    structureData,
    keywordAnalysis,
    adStrengthAnalysis,
    biddingAudits,
    assetAnalysis,
    lrData,
    pmaxData,
  );

  return {
    summary: {
      totalCost,
      totalConversions,
      totalClicks,
      blendedCPA,
      campaignCount:     campaigns.length,
      optimizationScore: accountData.optimizationScore,
      criticalCount:     actionPlan.filter((a) => a.ice >= 500).length,
      warningCount:      actionPlan.filter((a) => a.ice >= 200 && a.ice < 500).length,
      lrRatio:           lrData?.lrRatio ?? null,
    },
    campaigns:   campaignAudits,
    structure:   structureData,
    keywords:    keywordAnalysis,
    searchTerms: stTerms,
    bidding:     biddingAudits,
    assets:      assetAnalysis,
    adStrength:  adStrengthAnalysis,
    pmaxData,
    actionPlan,
    recommendations: accountData.recommendations || [],
  };
}
