// radar-3 model: a token launch radar whose implied values are FITTED from
// already-trading tokens, validated in four ways, and netted to dollars.
// Everything here is computed from the sealed snapshot only: no network, no
// clock, no randomness except a fixed-seed LCG for the bootstrap. A protocol
// name is never special-cased anywhere in this file.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Fit {
  a: number;
  b: number;
  r2: number;
  n: number;
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface EnrichedRow extends Row {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  watchlist: boolean;
  base_value_usd: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  fit_category: string;
  fit_a: number;
  fit_b: number;
  fit_r2: number;
  fit_anchors: number;
  rank_p10: number;
  rank_p90: number;
  capital_usd: number;
  gas_per_tx_usd: number;
  gas_total_usd: number;
  expected_value_usd: number;
  verdict: string;
  break_even_implied_usd: number;
  hold_days: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  symbol: string;
  change_7d: number | null;
  age_days: number | null;
  mcap_per_tvl: number | null;
}

export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  reason: string;
}

export interface ValidationMetrics {
  n_train: number;
  n_test: number;
  mape: number | null;
  median_ape: number | null;
  spearman: number | null;
  note: string;
}

export interface Validation {
  blind: ValidationMetrics;
  walk_forward: ValidationMetrics;
  loo_mean_ape: number | null;
  loo_n: number;
  bootstrap_iters: number;
  bootstrap_slope_mean: number | null;
  bootstrap_slope_p10: number | null;
  bootstrap_slope_p90: number | null;
}

export interface RadarData {
  meta: {
    model: string;
    as_of: string;
    source: string;
    floor_usd: number;
    total_protocols: number;
    watchlist_count: number;
    ranked_count: number;
    anchor_count: number;
    traded_count: number;
    excluded_count: number;
  };
  global_fit: Fit;
  category_fits: { category: string; a: number; b: number; r2: number; n: number }[];
  validation: Validation;
  gas_table: { chain: string; usd_per_tx: number }[];
  assumptions: string[];
  rows: EnrichedRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
  accounting: { reason: string; count: number }[];
}

/** Parse and minimally validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: unexpected shape');
  }
  return raw;
}

/** FNV-1a 32-bit hash, used only to split anchors deterministically. */
export function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Whole days from a YYYY-MM-DD date to the snapshot date; null when unknown. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** A protocol records a token when DefiLlama carries a gecko id or a symbol for it
 *  (both null = records no token). */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Anchors: traded tokens with a market cap, one per ticker (highest TVL wins). */
export function anchorsOf(snapshot: Snapshot): Protocol[] {
  const bySymbol = new Map<string, Protocol>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || !recordsToken(p) || p.tvl_usd <= 0) continue;
    const key = (p.symbol as string).toLowerCase();
    const cur = bySymbol.get(key);
    if (!cur || p.tvl_usd > cur.tvl_usd) bySymbol.set(key, p);
  }
  return [...bySymbol.values()].sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
}

/** Ordinary least squares on log(mcap) = a + b * log(tvl). */
export function ols(points: { x: number; y: number }[]): Fit {
  const n = points.length;
  if (n === 0) return { a: 0, b: 0, r2: 0, n: 0 };
  let sx = 0;
  let sy = 0;
  for (const pt of points) {
    sx += pt.x;
    sy += pt.y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const pt of points) {
    const dx = pt.x - mx;
    const dy = pt.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssRes = 0;
  for (const pt of points) {
    const e = pt.y - (a + b * pt.x);
    ssRes += e * e;
  }
  const r2 = syy === 0 ? 0 : Math.max(0, 1 - ssRes / syy);
  return { a, b, r2, n };
}

export interface Fits {
  global: Fit;
  byCategory: Map<string, Fit>;
}

/** Fit the size curve globally and per category (needs >= 5 anchors, else global). */
export function fitAll(anchors: Protocol[]): Fits {
  const pts = anchors.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd as number) }));
  const global = ols(pts);
  const byCategory = new Map<string, Fit>();
  const groups = new Map<string, Protocol[]>();
  for (const p of anchors) {
    const cat = p.category ?? 'Uncategorised';
    const arr = groups.get(cat);
    if (arr) arr.push(p);
    else groups.set(cat, [p]);
  }
  for (const [cat, members] of [...groups.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (members.length >= 5) {
      byCategory.set(
        cat,
        ols(members.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd as number) }))),
      );
    }
  }
  return { global, byCategory };
}

