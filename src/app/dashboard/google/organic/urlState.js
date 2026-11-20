// URL <-> controls for the Organic Search (Search Console) page. Pure, no React.
import { PRESETS, isValidRange } from "@/lib/ga4Dates";
import { SEARCH_TYPES } from "@/lib/gscReport";

const RANGE_KEYS = PRESETS.map((p) => p.key);
const TYPE_KEYS = SEARCH_TYPES.map((t) => t.key);
export const COMPARES = ["prev", "yoy", "none"];
export const GRANULARITIES = ["day", "week", "month"];
export const TABS = ["queries", "pages", "groups", "opportunities", "cannibalization", "audience", "indexing"];

export const DEFAULTS = { rangeKey: "last_28", compare: "prev", type: "web", tab: "queries" };

export function parseParams(sp) {
  const get = (k) => sp.get(k);
  let rangeKey = RANGE_KEYS.includes(get("range")) ? get("range") : DEFAULTS.rangeKey;
  let custom = null;
  if (rangeKey === "custom") {
    const c = { startDate: get("start") || "", endDate: get("end") || "" };
    if (isValidRange(c)) custom = c;
    else rangeKey = DEFAULTS.rangeKey;
  }
  const site = get("site") || "";
  return {
    site: /^(sc-domain:|https?:\/\/)/.test(site) ? site : null,
    rangeKey,
    custom,
    compare: COMPARES.includes(get("compare")) ? get("compare") : DEFAULTS.compare,
    type: TYPE_KEYS.includes(get("type")) ? get("type") : DEFAULTS.type,
    tab: TABS.includes(get("tab")) ? get("tab") : DEFAULTS.tab,
    gran: GRANULARITIES.includes(get("gran")) ? get("gran") : null,
  };
}

export function buildQuery({ site, rangeKey, custom, compare, type, tab, gran }) {
  const p = new URLSearchParams();
  p.set("site", site);
  p.set("range", rangeKey);
  if (rangeKey === "custom" && custom) {
    p.set("start", custom.startDate);
    p.set("end", custom.endDate);
  }
  p.set("compare", compare);
  if (type !== DEFAULTS.type) p.set("type", type);
  if (tab !== DEFAULTS.tab) p.set("tab", tab);
  if (gran) p.set("gran", gran);
  return `?${p.toString()}`;
}

export function siteLabel(url) {
  return String(url || "").replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function siteKind(url) {
  return String(url || "").startsWith("sc-domain:") ? "Domain property" : "URL prefix";
}
