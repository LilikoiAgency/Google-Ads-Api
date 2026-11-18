// URL <-> controls for the Web Traffic (GA4) page. Pure, no React.
import { VIEWS } from "@/lib/ga4Channels";
import { PRESETS, isValidRange } from "@/lib/ga4Dates";

const RANGE_KEYS = PRESETS.map((p) => p.key);
const VIEW_KEYS = VIEWS.map((v) => v.key);
export const COMPARES = ["prev", "yoy", "none"];
export const GRANULARITIES = ["day", "week", "month"];

export const DEFAULTS = { rangeKey: "last_month", compare: "prev", view: "nonPaid" };

// Browser-local date as YYYY-MM-DD (not toISOString, which is UTC).
export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// URLSearchParams -> initial controls. Anything unknown or invalid falls back
// to the default instead of failing.
export function parseParams(sp) {
  const get = (k) => sp.get(k);
  let rangeKey = RANGE_KEYS.includes(get("range")) ? get("range") : DEFAULTS.rangeKey;
  let custom = null;
  if (rangeKey === "custom") {
    const c = { startDate: get("start") || "", endDate: get("end") || "" };
    if (isValidRange(c)) custom = c;
    else rangeKey = DEFAULTS.rangeKey;
  }
  return {
    property: /^properties\/\d+$/.test(get("property") || "") ? get("property") : null,
    rangeKey,
    custom,
    compare: COMPARES.includes(get("compare")) ? get("compare") : DEFAULTS.compare,
    view: VIEW_KEYS.includes(get("view")) ? get("view") : DEFAULTS.view,
    gran: GRANULARITIES.includes(get("gran")) ? get("gran") : null,
  };
}

// Controls -> query string (with leading '?'). gran only when overridden.
export function buildQuery({ property, rangeKey, custom, compare, view, gran }) {
  const p = new URLSearchParams();
  p.set("property", property);
  p.set("range", rangeKey);
  if (rangeKey === "custom" && custom) {
    p.set("start", custom.startDate);
    p.set("end", custom.endDate);
  }
  p.set("compare", compare);
  p.set("view", view);
  if (gran) p.set("gran", gran);
  return `?${p.toString()}`;
}

// Which property to show: the current one if still listed, else the URL's
// (first resolution only), else the last one used, else the first.
export function resolveProperty({ properties, current, fromUrl, stored }) {
  if (!properties?.length) return null;
  const listed = (id) => !!id && properties.some((p) => p.id === id);
  if (listed(current)) return current;
  if (current === null && listed(fromUrl)) return fromUrl;
  if (listed(stored)) return stored;
  return properties[0].id;
}