/** The fit that prices one protocol: its category fit, or the global fit. */
export function fitFor(fits: Fits, category: string | null): { fit: Fit; name: string } {
  const cat = category ?? 'Uncategorised';
  const f = fits.byCategory.get(cat);
  if (f) return { fit: f, name: cat };
  return { fit: fits.global, name: 'global' };
}

export function baseValue(fits: Fits, p: Protocol): { base: number; fitName: string; fit: Fit } {
  const { fit, name } = fitFor(fits, p.category);
  const base = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd));
  return { base, fitName: name, fit };
}

export interface Multipliers {
  growth: number;
  maturity: number;
  breadth: number;
  age_days: number | null;
  age_for_model: number;
}

/** Transparent snapshot functions, stated on the dashboard. */
export function multipliers(p: Protocol, asOf: string): Multipliers {
  const change = p.change_7d === null ? 0 : Math.min(120, Math.max(-60, p.change_7d));
  const growth = 1 + (change / 100) * 0.5;
  const age = ageDays(p.listed_at, asOf);
  const ageForModel = age === null ? 365 : age;
  const maturity = 0.6 + (Math.min(ageForModel, 1095) / 1095) * 0.4;
  const breadth = 1 + 0.05 * Math.min(Math.max(p.chains.length - 1, 0), 4);
  return { growth, maturity, breadth, age_days: age, age_for_model: ageForModel };
}

/** Full implied value with its factor breakdown. */
export function impliedOf(fits: Fits, p: Protocol, asOf: string): {
  implied: number;
  base: number;
  growth: number;
  maturity: number;
  breadth: number;
  age_days: number | null;
  fitName: string;
  fit: Fit;
} {
  const { base, fitName, fit } = baseValue(fits, p);
  const m = multipliers(p, asOf);
  const raw = base * m.growth * m.maturity * m.breadth;
  const implied = Math.max(1, Math.min(1e14, Math.round(raw)));
  return { implied, base, growth: m.growth, maturity: m.maturity, breadth: m.breadth, age_days: m.age_days, fitName, fit };
}

// ---- coverage: who is ranked, who is set aside, and why --------------------

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const EXCHANGE_FIRST_WORDS = new Set([
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
]);

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a no-token protocol is NOT on the ranked board, or null when it is ranked. */
export function exclusionReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSION_SUFFIX.test(p.name)) return 'name ends in a version marker';
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped / staked / staking';
  const first = p.name.trim().split(/[\s\-]/)[0].toLowerCase();
  if (EXCHANGE_FIRST_WORDS.has(first)) return 'name begins with an exchange name';
  return null;
}

/** Ranked board = every protocol that records no token, minus the exclusions above. */
export function rankedOf(snapshot: Snapshot): Protocol[] {
  return snapshot.protocols
    .filter((p) => !recordsToken(p) && exclusionReason(p) === null)
    .sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
}

// ---- farm plans, netted to dollars ----------------------------------------

/** Mid-point gas cost per transaction, by chain. Stated on the dashboard. */
export const GAS_TABLE: { chain: string; usd_per_tx: number }[] = [
  { chain: 'Ethereum', usd_per_tx: 5.5 },
  { chain: 'Solana', usd_per_tx: 0.05 },
  { chain: 'Base', usd_per_tx: 0.05 },
  { chain: 'Arbitrum', usd_per_tx: 0.1 },
  { chain: 'Optimism', usd_per_tx: 0.1 },
  { chain: 'Polygon', usd_per_tx: 0.05 },
  { chain: 'BSC', usd_per_tx: 0.1 },
  { chain: 'Avalanche', usd_per_tx: 0.1 },
  { chain: 'zkSync Era', usd_per_tx: 0.1 },
  { chain: 'Linea', usd_per_tx: 0.1 },
  { chain: 'Scroll', usd_per_tx: 0.1 },
  { chain: 'Blast', usd_per_tx: 0.05 },
  { chain: 'Sui', usd_per_tx: 0.05 },
  { chain: 'Aptos', usd_per_tx: 0.05 },
  { chain: 'Any other chain', usd_per_tx: 0.5 },
];

