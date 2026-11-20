// Search Console reports countries as lowercase ISO 3166-1 alpha-3 codes ('usa').
// Maps them to display names via Intl (which needs alpha-2).
const A3_TO_A2 = {
  usa: 'US', can: 'CA', mex: 'MX', gbr: 'GB', irl: 'IE', aus: 'AU', nzl: 'NZ', ind: 'IN', pak: 'PK',
  bgd: 'BD', phl: 'PH', idn: 'ID', mys: 'MY', sgp: 'SG', tha: 'TH', vnm: 'VN', chn: 'CN', hkg: 'HK',
  twn: 'TW', jpn: 'JP', kor: 'KR', deu: 'DE', fra: 'FR', esp: 'ES', prt: 'PT', ita: 'IT', nld: 'NL',
  bel: 'BE', che: 'CH', aut: 'AT', swe: 'SE', nor: 'NO', dnk: 'DK', fin: 'FI', pol: 'PL', cze: 'CZ',
  rou: 'RO', hun: 'HU', grc: 'GR', tur: 'TR', ukr: 'UA', rus: 'RU', isr: 'IL', are: 'AE', sau: 'SA',
  qat: 'QA', egy: 'EG', nga: 'NG', ken: 'KE', zaf: 'ZA', gha: 'GH', mar: 'MA', bra: 'BR', arg: 'AR',
  chl: 'CL', col: 'CO', per: 'PE', ven: 'VE', ecu: 'EC', dom: 'DO', pri: 'PR', jam: 'JM', cri: 'CR',
  gtm: 'GT', slv: 'SV', hnd: 'HN', pan: 'PA', cub: 'CU', npl: 'NP', lka: 'LK', irn: 'IR', irq: 'IQ',
  jor: 'JO', lbn: 'LB', kwt: 'KW', omn: 'OM', bhr: 'BH', dza: 'DZ', tun: 'TN', eth: 'ET', uga: 'UG',
  tza: 'TZ', zwe: 'ZW', cmr: 'CM', civ: 'CI', sen: 'SN', bgr: 'BG', srb: 'RS', hrv: 'HR', svk: 'SK',
  svn: 'SI', ltu: 'LT', lva: 'LV', est: 'EE', isl: 'IS', lux: 'LU', mlt: 'MT', cyp: 'CY', kaz: 'KZ',
  uzb: 'UZ', aze: 'AZ', geo: 'GE', arm: 'AM', khm: 'KH', mmr: 'MM', bol: 'BO', pry: 'PY', ury: 'UY',
  tto: 'TT', bhs: 'BS', brb: 'BB', gum: 'GU', vir: 'VI', afg: 'AF',
};

let names = null;

export function countryName(code) {
  const c = String(code || '').toLowerCase();
  if (!c || c === 'zzz') return 'Unknown';
  const a2 = A3_TO_A2[c];
  if (a2) {
    try {
      names = names || new Intl.DisplayNames(['en'], { type: 'region' });
      return names.of(a2) || c.toUpperCase();
    } catch {
      return c.toUpperCase();
    }
  }
  return c.toUpperCase();
}

// Search appearance enum -> readable label.
const APPEARANCE = {
  AMP_BLUE_LINK: 'AMP (non-rich)',
  AMP_TOP_STORIES: 'AMP top stories',
  RICHCARD: 'Rich card',
  REVIEW_SNIPPET: 'Review snippet',
  FAQ_RICH_RESULT: 'FAQ rich result',
  HOWTO_RICH_RESULT: 'How-to rich result',
  PRODUCT_SNIPPETS: 'Product snippets',
  MERCHANT_LISTINGS: 'Merchant listings',
  VIDEO: 'Videos',
  TRANSLATED_RESULT: 'Translated result',
  RECIPE_FEATURE: 'Recipe',
  JOB_LISTING: 'Job listing',
  EVENT: 'Event',
  ORGANIC_SHOPPING: 'Shopping (free listing)',
  WEBLITE: 'Web Light',
};

export function appearanceName(key) {
  if (APPEARANCE[key]) return APPEARANCE[key];
  const s = String(key || '').replace(/_/g, ' ').toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}
