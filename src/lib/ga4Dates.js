// Pure date helpers for GA4 reports. All dates are 'YYYY-MM-DD' strings and
// all math is done in UTC so results never depend on the machine time zone.

export const PRESETS = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_7', label: 'Last 7 days' },
  { key: 'last_28', label: 'Last 28 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;
const MAX_SPAN_DAYS = 3 * 366;

function parse(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

function fmt(ms) {
  const dt = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(dt.getUTCFullYear(), 4)}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

function addDays(str, n) {
  return fmt(parse(str) + n * DAY_MS);
}

function daysInclusive(startDate, endDate) {
  return Math.round((parse(endDate) - parse(startDate)) / DAY_MS) + 1;
}

function lastDayOfMonth(y, m1) {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate(); // m1 is 1-based month
}

function isFullMonth({ startDate, endDate }) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  return sd === 1 && sy === ey && sm === em && ed === lastDayOfMonth(ey, em);
}

function monthRange(y, m1) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    startDate: `${String(y).padStart(4, '0')}-${p(m1)}-01`,
    endDate: `${String(y).padStart(4, '0')}-${p(m1)}-${p(lastDayOfMonth(y, m1))}`,
  };
}

export function presetRange(key, today) {
  const t = parse(today);
  if (t === null) return null;
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'this_month':
      return { startDate: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`, endDate: today };
    case 'last_month':
      return m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1);
    case 'last_7':
    case 'last_28':
    case 'last_90': {
      const n = Number(key.split('_')[1]);
      return { startDate: addDays(today, -n), endDate: addDays(today, -1) };
    }
    case 'ytd':
      return { startDate: `${String(y).padStart(4, '0')}-01-01`, endDate: today };
    default:
      return null;
  }
}

export function compareRange(range, mode) {
  if (mode !== 'prev' && mode !== 'yoy') return null;
  if (!range || parse(range.startDate) === null || parse(range.endDate) === null) return null;
  const { startDate, endDate } = range;
  if (mode === 'prev') {
    if (isFullMonth(range)) {
      const [y, m] = startDate.split('-').map(Number);
      return m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1);
    }
    const len = daysInclusive(startDate, endDate);
    return { startDate: addDays(startDate, -len), endDate: addDays(startDate, -1) };
  }
  const shift = (str) => {
    const [y, m, d] = str.split('-').map(Number);
    const day = Math.min(d, lastDayOfMonth(y - 1, m)); // Feb 29 -> Feb 28
    return `${String(y - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  return { startDate: shift(startDate), endDate: shift(endDate) };
}

export function autoGranularity({ startDate, endDate }) {
  const days = daysInclusive(startDate, endDate);
  if (days <= 92) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

export function isValidRange(range) {
  if (!range) return false;
  const s = parse(range.startDate);
  const e = parse(range.endDate);
  if (s === null || e === null || s > e) return false;
  return daysInclusive(range.startDate, range.endDate) <= MAX_SPAN_DAYS;
}

export function rangeLabel(range) {
  const { startDate, endDate } = range;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (startDate === endDate) return `${MONTHS[sm - 1]} ${sd}, ${sy}`;
  if (isFullMonth(range)) return `${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}