const GAS_LOOKUP = new Map(GAS_TABLE.map((g) => [g.chain.toLowerCase(), g.usd_per_tx]));

export function gasPerTx(chains: string[]): number {
  if (chains.length === 0) return 0.5;
  let sum = 0;
  for (const c of chains) sum += GAS_LOOKUP.get(c.toLowerCase()) ?? 0.5;
  return sum / chains.length;
}

/** Working capital, tiered by TVL. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** Days of activity before judging the farm, by protocol age. */
export function holdDaysFor(ageForModel: number): number {
  if (ageForModel < 180) return 60;
  if (ageForModel < 365) return 45;
  return 30;
}

export const FARM_TX_COUNT = 8;
export const FARMER_SHARE = 0.05;

const CATEGORY_ACTION: Record<string, string> = {
  Dexs: 'swap and provide liquidity in its largest pool',
  Lending: 'supply collateral and borrow a small amount against it',
  Yield: 'deposit into its highest-TVL vault and let yield accrue',
  'Yield Aggregator': 'deposit into its auto-compounding vault',
  Derivatives: 'open a small hedged position on its main market',
  RWA: 'mint or hold its tokenised real-world asset position',
  CDP: 'open a collateralised debt position with a safe ratio',
  Restaking: 'restake through its main restaking pool',
  'Liquid Staking': 'stake through its liquid staking token',
  Bridge: 'bridge a small amount through its canonical route',
  'Cross Chain Bridge': 'bridge a small amount across its busiest route',
  'NFT Marketplace': 'list and trade one low-value NFT through it',
  Launchpad: 'join its next launch allocation with the minimum ticket',
  Payments: 'route a real payment through its rails',
  'Prediction Market': 'place small positions on its most liquid market',
  Insurance: 'buy cover for a position you already hold',
  Farm: 'stake LP tokens in its farm for the full window',
  Indexes: 'buy its index token and hold it for the window',
  Options: 'write or buy one small covered option position',
  Privacy: 'run one private transaction through its mixer or shielded pool',
  'AI Agents': 'use its agent service for one real task end to end',
  'Decentralized AI': 'run one inference or training job through it',
  Staking: 'stake the minimum and keep it staked for the window',
  'Staking Pool': 'stake the minimum in its pool for the window',
};

export function categoryAction(category: string | null): string {
  if (category && CATEGORY_ACTION[category]) return CATEGORY_ACTION[category];
  return 'use its core product with a real transaction';
}

export interface FarmPlan {
  capital: number;
  gasPerTx: number;
  gasTotal: number;
  expectedValue: number;
  verdict: string;
  breakEven: number;
  holdDays: number;
  steps: string[];
}

function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n * 100) / 100}`;
}

function money(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

/** Six concrete farm steps, each carrying the protocol's own numbers. */
export function farmPlan(p: Protocol, implied: number, ageForModel: number): FarmPlan {
  const capital = capitalFor(p.tvl_usd);
  const gasTx = Math.round(gasPerTx(p.chains) * 100) / 100;
  const gasTotal = Math.round(gasTx * FARM_TX_COUNT * 100) / 100;
  const expectedValue = Math.round((implied * FARMER_SHARE - gasTotal) * 100) / 100;
  const verdict = expectedValue > 50 ? 'FARM' : expectedValue > 0 ? 'THIN' : 'SKIP';
  const breakEven = Math.round(gasTotal / FARMER_SHARE);
  const holdDays = holdDaysFor(ageForModel);
  const chainList = p.chains.length > 0 ? p.chains.slice(0, 4).join(', ') : 'its main chain';
  const action = categoryAction(p.category);
  const cat = p.category ?? 'uncategorised';
  const steps = [
    `Set up a fresh wallet for ${p.name} only, write the seed on paper and keep it offline, then fund it with ${money(capital)} on ${chainList} — never reuse a wallet that holds other funds.`,
    `On ${chainList}, ${action} with ${money(capital)} of capital; this is transaction 1 of ${FARM_TX_COUNT} planned, at about ${money(gasTx)} gas each on these chains.`,
    `Repeat real activity every few days for ${holdDays} days (${FARM_TX_COUNT} transactions in total, about ${money(gasTotal)} gas): vary the size and the day so the activity reads as a genuine user, not a script.`,
    `Track every transaction hash and fee in a note; total gas so far must stay near ${money(gasTotal)} — if one chain's fee jumps above ${money(gasTx * 3)} per transaction, pause and switch to the cheapest of ${chainList}.`,
    `Never pay anyone to claim, never connect to a link from a DM, and never share the seed: ${p.name} records no token, so any "claim" page asking for a fee or a signature before a launch is a scam.`,
    `Verdict ${verdict}: expected value ${money(expectedValue)} (5% of the ${usd(implied)} implied value, less ${money(gasTotal)} gas) over ${holdDays} days; only farm if the implied value stays above the ${usd(breakEven)} break-even, and walk away if it falls below it.`,
  ];
  return { capital, gasPerTx: gasTx, gasTotal, expectedValue, verdict, breakEven, holdDays, steps };
}

// ---- validation ------------------------------------------------------------

function ranksOf(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ra = ranksOf(a);
  const rb = ranksOf(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) * (ra[i] - ma);
    db += (rb[i] - mb) * (rb[i] - mb);
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

function apeStats(actual: number[], predicted: number[]): { mape: number; median: number } {
  const apes = actual.map((a, i) => Math.abs(predicted[i] - a) / a).sort((x, y) => x - y);
  const mape = apes.reduce((s, v) => s + v, 0) / apes.length;
  const mid = Math.floor(apes.length / 2);
  const median = apes.length % 2 === 1 ? apes[mid] : (apes[mid - 1] + apes[mid]) / 2;
  return { mape, median };
}

function evaluateSplit(train: Protocol[], test: Protocol[], asOf: string, label: string): ValidationMetrics {
  if (train.length < 10 || test.length < 5) {
    return {
      n_train: train.length,
      n_test: test.length,
      mape: null,
      median_ape: null,
      spearman: null,
      note: `${label}: too few anchors to be meaningful (${train.length} train / ${test.length} test)`,
    };
  }
  const fits = fitAll(train);
  const actual = test.map((p) => p.mcap_usd as number);
  const predicted = test.map((p) => Math.exp(fitFor(fits, p.category).fit.a + fitFor(fits, p.category).fit.b * Math.log(p.tvl_usd)));
  const { mape, median } = apeStats(actual, predicted);
  return {
    n_train: train.length,
    n_test: test.length,
    mape,
    median_ape: median,
    spearman: spearman(actual, predicted),
    note: `${label}: fitted on ${train.length} anchors, tested on ${test.length}`,
  };
}

/** Fixed-seed LCG (Numerical Recipes constants) for the bootstrap. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

export function validateModel(anchors: Protocol[], ranked: Protocol[], asOf: string): Validation {
  // (a) blind holdout: deterministic 70/30 split by hash of slug.
  const train = anchors.filter((p) => hashSlug(p.slug) % 10 < 7);
  const test = anchors.filter((p) => hashSlug(p.slug) % 10 >= 7);
  const blind = evaluateSplit(train, test, asOf, 'Blind holdout');

  // (b) walk-forward: fit on older listings, test on newer ones.
  const dated = anchors.filter((p) => p.listed_at !== null).sort((x, y) => ((x.listed_at as string) < (y.listed_at as string) ? -1 : 1));
  let walkForward: ValidationMetrics;
  if (dated.length >= 15) {
    const medianDate = dated[Math.floor(dated.length / 2)].listed_at as string;
    const older = dated.filter((p) => (p.listed_at as string) <= medianDate);
    const newer = dated.filter((p) => (p.listed_at as string) > medianDate);
    walkForward = evaluateSplit(older, newer, asOf, `Walk-forward (split ${medianDate})`);
  } else {
    walkForward = {
      n_train: 0,
      n_test: dated.length,
      mape: null,
      median_ape: null,
      spearman: null,
      note: `Walk-forward: too few dated anchors (${dated.length}) to be meaningful`,
    };
  }

  // (c) leave-one-out: refit without each anchor, report mean absolute % error.
  let looMean: number | null = null;
  if (anchors.length >= 10) {
    let sum = 0;
    for (const held of anchors) {
      const rest = anchors.filter((p) => p.slug !== held.slug);
      const fits = fitAll(rest);
      const f = fitFor(fits, held.category).fit;
      const pred = Math.exp(f.a + f.b * Math.log(held.tvl_usd));
      sum += Math.abs(pred - (held.mcap_usd as number)) / (held.mcap_usd as number);
    }
    looMean = sum / anchors.length;
  }

  // (d) bootstrap: 200 refits on resampled anchors; rank range p10-p90 per protocol.
  const iters = 200;
  const rand = lcg(20261114);
  const rankSamples = new Map<string, number[]>();
  for (const p of ranked) rankSamples.set(p.slug, []);
  const slopes: number[] = [];
  for (let it = 0; it < iters; it++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < anchors.length; i++) sample.push(anchors[Math.floor(rand() * anchors.length)]);
    const fits = fitAll(sample);
    slopes.push(fits.global.b);
    const scored = ranked
      .map((p) => ({ slug: p.slug, implied: impliedOf(fits, p, asOf).implied }))
      .sort((x, y) => y.implied - x.implied || (x.slug < y.slug ? -1 : 1));
    scored.forEach((s, idx) => rankSamples.get(s.slug)?.push(idx + 1));
  }
  slopes.sort((a, b) => a - b);
  const rankRanges = new Map<string, { p10: number; p90: number }>();
  for (const [slug, arr] of rankSamples) {
    const sorted = [...arr].sort((a, b) => a - b);
    rankRanges.set(slug, { p10: quantile(sorted, 0.1), p90: quantile(sorted, 0.9) });
  }
  // Stash ranges on the module-level holder buildRadar reads.
  bootstrapRankRanges = rankRanges;

  return {
    blind,
    walk_forward: walkForward,
    loo_mean_ape: looMean,
    loo_n: anchors.length,
    bootstrap_iters: iters,
    bootstrap_slope_mean: slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : null,
    bootstrap_slope_p10: slopes.length > 0 ? quantile(slopes, 0.1) : null,
    bootstrap_slope_p90: slopes.length > 0 ? quantile(slopes, 0.9) : null,
  };
}

let bootstrapRankRanges = new Map<string, { p10: number; p90: number }>();

// ---- assemble the whole radar ------------------------------------------------

export interface BuiltRadar {
  board: Row[];
  radar: RadarData;
}

export function buildRadar(snapshot: Snapshot): BuiltRadar {
  const asOf = snapshot.as_of;
  const anchors = anchorsOf(snapshot);
  const fits = fitAll(anchors);
  const ranked = rankedOf(snapshot);
  const validation = validateModel(anchors, ranked, asOf);

  const scored = ranked.map((p) => {
    const v = impliedOf(fits, p, asOf);
    return { p, v };
  });
  scored.sort((x, y) => y.v.implied - x.v.implied || (x.p.slug < y.p.slug ? -1 : 1));

  const rows: EnrichedRow[] = scored.map((s, idx) => {
    const p = s.p;
    const plan = farmPlan(p, s.v.implied, multipliers(p, asOf).age_for_model);
    const range = bootstrapRankRanges.get(p.slug) ?? { p10: idx + 1, p90: idx + 1 };
    return {
      slug: p.slug,
      name: p.name,
      rank: idx + 1,
      implied_value_usd: s.v.implied,
      farm_steps: plan.steps,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: s.v.age_days,
      listed_at: p.listed_at,
      watchlist: snapshot.watchlist.includes(p.slug),
      base_value_usd: Math.round(s.v.base),
      growth_mult: Math.round(s.v.growth * 1000) / 1000,
      maturity_mult: Math.round(s.v.maturity * 1000) / 1000,
      breadth_mult: Math.round(s.v.breadth * 1000) / 1000,
      fit_category: s.v.fitName,
      fit_a: s.v.fit.a,
      fit_b: s.v.fit.b,
      fit_r2: Math.round(s.v.fit.r2 * 10000) / 10000,
      fit_anchors: s.v.fit.n,
      rank_p10: range.p10,
      rank_p90: range.p90,
      capital_usd: plan.capital,
      gas_per_tx_usd: plan.gasPerTx,
      gas_total_usd: plan.gasTotal,
      expected_value_usd: plan.expectedValue,
      verdict: plan.verdict,
      break_even_implied_usd: plan.breakEven,
      hold_days: plan.holdDays,
    };
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p))
    .sort((x, y) => (y.mcap_usd ?? -1) - (x.mcap_usd ?? -1) || (x.slug < y.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol ?? '',
      change_7d: p.change_7d,
      age_days: ageDays(p.listed_at, asOf),
      mcap_per_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }));

  const excluded: ExcludedRow[] = snapshot.protocols
    .filter((p) => !recordsToken(p) && exclusionReason(p) !== null)
    .sort((x, y) => (x.slug < y.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      reason: exclusionReason(p) as string,
    }));

  const reasonCounts = new Map<string, number>();
  for (const e of excluded) reasonCounts.set(e.reason, (reasonCounts.get(e.reason) ?? 0) + 1);
  const accounting = [...reasonCounts.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .map(([reason, count]) => ({ reason, count }));

  const categoryFits = [...fits.byCategory.entries()]
    .sort((x, y) => y[1].n - x[1].n || (x[0] < y[0] ? -1 : 1))
    .map(([category, f]) => ({
      category,
      a: Math.round(f.a * 10000) / 10000,
      b: Math.round(f.b * 10000) / 10000,
      r2: Math.round(f.r2 * 10000) / 10000,
      n: f.n,
    }));

  const radar: RadarData = {
    meta: {
      model: 'radar-3',
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      total_protocols: snapshot.protocols.length,
      watchlist_count: snapshot.watchlist.length,
      ranked_count: rows.length,
      anchor_count: anchors.length,
      traded_count: live.length,
      excluded_count: excluded.length,
    },
    global_fit: {
      a: Math.round(fits.global.a * 10000) / 10000,
      b: Math.round(fits.global.b * 10000) / 10000,
      r2: Math.round(fits.global.r2 * 10000) / 10000,
      n: fits.global.n,
    },
    category_fits: categoryFits,
    validation,
    gas_table: GAS_TABLE,
    assumptions: [
      'Implied value = fitted curve value x growth x maturity x breadth; the curve is OLS on log(market cap) against log(TVL) over traded-token anchors.',
      'Farmers are assumed to capture 5% of the implied value; expected value = 5% of implied value minus total gas.',
      'Gas assumes 8 transactions over the farm window at the mid-point cost per chain in the gas table.',
      'Capital is tiered by TVL: $250 at $5B+, $150 at $1B+, $100 at $100M+, $50 below.',
      'A protocol "records no token" when its DefiLlama record carries no gecko id and no symbol; that is not proof it has no token.',
      'Source: DefiLlama protocols snapshot, fetched 2026-11-14. No price, no prediction of whether or when a token is issued.',
    ],
    rows,
    live,
    excluded,
    accounting,
  };

  const board: Row[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  return { board, radar };
}

/** data.js: the dashboard's whole dataset, written beside dashboard/. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's shape, checked before anything is written. Null when the board is valid. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, need 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seenRanks = new Set<number>();
  const seenSlugs = new Set<string>();
  let prev: number | null = null;
  let allEqual = board.length > 1;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `board names unknown slug ${row.slug}`;
    if (seenSlugs.has(row.slug)) return `board repeats slug ${row.slug}`;
    seenSlugs.add(row.slug);
    if (!row.name) return `board row ${row.slug} has an empty name`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `board row ${row.slug} has a bad rank`;
    if (seenRanks.has(row.rank)) return `board repeats rank ${row.rank}`;
    seenRanks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      return `board row ${row.slug} has a bad implied value`;
    }
    if (prev !== null && row.implied_value_usd > prev) return `board values rise at rank ${row.rank}`;
    if (prev !== null && row.implied_value_usd !== prev) allEqual = false;
    prev = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `board row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `board row ${row.slug} has a farm step of ${t.length} chars`;
    }
  }
  for (let r = 1; r <= board.length; r++) {
    if (!seenRanks.has(r)) return `board is missing rank ${r}`;
  }
  if (allEqual) return 'board implied values are all equal';
  for (const w of snapshot.watchlist) {
    if (!seenSlugs.has(w)) return `board is missing watchlist slug ${w}`;
  }
  return null;
}
