#!/usr/bin/env bun
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|y|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|^SEC_UA$/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}



// abrdn official gateway + SEC N-PORT holdings fallback + Yahoo market history.
// Shared helpers copied from daggerok/JPMorgan @ c1ef7858; provider adapter below.
import { mkdir, readFile, writeFile, readdir, rm, appendFile, rename } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
type JsonRecord = Record<string, any>;
const ABERDEEN_SITE = 'https://www.aberdeeninvestments.com';
const CATALOG_PAGE = `${ABERDEEN_SITE}/en-us/investor/funds/view-all-funds?table=prices&fund_product_type=Exchange%20Traded%20Fund`;
const GATEWAY = `${ABERDEEN_SITE}/api/gateway/funds`;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const EDGAR_BROWSE_URL = 'https://www.sec.gov/cgi-bin/browse-edgar';
// Official SEC lookup tables (public, no key): ETF/mutual-fund ticker ->
// registrant CIK + series/class ids, and operating company name -> ticker.
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';

const API_ROOT = new URL('../api/aberdeen/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 2;
const REQUEST_SLEEP_FALLBACK = 1;
const MAX_RETRIES_FALLBACK = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\u00ae/g, '') // ®
    .replace(/\u2122/g, '') // ™
    .replace(/&#174;|&reg;/gi, '')
    .replace(/&#8482;|&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "2.97057744E8" -> "297057744"; keeps non-numeric text untouched (same as SPDR).
export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '--' || /^n\/?a$/i.test(text)) return null;
  // Percent first, then plain numbers: "0.40%" -> 0.4, "$1,234.56" -> 1234.56.
  const parsed = Number(text.replace(/[$,\s]/g, '').replace(/%$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// am.jpmorgan.com publishes yields and returns as fractions (0.0536 = 5.36%);
// expense ratios and premium/discount figures arrive in percent already.
export function fractionToPercent(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null ? null : round(number * 100, 4);
}

// "2026-06-30" -> "Jun 30 2026" (the display style shared with the sibling apps).
export function formatEdgarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return String(iso || '');
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${day} ${year}`;
}

export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function formatEpochDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
}

export function formatUsDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

// "08/21/2026" / "2026-08-21T00:00:00Z" -> "2026-08-21"; anything else passes
// through untouched so an unexpected source format never silently corrupts a
// date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text;
}

// "2026-08-21" -> "08/21/2026" (how am.jpmorgan.com renders dates in its
// workbooks and CSV reports).
export function isoToEpoch(iso: string): number | null {
  const value = Date.parse(`${toIsoDate(iso)}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

export function formatAumDisplay(value: number): string {
  return `$${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

// ---------------------------------------------------------------------------
// Updater configuration (environment variables, iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  secUa: string;
  skipYahoo: boolean;
  skipAberdeen: boolean;
  edgarFallback: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function envValue(env: Record<string, string | undefined>, name: string, aliases: string[] = []): string {
  for (const key of [`ABERDEEN_${name}`, name, ...aliases]) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseNonNegativeFloat(raw: string, fallback: number): number {
  const value = raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseBoolean(raw: string, fallback = false): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

// Strict "min:max" ranges (same parser and errors as the sibling repos).
export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  if (text.split(':').length !== 2) throw new Error('Range requires exactly one colon');
  const [rawMin, rawMax] = text.split(':', 2);
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^([\d.]+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) {
    const value=Number(suffixMatch[1])*(AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()]??1);
    if(!Number.isFinite(value))throw new Error(`AUM: invalid bound ${bound}`);
    return value;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`AUM: invalid bound ${bound}`);
  return value;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  if (text.split(':').length !== 2) throw new Error('Range requires exactly one colon');
  const [rawMin, rawMax] = text.split(':', 2);
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(envValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), CONCURRENCY_FALLBACK),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), REQUEST_SLEEP_FALLBACK),
    maxFetches: parsePositiveInt(envValue(env, 'MAX_FETCHES', ['ABERDEEN_LIMIT']), 0),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), HOLDINGS_PAGE_SIZE_FALLBACK),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE', ['HISTORICAL_PAGE_SIZE']), HISTORY_PAGE_SIZE_FALLBACK),
    storeRawDownloads: parseBoolean(envValue(env, 'STORE_RAW_DOWNLOADS', ['ABERDEEN_STORE_RAW_DOWNLOADS']), false),
    maxRetries: parsePositiveInt(envValue(env, 'MAX_RETRIES'), MAX_RETRIES_FALLBACK),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: envValue(env, 'HISTORY_RANGE') || 'max',
    secUa: envValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO'), false),
    skipAberdeen: parseBoolean(envValue(env, 'SKIP_ABERDEEN'), false),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK'), true),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(envValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}
class HttpError extends Error {
  constructor(message: string, readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** `fetchWithRetry` already prefixes its messages with the fetch label, so a
    caller that prints its own tag must not repeat the label. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]*\] ?/, '');
}

// Every request has a timeout (headers AND body) and is retried per MAX_RETRIES.
let fetchTimeoutMs = 45_000;
export function setFetchTimeoutMs(ms: number): void { fetchTimeoutMs = ms; }

async function requestWithRetry<T>(
  url: string,
  label: string,
  init: RequestInit,
  maxRetries: number,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests();
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(fetchTimeoutMs), ...init });
      if (response.ok) return await read(response);
      const retryable = [403, 408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) throw new HttpError(`${label}: HTTP ${response.status} ${response.statusText}`, response.status, false);
      lastError = new HttpError(`${label}: HTTP ${response.status} (attempt ${attempt + 1} of ${maxRetries + 1})`, response.status, true);
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error instanceof HttpError ? error : new Error(`${label}: network error (${String(error)})`);
    }
    if (attempt < maxRetries) await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: failed`);
}

export function fetchWithRetry(url: string, label: string, init: RequestInit = {}, maxRetries = 2): Promise<Response> {
  return requestWithRetry(url, label, init, maxRetries, async (response) => response);
}

/** Like fetchWithRetry, but the body is read inside the retry loop, so a stalled or truncated body is retried too. */
export function fetchTextWithRetry(url: string, label: string, init: RequestInit = {}, maxRetries = 2): Promise<string> {
  return requestWithRetry(url, label, init, maxRetries, (response) => response.text());
}

function yahooHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: 'application/json,*/*' };
}

async function fetchText(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<string> {
  return await fetchTextWithRetry(url, label, { headers }, config.maxRetries);
}

async function fetchJson(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchText(url, label, headers, config);
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

const HOLDING_NAME_SUFFIXES = new Set([
  'STOCK', 'COMMON', 'PREFERRED', 'PFD', 'SHARES', 'ORDINARY', 'DEPOSITARY', 'ADS', 'ADR',
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC',
  'PUBLIC', 'SA', 'SAS', 'SARL', 'SRL', 'SL', 'KG', 'AG', 'BA', 'BV', 'NV', 'OY', 'SE',
  'AS', 'AB', 'AD', 'KK', 'KABUSHIKI', 'KAISHA', 'PTY', 'PT', 'SFC', 'ANONIMA', 'GMBH',
  'HOLDINGS', 'HLDGS', 'DEL', 'NEW', 'DELISTED', 'REPR', 'GROUP', 'TR', 'TRUST', 'NOTE',
  'NL', 'SPA', 'LP', 'LC', 'LLC', 'CAP', 'STK', 'SHS',
  'NOTES', 'BOND', 'BONDS', 'SER', 'SERIES',
]);
const HOLDING_NAME_PHRASES = new Set([
  'COMMON STOCK', 'PREFERRED STOCK', 'DEPOSITARY SHARES', 'AMERICAN DEPOSITARY SHARES',
  'ORDINARY SHARES', 'LIABILITY CO', 'S A', 'N V', 'B V', 'PRIVATE LTD', 'PUBLIC LTD',
]);
// Words that carry no identity at all: dropped wherever they sit at the edge
// of a filed name, so "The Coca-Cola Co" and "Coca CO" meet.
const HOLDING_NAME_FILLERS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'DE', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'DI', 'Y',
  'E', 'DU', 'DA', 'LOS', 'LAS', 'EL', 'AL', 'DEL', 'NPV', 'PAR', 'VAL', 'USD', 'EUR',
  'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'CNY', 'SEK', 'NOK', 'NZD', 'MXN', 'INR',
]);

// Trailing share-class / security-type designations. The class letter is kept
// and canonicalized ("... Class C Capital Stock" -> "... Cl C") rather than
// dropped, so GOOG vs GOOGL — like BF/A vs BF/B — never collide.
const SHARE_CLASS_RE = /(?:\s+(?:CLASS|CL))\s+([A-Z])\b\s*$/;
// Words that only describe the security, never the issuer; safe to peel off the
// end of a filed name (and, once a share class is known, from behind it).
const SECURITY_TYPE_WORDS = new Set([
  'STOCK', 'STK', 'SHARES', 'SHS', 'SH', 'SHARE', 'CAPITAL', 'CAP', 'COMMON', 'ORDINARY',
  'GENERAL', 'VOTING', 'NON', 'NONVOTING', 'NVOTING', 'CONVERTIBLE', 'DEPOSITARY', 'PAID',
  'SUBORDINATED', 'NOTES', 'NOTE', 'SER', 'SERIES', 'LIABILITY', 'NEW', 'REP', 'REPR',
]);

export function normalizeHoldingName(raw: unknown): string {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  let tokens = text.split(' ').filter(Boolean);
  let classLetter = '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const withClass = tokens.join(' ').match(SHARE_CLASS_RE);
    if (withClass) {
      classLetter = withClass[1];
      tokens = tokens.slice(0, tokens.length - 2); // drop "Class C" (or "Cl C")
      changed = true;
    }
    const last = tokens[tokens.length - 1];
    if (SECURITY_TYPE_WORDS.has(last) && tokens.length > 1) {
      tokens.pop(); // "... Capital Stock" -> "... Capital"
      changed = true;
      continue;
    }
    if (tokens.length >= 2 && HOLDING_NAME_PHRASES.has(`${tokens[tokens.length - 2]} ${last}`)) {
      tokens = tokens.slice(0, -2);
      changed = true;
      continue;
    }
    if (HOLDING_NAME_SUFFIXES.has(last)) {
      tokens.pop();
      changed = true;
      continue;
    }
    while (tokens.length > 2 && HOLDING_NAME_FILLERS.has(tokens[tokens.length - 1])) {
      tokens.pop(); // keep peeling: a filler may hide the next legal-form suffix
      changed = true;
    }
  }
  while (tokens.length > 1 && HOLDING_NAME_FILLERS.has(tokens[0])) tokens.shift();
  const body = tokens.join(' ').trim();
  return classLetter ? `${body} CL ${classLetter}`.replace(/\s+/g, ' ').trim() : body;
}

export function normalizeHoldingNameCore(raw: unknown): string {
  return normalizeHoldingName(raw).replace(/ /g, '');
}

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}

export function yahooSearchUrl(name: string): string {
  return `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;
}

// Strict matcher for Yahoo search payloads: the quote's long name must
// normalize to the same name (or token-core) as the filed holding name. Only
// EQUITY/ETF quotes are accepted, and single/two-word holdings may additionally
// match by token containment (e.g. "BULLISH" -> "Bullish BLCM Inc").
export function pickSearchTicker(name: string, payload: JsonRecord): string | null {
  const matches: unknown[] = Array.isArray(payload?.quoteMatches) ? payload.quoteMatches : [];
  const norm = normalizeHoldingName(name);
  if (!norm) return null;
  const core = norm.replace(/ /g, '');
  const tokens = norm.split(' ');
  for (const match of matches) {
    if (!match || typeof match !== 'object') continue;
    const record = match as JsonRecord;
    const quoteType = String(record.quoteType || '').toUpperCase();
    if (quoteType !== 'EQUITY' && quoteType !== 'ETF') continue;
    const symbol = cleanHoldingTicker(record.symbol);
    if (!symbol) continue;
    const longName = String(record.longname || record.shortname || '');
    const candidate = normalizeHoldingName(longName);
    if (!candidate) continue;
    if (candidate === norm || candidate.replace(/ /g, '') === core) return symbol;
    if (tokens.length <= 2 && tokens.every((token) => candidate.includes(token))) return symbol;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer: N-PORT-P positions for funds am.jpmorgan.com does
// not publish holdings for, resolved through the EDGAR full-text search API.
// ---------------------------------------------------------------------------

export type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

export function nportUrlFor(cik: string, accession: string): string {
  return `${EDGAR_ARCHIVES}/${Number(String(cik).replace(/^0+/, '') || 0)}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

export function parseNportAccessions(submissions: JsonRecord): NportAccession[] {
  const recent = submissions?.filings?.recent;
  const result: NportAccession[] = [];
  if (!recent || !Array.isArray(recent.form)) return result;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== 'NPORT-P') continue;
    const accession: string = String(recent.accessionNumber?.[i] || '');
    if (!accession) continue;
    result.push({
      accession,
      filed: String(recent.filingDate?.[i] || ''),
      reportDate: String(recent.reportDate?.[i] || ''),
      url: nportUrlFor(String(submissions.cik || '0'), accession),
    });
  }
  return result;
}

// EDGAR publishes the authoritative "ticker -> registrant CIK + series id"
// table for every ETF and mutual fund class; it is the reliable way to reach a
// fund's own N-PORT-P filing (the full-text search is only a last resort).
export type SecSeriesRef = { cik: string; seriesId: string; classId: string };

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const map = new Map<string, SecSeriesRef>();
  const fields: string[] = Array.isArray(payload?.fields) ? payload.fields.map((field: unknown) => String(field)) : [];
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  const at = (row: unknown[], field: string): string => {
    const index = fields.indexOf(field);
    return index >= 0 ? String(row[index] ?? '') : '';
  };
  for (const raw of rows) {
    if (!Array.isArray(raw)) continue;
    const ticker = sanitizeTicker(at(raw, 'symbol'));
    if (!ticker || map.has(ticker)) continue;
    const cik = at(raw, 'cik').replace(/\D/g, '');
    if (!cik || Number(cik) === 0) continue;
    map.set(ticker, {
      cik: cik.padStart(10, '0'),
      seriesId: at(raw, 'seriesId').toUpperCase(),
      classId: at(raw, 'classId').toUpperCase(),
    });
  }
  return map;
}

// Operating-company name -> exchange ticker, so N-PORT positions (which carry
// CUSIP/ISIN but never a ticker) still land in the watchlist with a symbol.
export function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.values(payload as JsonRecord) : [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as JsonRecord;
    const ticker = cleanHoldingTicker(record.ticker);
    const title = String(record.title ?? '');
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) {
      if (key && !map.has(key)) map.set(key, ticker);
    }
  }
  return map;
}

export function edgarSeriesFilingsUrl(seriesId: string, count = 10): string {
  const params = new URLSearchParams({
    action: 'getcompany',
    CIK: String(seriesId || '').toUpperCase(),
    type: 'NPORT-P',
    dateb: '',
    owner: 'include',
    count: String(count),
    output: 'atom',
  });
  return `${EDGAR_BROWSE_URL}?${params.toString()}`;
}

// browse-edgar's Atom feed for one series: the newest N-PORT-P accessions of
// exactly that fund, newest first.
export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const entry of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = entry[1];
    const form = tagValue(body, 'filing-type') || tagValue(body, 'type');
    if (form && form.toUpperCase() !== 'NPORT-P') continue;
    const accession = tagValue(body, 'accession-number') || tagValue(body, 'accession-nunber');
    if (!accession) continue;
    const hrefMatch = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body);
    const cikMatch = hrefMatch ? /\/edgar\/data\/(\d+)\//.exec(cleanText(hrefMatch[1])) : null;
    result.push({
      accession,
      filed: tagValue(body, 'filing-date'),
      reportDate: tagValue(body, 'period') || '',
      url: nportUrlFor(cikMatch ? cikMatch[1] : accession.slice(0, 10), accession),
    });
  }
  return result;
}

function tagValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? cleanText(match[1]) : '';
}

export type NportHolding = JsonRecord;

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: NportHolding[];
  totalValue: number;
  netAssets: number | null;
};

// Minimal, forgiving N-PORT-P XML reader (machine-generated schemas only),
// in the same spirit as SPDR's hand-rolled ZIP/OOXML workbook reader.
export function parseNport(xml: string): ParsedNport {
  const genInfoMatch = /<genInfo>([\s\S]*?)<\/genInfo>/i.exec(xml);
  const genInfo = genInfoMatch ? genInfoMatch[1] : String(xml || '').slice(0, 4000);
  const fundInfoMatch = /<fundInfo>([\s\S]*?)<\/fundInfo>/i.exec(xml);
  const fundInfo = fundInfoMatch ? fundInfoMatch[1] : '';
  const holdings: NportHolding[] = [];
  const blockRe = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/g;
  let block: RegExpExecArray | null;
  let totalValue = 0;
  while ((block = blockRe.exec(xml)) !== null) {
    const body = block[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    let identifier = cusip && cusip.toUpperCase() !== 'N/A' ? cusip : '';
    if (!identifier) {
      // Real EDGAR schema: <identifiers><isin value="..."/><other value="..."/></identifiers>
      for (const tagMatch of body.matchAll(/<(isin|sedol|other|cusip)[^>]*value="([^"]+)"/gi)) {
        identifier = cleanText(tagMatch[2]);
        if (identifier) break;
      }
    }
    const weight = normalizeNumberText(tagValue(body, 'pctVal'));
    const valueMatch = /<valUSD[^>]*>([\s\S]*?)<\/valUSD>/i.exec(body);
    const value = Number(valueMatch ? valueMatch[1].replace(/[,\s]/g, '') : tagValue(body, 'curVal'));
    const balance = normalizeNumberText(tagValue(body, 'balance'));
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier || '-',
      Weight: weight === '' ? '0' : weight,
      'Market Value': Number.isFinite(value) ? String(value) : '0',
      'Shares Held': balance === '' ? '-' : balance,
      'Asset Category': tagValue(body, 'assetCat') || '-',
    });
    if (Number.isFinite(value)) totalValue += value;
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue,
    netAssets: numberOrNull(normalizeNumberText(tagValue(fundInfo, 'netAssets'))),
  };
}

// EDGAR full-text search maps a fund ticker to the registrant that filed its
// N-PORT-P, so the fallback works for every JPMorgan ETF without a hand-kept
// CIK table.
export function eftsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: 'NPORT-P',
    dateRange: 'custom',
    start: '0',
    end: String(25),
  });
  return `${SEC_EFTS_HOST}/search-index?${params.toString()}`;
}

export function pickEftsCik(payload: JsonRecord, fundName: string): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as JsonRecord;
    const source = (hit._source || {}) as JsonRecord;
    const display = source.display_names;
    // Real payload: display_names is ["NAME  (CIK 0001209466)", ...].
    const names: string[] = Array.isArray(display)
      ? display.map((entry: unknown) => String(entry))
      : Array.isArray((display as JsonRecord)?.names)
        ? ((display as JsonRecord).names as unknown[]).map((entry) => String(entry))
        : [];
    const fromDisplay = names.map((name) => /\(CIK\s*(\d{4,10})\)/i.exec(name)).find(Boolean);
    const ciks: string[] = Array.isArray(source.ciks) ? source.ciks.map((entry: unknown) => String(entry)) : [];
    const rawCik = String((display as JsonRecord)?.cik || fromDisplay?.[1] || ciks[0] || '');
    const cik = rawCik.replace(/\D/g, '').padStart(10, '0');
    if (!cik || cik === '0000000000') continue;
    if (wanted && names.length) {
      const matched = names.some((name) => {
        const normalized = normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''));
        return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
      });
      if (!matched) continue;
    }
    return cik;
  }
  return null;
}

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };

export type ParsedChart = {
  exchangeName: string;
  longName: string;
  navPrice: number | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload?.chart?.result || [])[0] as JsonRecord | undefined;
  if (!result) throw new Error('chart: empty result');
  const meta = (result.meta || {}) as JsonRecord;
  const timestamps: number[] = result.timestamp || [];
  const quote = ((result.indicators || {}).quote || [])[0] as JsonRecord | undefined;
  const adj = ((result.indicators || {}).adjclose || [])[0] as JsonRecord | undefined;
  const closes: unknown[] = (quote && quote.close) || [];
  const volumes: unknown[] = (quote && quote.volume) || [];
  const adjCloses: unknown[] = (adj && adj.adjclose) || closes;
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const adjClose = typeof adjCloses[i] === 'number' && Number.isFinite(adjCloses[i] as number) ? (adjCloses[i] as number) : close;
    days.push({
      date: epochToIsoDate(timestamps[i]),
      close: round(close, 6),
      // Yahoo recomputes the split/dividend-adjusted close on every request;
      // at 6 decimals the last digit or two jitters between otherwise
      // identical requests, making every history row (and the fund) look
      // "updated" on every single run. 2 decimals is well past any
      // meaningful precision for a price and absorbs that jitter.
      adjClose: round(adjClose, 2),
      volume: typeof volumes[i] === 'number' ? (volumes[i] as number) : 0,
    });
  }
  const events = ((result.events || {}) as JsonRecord).dividends as Record<string, JsonRecord> | undefined;
  const dividends = Object.values(events || {})
    .map((event) => ({ epoch: Number(event.date), amount: Number(event.amount) }))
    .filter((event) => Number.isFinite(event.epoch) && Number.isFinite(event.amount) && event.amount > 0)
    .sort((a, b) => a.epoch - b.epoch);
  return {
    exchangeName: String(meta.fullExchangeName || meta.exchangeName || ''),
    longName: String(meta.longName || meta.shortName || ''),
    navPrice: numberOrNull(meta.navPrice),
    regularMarketPrice: numberOrNull(meta.regularMarketPrice) ?? numberOrNull(meta.previousClose),
    regularMarketTime: numberOrNull(meta.regularMarketTime),
    firstTradeDate: numberOrNull(meta.firstTradeDate),
    days,
    dividends,
  };
}

export function chartUrl(ticker: string, config: UpdaterConfig, nowMs = Date.now()): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(nowMs / 1000);
  let period1 = 0; // "max"
  const yearsMatch = /^(\d+)y$/i.exec(config.historyRange);
  if (yearsMatch) period1 = Math.floor(period2 - Number(yearsMatch[1]) * 365.25 * 86_400);
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
}

// ---------------------------------------------------------------------------
// Derived catalog metrics (unit-tested helpers, sibling parity)
// ---------------------------------------------------------------------------

// (1 + CAGR)^n - 1 — the exact inverse of annualizing (same helper as SPDR).
export function annualizedToTotal(annualizedPercent: number | null | undefined, years: number): number | null {
  if (typeof annualizedPercent !== 'number' || !Number.isFinite(annualizedPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + annualizedPercent / 100) ** years - 1) * 100, 2);
}

export function totalToAnnualized(totalPercent: number | null | undefined, years: number): number | null {
  if (typeof totalPercent !== 'number' || !Number.isFinite(totalPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + totalPercent / 100) ** (1 / years) - 1) * 100, 2);
}

// Indicated yield: latest distribution x payments per year / price — used only
// when the product list publishes no trailing-12-month yield for the fund.
export function indicatedYield(
  latestDistribution: number | null | undefined,
  paymentsPerYear: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (typeof latestDistribution !== 'number' || typeof paymentsPerYear !== 'number' || typeof price !== 'number') return null;
  if (!Number.isFinite(latestDistribution) || !Number.isFinite(paymentsPerYear) || !Number.isFinite(price) || price <= 0) return null;
  if (paymentsPerYear <= 0 || latestDistribution <= 0) return null;
  return round(((latestDistribution * paymentsPerYear) / price) * 100, 2);
}

export function inferDistributionFrequency(
  dividends: Array<{ epoch: number; amount: number }>,
): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  const recent = dividends.slice(-9);
  if (recent.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const gapsDays: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const gap = (recent[i].epoch - recent[i - 1].epoch) / 86_400;
    if (gap > 14 && gap < 400) gapsDays.push(gap);
  }
  if (!gapsDays.length) return { frequency: 'Unknown', paymentsPerYear: null };
  gapsDays.sort((a, b) => a - b);
  const medianGap = gapsDays[Math.floor(gapsDays.length / 2)];
  if (medianGap >= 300) return { frequency: 'Annually', paymentsPerYear: 1 };
  if (medianGap >= 150) return { frequency: 'Semi-annually', paymentsPerYear: 2 };
  if (medianGap >= 75) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (medianGap >= 25) return { frequency: 'Monthly', paymentsPerYear: 12 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

export type PriceReturns = {
  asOfDate: string;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  mo1: number | null;
  qtd: number | null;
};

const EMPTY_PRICE_RETURNS: PriceReturns = {
  asOfDate: '', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null,
};

function pctChange(start: number, end: number): number {
  return round(((end - start) / start) * 100, 2);
}

function annualized(start: number, end: number, years: number): number | null {
  if (start <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

// Total returns from an adjusted daily series anchored to the last trading day
// at or before `now`. The series is the official JPMorgan NAV with published
// distributions reinvested (or Yahoo adjusted closes in the fallback path).
// JPMorgan publishes official returns for every fund, so these only fill the
// gaps (young funds, quarter-to-date) and drive the History-derived blocks.
export function priceReturns(days: ChartDay[], now = new Date(), coveredFrom: string | null = null): PriceReturns {
  const empty: PriceReturns = { ...EMPTY_PRICE_RETURNS };
  if (!days.length) return empty;
  const last = days[days.length - 1];
  // A window is derivable only when its anchor day lies inside the span the
  // adjusted series covers (see reinvestmentCoverageStart).
  const anchored = (day: ChartDay | null): day is ChartDay => day !== null && day.date < last.date && (coveredFrom === null || day.date >= coveredFrom);
  const lastEpoch = Date.parse(`${last.date}T00:00:00Z`) / 1000;
  const atOrBefore = (iso: string): ChartDay | null => {
    const target = Date.parse(`${iso}T00:00:00Z`) / 1000;
    if (Number.isNaN(target)) return null;
    let found: ChartDay | null = null;
    for (const day of days) {
      if (Date.parse(`${day.date}T00:00:00Z`) / 1000 <= target) found = day;
      else break;
    }
    return found;
  };
  const yearsAgo = (years: number): ChartDay | null => {
    const date = new Date(now.getTime());
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return atOrBefore(date.toISOString().slice(0, 10));
  };
  const ytdStart = atOrBefore(`${now.getUTCFullYear()}-01-01`);
  const mo1Start = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const quarterStart = `${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  const year1 = yearsAgo(1);
  const year3 = yearsAgo(3);
  const year5 = yearsAgo(5);
  const year10 = yearsAgo(10);
  const first = days[0];
  const siYears = (lastEpoch - Date.parse(`${first.date}T00:00:00Z`) / 1000) / (365.25 * 86_400);
  const mo1StartDay = atOrBefore(mo1Start);
  const qtdStartDay = atOrBefore(quarterStart);
  return {
    asOfDate: last.date,
    ytd: anchored(ytdStart) && ytdStart.adjClose > 0 ? pctChange(ytdStart.adjClose, last.adjClose) : null,
    yr1: anchored(year1) ? pctChange(year1.adjClose, last.adjClose) : null,
    cagr3y: anchored(year3) ? annualized(year3.adjClose, last.adjClose, 3) : null,
    cagr5y: anchored(year5) ? annualized(year5.adjClose, last.adjClose, 5) : null,
    cagr10y: anchored(year10) ? annualized(year10.adjClose, last.adjClose, 10) : null,
    siAnn: siYears >= 1 && anchored(first) ? annualized(first.adjClose, last.adjClose, siYears) : null,
    mo1: anchored(mo1StartDay) ? pctChange(mo1StartDay.adjClose, last.adjClose) : null,
    qtd: anchored(qtdStartDay) ? pctChange(qtdStartDay.adjClose, last.adjClose) : null,
  };
}

export function lastCompletedQuarterEnd(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  if (month <= 2) return new Date(Date.UTC(year - 1, 11, 31)); // Jan-Mar -> Dec 31
  if (month <= 5) return new Date(Date.UTC(year, 2, 31)); // Apr-Jun -> Mar 31
  if (month <= 8) return new Date(Date.UTC(year, 5, 30)); // Jul-Sep -> Jun 30
  return new Date(Date.UTC(year, 8, 30)); // Oct-Dec -> Sep 30
}

function inRange(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function annualizedValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  if (period === 'YTD') return numberOrNull(metrics.ytd);
  if (period === '1Y') return numberOrNull(metrics.tr1y);
  return numberOrNull(metrics[`cagr${period.toLowerCase()}`]);
}

function cumulativeValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  const key = period === 'YTD' ? 'ytd' : period === '1Y' ? 'tr1y' : `tr${period.toLowerCase()}`;
  return numberOrNull(metrics[key]);
}

export function fundFilterReasons(
  candidate: { ticker: string; aumValue?: number | null; terValue?: number | null; metrics: JsonRecord },
  config: UpdaterConfig,
): string[] {
  const reasons: string[] = [];
  if (config.tickers.length && !config.tickers.includes(candidate.ticker)) reasons.push('TICKERS');
  if (config.aumRange && !inRange(candidate.aumValue ?? null, config.aumRange)) reasons.push('AUM');
  if (config.terRange && !inRange(candidate.terValue ?? null, config.terRange)) reasons.push('TER');
  if (config.dividendYieldRange && !inRange(numberOrNull(candidate.metrics.dividendYield), config.dividendYieldRange)) {
    reasons.push('DIVIDEND_YIELD');
  }
  if (!inRange(numberOrNull(candidate.metrics.secYield), config.secYieldRange)) reasons.push('SEC_YIELD');
  for (const period of RETURN_PERIODS) {
    const performance = config.performanceRanges[period];
    if (performance && !inRange(annualizedValue(candidate.metrics, period), performance)) reasons.push(`PERFORMANCE_${period}`);
    const total = config.totalReturnRanges[period];
    if (total && !inRange(cumulativeValue(candidate.metrics, period), total)) reasons.push(`TOTAL_RETURN_${period}`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Deterministic writers (iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------
async function writePages(
  dir: URL,
  ticker: string,
  kind: 'holdings' | 'history',
  headers: string[],
  rows: JsonRecord[],
  pageSize: number,
): Promise<{ pages: string[]; pageSize: number; totalRows: number }> {
  await mkdir(new URL(`${kind}/`, dir), { recursive: true });
  const pages: string[] = [];
  if (rows.length) {
    const pageCount = Math.ceil(rows.length / pageSize);
    for (let page = 1; page <= pageCount; page++) {
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      const name = `${kind}/${pad3(page)}.json`;
      await writeIfChanged(new URL(name, dir), {
        ticker,
        page,
        pageSize,
        totalRows: rows.length,
        headers,
        rows: slice,
      });
      pages.push(name);
    }
  }
  return { pages, pageSize, totalRows: rows.length };
}

export async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', kept: Set<string>): Promise<void> {
  const kindDir = new URL(`${kind}/`, fundDir);
  let entries: string[] = [];
  try {
    entries = await readdir(kindDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith('.json') && !kept.has(`${kind}/${entry}`)) {
      await rm(new URL(entry, kindDir), { force: true });
    }
  }
}
async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let page = 1;
  for (;;) {
    let payload: JsonRecord;
    try {
      payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(page)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    } catch {
      return rows;
    }
    rows.push(...(payload.rows || []));
    const totalRows = numberOrNull(payload.totalRows);
    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (!(payload.rows || []).length) return rows;
    page += 1;
  }
}

async function readPreviousSheetHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[]> {
  try {
    const payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(1)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(payload.headers) ? (payload.headers as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fund assembly
// ---------------------------------------------------------------------------
function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({
    Date: formatEdgarDate(day.date),
    Close: String(day.close),
    'Adj Close': String(day.adjClose),
    Volume: String(day.volume),
  }));
}

// Array rows (not objects): meta.distributions feeds renderDistributionsTable
// directly, same as the sibling worksheet shape.
function distributionRows(dividends: Array<{ epoch: number; amount: number }>): string[][] {
  return dividends.map((dividend) => [formatUsDate(dividend.epoch), String(round(dividend.amount, 6))]);
}


// Per-worker request lanes: every fund worker paces its own request starts by
// REQUEST_SLEEP (reserved BEFORE awaiting, no races), so N workers give about N
// times the throughput. Requests made outside a worker (catalog) use the root
// lane. There is no r.jina.ai proxy here, so no global gate is needed.
interface RequestLane { nextAt: number }
const laneStorage = new AsyncLocalStorage<RequestLane>();
const rootLane: RequestLane = { nextAt: 0 };
let requestSleepMs = REQUEST_SLEEP_FALLBACK * 1000;
async function paceRequests(): Promise<void> {
  const lane = laneStorage.getStore() ?? rootLane;
  const start = Math.max(Date.now(), lane.nextAt);
  lane.nextAt = start + requestSleepMs;
  if (start > Date.now()) await sleep(start - Date.now());
}
export function setRequestSleep(seconds: number): void { requestSleepMs = seconds * 1000; rootLane.nextAt = 0; }
/** Run `count` workers, each with its own request lane. */
export async function runWorkers(count: number, worker: () => Promise<void>): Promise<void> {
  await Promise.all(Array.from({ length: count }, () => laneStorage.run({ nextAt: 0 }, worker)));
}

export function samePublishedContent(previous: string, value: unknown): boolean {
  try { return outputContentKey(JSON.parse(previous)) === outputContentKey(value); }
  catch { return false; }
}
async function readJson(file: URL): Promise<JsonRecord | null> {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}
async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const previous = await readFile(file, 'utf8').catch(() => '');
  if (samePublishedContent(previous, value)) return false;
  await mkdir(new URL('./', file), { recursive: true });
  const temp = new URL(`${file.href}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 1) + '\n');
  await rename(temp, file);
  return true;
}
async function storeRaw(ticker: string, name: string, value: unknown, config: UpdaterConfig): Promise<void> {
  if (config.storeRawDownloads) await writeIfChanged(new URL(`raw/${ticker}/${name}.json`, API_ROOT), value);
}

export function isoDate(value: unknown): string | null {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(s);
  const result = m ? `${m[1]}-${m[2]}-${m[3]}` : us ? `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}` : null;
  return result && Number.isFinite(Date.parse(result)) ? result : null;
}
export function fundPageUrl(name: string, isin: string): string {
  return `${ABERDEEN_SITE}/en-us/investor/funds/view-all-funds/${name.toLowerCase().replace(/[.'’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${isin.toLowerCase()}`;
}
export type CatalogFund = {
  ticker: string; name: string; id: string; shareclassId: string; isin: string;
  assetClass: string; correlationFundRangeId: string; fundPage: string;
  nav: number | null; navDate: string | null; trustCik?: string;
};
export function catalogPayload(tab: string, skip = 0, take = 20): JsonRecord {
  return {
    countryInvestors: {countryCode:'USA', investorType:'1,4', jurisdiction:'Live', literatureAuthorization:'1'},
    language:'en-US', site:'Investor', searchQuery:{id:'',name:''},
    filters:[{name:'fund_product_type',values:['Exchange Traded Fund']}], tab, skip, take,
  };
}
export function parseCatalog(overview: JsonRecord[], prices: JsonRecord[]): CatalogFund[] {
  const byId = new Map(overview.map(f => [f.id, f]));
  const funds = new Map<string, CatalogFund>();
  for (const p of prices) for (const sc of p.shareclasses ?? []) {
    const ticker = sanitizeTicker(sc.ticker);
    if (!ticker || !p.id || !sc.shareclassID || !sc.isin) throw new Error('Catalog entry lacks identity (refuse invented tickers)');
    if (funds.has(ticker)) throw new Error(`Duplicate catalog ticker ${ticker}`);
    const o = byId.get(p.id);
    funds.set(ticker, {
      ticker, name:cleanText(p.name), id:p.id, shareclassId:sc.shareclassID, isin:sc.isin,
      assetClass:cleanText(o?.assetClass) || 'ETF', correlationFundRangeId:p.correlationFundRangeId || o?.correlationFundRangeId || '',
      fundPage:fundPageUrl(p.name, sc.isin), nav:numberOrNull(sc.nav), navDate:isoDate(sc.date),
    });
  }
  return [...funds.values()].sort((a,b) => a.ticker.localeCompare(b.ticker));
}
function basePayload(fund: CatalogFund, detail: JsonRecord = {}): JsonRecord {
  return {
    countryCode:'USA', language:'en-US', site:'Investor',
    countryInvestors:{countryCode:'USA',investorType:'1,4',jurisdiction:'Live'},
    fund:fund.id, shareClass:fund.shareclassId, assetClassId:detail.assetClassId || fund.assetClass,
    correlationFundRangeId:detail.correlationFundRangeID || fund.correlationFundRangeId,
    fundRangeName:detail.fundRangeName || 'Exchange Traded Fund', fundName:fund.name,
    fundNameId:detail.fundNameId || fund.name, shareClassNameId:detail.shareClassNameId || 'Share',
    literatureAuthorizations:['1'], sfdrClassificationId:detail.sfdrArticleClassificationId || 'N/A',
  };
}
async function post(endpoint: string, body: JsonRecord, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchTextWithRetry(`${GATEWAY}/${endpoint}`, `[ issuer   ] ${endpoint}`, {
    method:'POST', headers:{...yahooHeaders(), 'Content-Type':'application/json', Origin:ABERDEEN_SITE, Referer:CATALOG_PAGE}, body:JSON.stringify(body),
  }, config.maxRetries);
  if (!text.trim()) throw new Error(`${endpoint}: empty body (not an empty portfolio)`);
  const payload = JSON.parse(text);
  if (payload.statusCode !== undefined && (payload.statusCode < 200 || payload.statusCode >= 300)) throw new Error(`${endpoint}: application status ${payload.statusCode}`);
  return payload;
}
// A page cap is a failure, never silently publish a truncated catalog/portfolio.
export async function collectPages<T>(load: (skip:number,take:number)=>Promise<{rows:T[];total:number}>, size=100): Promise<T[]> {
  const all:T[]=[]; let expected:number | null=null;
  for (let page=0; page<1000; page++) {
    const {rows,total} = await load(all.length,size);
    if (!Number.isInteger(total) || total < 0 || !Array.isArray(rows)) throw new Error('Invalid pagination envelope');
    if (expected !== null && total !== expected) throw new Error('Total changed during pagination');
    expected = total;
    if (all.length+rows.length>total) throw new Error('Pagination exceeds declared total');
    all.push(...rows);
    if (all.length===total) return all;
    if (!rows.length) throw new Error('Incomplete pagination: empty page before declared total');
  }
  throw new Error('Pagination safety cap reached');
}
async function loadCatalog(config:UpdaterConfig):Promise<CatalogFund[]> {
  const load = async (tab:string) => collectPages<JsonRecord>(async(skip,take) => {
    const p = await post(tab,catalogPayload(tab,skip,take),config);
    await storeRaw('catalog',`${tab}-${skip}`,p,config);
    return {rows:p.content?.[tab],total:p.content?.resultCount};
  },20);
  const overview=await load('overview'), prices=await load('prices');
  const funds=parseCatalog(overview,prices);
  if (!funds.length) throw new Error('Official catalog empty; keeping published index');
  return funds;
}
export function parseDetail(html:string):JsonRecord {
  const m=/<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  const detail=m ? JSON.parse(m[1])?.props?.pageProps?.pageData?.fundDetailsData : null;
  if (!detail?.id || !detail.isPageAvailable) throw new Error('Missing fundDetailsData');
  return detail;
}
export const HOLDINGS_HEADERS=['Name','Ticker','Identifier','Weight','Market Value','Shares Held','Asset Category','ISIN','CUSIP','SEDOL','Country','Price'];
export function parseHoldings(payload:JsonRecord):{rows:JsonRecord[];asOfDate:string|null;total:number} {
  const p=payload.content ?? payload;
  if (!Array.isArray(p.results) || !Number.isInteger(p.totalResults)) throw new Error('Invalid holdings envelope');
  const rows=p.results.map((r:JsonRecord) => {
    const cols=new Map<string,string>((r.columns??[]).map((c:JsonRecord)=>[String(c.invariantColumnLabel||c.columnLabel).toLowerCase(),String(c.columnRowValue??'').trim()]));
    const get=(...names:string[])=>names.map(n=>cols.get(n.toLowerCase())).find(v=>v!==undefined&&v!=='') || '';
    const weight=numberOrNull(get('Weight','Weight Sum'));
    return {Name:cleanText(r.rowLabel), Ticker:cleanHoldingTicker(get('TICKER','Reuters Ticker')) || '-',
      Identifier:get('CUSIP','ISIN','SEDOL','Security Number')||'-', Weight:weight===null?'':String(weight),
      'Market Value':get('Market Value'), 'Shares Held':get('Shares/Par','Shares Held')||'-',
      'Asset Category':get('Asset Group','Asset Category')||'-', ISIN:get('ISIN'), CUSIP:get('CUSIP'), SEDOL:get('SEDOL'),
      Country:get('Country Code','Country'), Price:get('Price')};
  });
  if (rows.some((r:JsonRecord)=>!r.Name)) throw new Error('Holdings row without name');
  return {rows,asOfDate:isoDate(p.reportDate),total:p.totalResults};
}
function sortHoldings(rows:JsonRecord[]):JsonRecord[] {
  return rows.slice().sort((a,b)=>(numberOrNull(b.Weight)??-Infinity)-(numberOrNull(a.Weight)??-Infinity)||String(a.Name).localeCompare(String(b.Name))||outputContentKey(a).localeCompare(outputContentKey(b)));
}
async function officialHoldings(fund:CatalogFund,detail:JsonRecord,config:UpdaterConfig):Promise<JsonRecord|null> {
  const tabs=detail.availableFundDetailsTabs?.holdingsTab;
  if (tabs?.tab===false) return null;
  const type=tabs?.dailyHoldings?0:tabs?.quarterlyHoldings?2:tabs?.monthlyHoldings?1:null;
  if (type===null) return null; // Never pretend topTen is a complete portfolio.
  let date:string|null=null;
  const rows=await collectPages<JsonRecord>(async(skip,take)=>{
    const raw=await post('breakdown/dailyHoldings',{...basePayload(fund,detail),holdingType:type,topHoldings:false,skip,take},config);
    await storeRaw(fund.ticker,`holdings-${skip}`,raw,config);
    const p=parseHoldings(raw);
    if (date && date!==p.asOfDate) throw new Error('Holdings date changed during pagination');
    date=p.asOfDate;
    return {rows:p.rows,total:p.total};
  });
  if (!rows.length) return null;
  return {rows:sortHoldings(rows),headers:HOLDINGS_HEADERS,asOfDate:date,source:`aberdeeninvestments.com dailyHoldings (holdingType=${type})`,status:'available'};
}
export function parseKeyInformation(payload:JsonRecord):JsonRecord {
  const p=payload.content ?? payload, sc=p.shareClass, f=p.fund;
  if (!sc || !f || !sc.ticker) throw new Error('Invalid key information');
  return {
    ticker:sanitizeTicker(sc.ticker), ter:numberOrNull(sc.totalExpenseRatio), netExpense:numberOrNull(sc.netExpenseRatio),
    aum:numberOrNull(f.fundSizeWithDate?.value), aumDate:isoDate(f.fundSizeWithDate?.date),
    inception:isoDate(f.fundLaunchDate), frequency:cleanText(sc.shareClassDividendFrequency),
    secYield:numberOrNull(sc.thirtyDaySecYieldSubsidizedWithDate?.value), secYieldDate:isoDate(sc.thirtyDaySecYieldSubsidizedWithDate?.date),
    unsubsidizedSecYield:numberOrNull(sc.thirtyDaySecYieldUnsubsidizedWithDate?.value),
    category:cleanText(f.assetClass), exposure:cleanText(f.exposure), legalStructure:cleanText(f.legalStructure),
  };
}
export function decodeDividendFrequency(raw:unknown):{frequency:string;paymentsPerYear:number|null}|null {
  const s=String(raw??'').trim().toLowerCase();
  if (!s) return null;
  if (s==='m'||s==='monthly') return {frequency:'Monthly',paymentsPerYear:12};
  if (s==='q'||s.startsWith('quarter')) return {frequency:'Quarterly',paymentsPerYear:4};
  if (['s','h','semi-annually','semi-annual','semiannually'].includes(s)) return {frequency:'Semi-annually',paymentsPerYear:2};
  if (['a','y','annually','annual','yearly'].includes(s)) return {frequency:'Annually',paymentsPerYear:1};
  return {frequency:String(raw),paymentsPerYear:null};
}
type ReturnValues={ytd:number|null;yr1:number|null;yr3:number|null;yr5:number|null;yr10:number|null;sinceInception:number|null;mo1:number|null};
const EMPTY_RETURNS:ReturnValues={ytd:null,yr1:null,yr3:null,yr5:null,yr10:null,sinceInception:null,mo1:null};
export function parsePerformance(payload:JsonRecord):{values:ReturnValues;date:string|null} {
  const p=payload.content??payload;
  if (!Array.isArray(p.performanceSet)) throw new Error('Invalid performance envelope');
  const nav=p.performanceSet.find((x:JsonRecord)=>x.performanceCategoryType==='NAV');
  const values={...EMPTY_RETURNS};
  const names:Record<string,keyof ReturnValues>={timePeriodMonths1:'mo1',timePeriodYears1:'yr1',timePeriodYears3:'yr3',timePeriodYears5:'yr5',timePeriodYears10:'yr10',timePeriodLaunch:'sinceInception',timePeriodYTD:'ytd',timePeriodYearToDate:'ytd'};
  for (const v of nav?.values??[]) {
    const key=names[v.performanceTimePeriodLabel] || (/^(year to date|ytd)$/i.test(v.performanceTimePeriod)?'ytd':null);
    if (key) values[key]=numberOrNull(v.value);
  }
  return {values,date:isoDate(p.lastRelevantDate)};
}
function performanceBlock(annual:JsonRecord|null,cumulative:JsonRecord|null):JsonRecord|null {
  const a=annual?parsePerformance(annual):null, c=cumulative?parsePerformance(cumulative):null;
  const date=a?.date??c?.date;
  if (!date) return null;
  const values={...EMPTY_RETURNS};
  // Never combine different reporting dates into one month-/quarter-end row.
  for (const key of Object.keys(values) as (keyof ReturnValues)[]) values[key]=(a?.date===date?a.values[key]:null)??(c?.date===date?c.values[key]:null);
  return {asOfDate:formatEdgarDate(date),...values};
}

// SEC parsers above are copied from JPMorgan. Resolver validates fund identity:
// the latest filing for a trust is NOT necessarily this ETF's filing.
let fundTickerPromise:Promise<Map<string,SecSeriesRef>>|null=null;
let companyTickerPromise:Promise<Map<string,string>>|null=null;
const submissionsCache=new Map<string,Promise<JsonRecord>>();
async function loadFundTickerMap(config:UpdaterConfig):Promise<Map<string,SecSeriesRef>> {
  return fundTickerPromise??=fetchJson(SEC_FUND_TICKERS_URL,'[ edgar    ] ticker table',secHeaders(config),config).then(parseFundTickerMap).catch(e=>{
    console.warn(`[ edgar    ] ticker table unavailable: ${errorMessage(e)} — retaining published data when needed`);return new Map();
  });
}
async function loadCompanyTickerMap(config:UpdaterConfig):Promise<Map<string,string>> {
  return companyTickerPromise??=fetchJson(SEC_COMPANY_TICKERS_URL,'[ edgar    ] company table',secHeaders(config),config).then(parseCompanyTickerMap).catch(e=>{outputNote(`[ edgar    ] ${errorMessage(e)}`);return new Map();});
}
export function nportMatches(fund:CatalogFund,parsed:ParsedNport,ref?:SecSeriesRef):boolean {
  if (ref && parsed.regCik.replace(/^0+/,'')!==ref.cik.replace(/^0+/,'')) return false;
  if (ref?.seriesId) return parsed.seriesId===ref.seriesId;
  // Exact normalized series name only: no first-filing or partial-name guesses.
  return parsed.seriesName.toLowerCase().replace(/[^a-z0-9]/g,'')===fund.name.toLowerCase().replace(/[^a-z0-9]/g,'');
}
/** `publishedAsOf`: the published holdings date; a filing that is not newer never replaces it. A network failure with no result throws (a source failure), an honest "no matching filing" returns null. */
export async function resolveNportFiling(fund:CatalogFund,config:UpdaterConfig,publishedAsOf:string|null=null):Promise<JsonRecord|null> {
  let lastError:unknown=null;
  const table=await loadFundTickerMap(config), ref=table.get(fund.ticker);
  let candidates:NportAccession[]=[];
  if (ref?.seriesId) {
    try {candidates=parseEdgarAtomFilings(await fetchText(edgarSeriesFilingsUrl(ref.seriesId),'[ edgar    ] series',secHeaders(config),config));}
    catch(e){lastError=e;outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  let cik=ref?.cik;
  if (!cik) {
    try {cik=pickEftsCik(await fetchJson(eftsSearchUrl(fund.name),'[ edgar    ] discovery',secHeaders(config),config),fund.name)??undefined;}
    catch(e){lastError=e;outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  // Public filings verify these trust mappings; XML series still must match.
  cik??=({AGEM:'0001413594',AFSC:'0001413594',ASCI:'0001413594',AMUN:'0001413594'} as Record<string,string>)[fund.ticker];
  if (!candidates.length && cik) {
    try {
      if (!submissionsCache.has(cik)) submissionsCache.set(cik,fetchJson(`${SEC_DATA_HOST}/submissions/CIK${cik}.json`,'[ edgar    ] submissions',secHeaders(config),config));
      candidates=parseNportAccessions(await submissionsCache.get(cik)!);
    } catch(e){lastError=e;outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  for (const accession of candidates.slice(0,40)) {
    try {
      const xml=await fetchText(accession.url,`[ edgar    ] ${fund.ticker} N-PORT`,secHeaders(config),config);
      const parsed=parseNport(xml);
      if (!nportMatches(fund,parsed,ref) || !parsed.holdings.length) continue;
      // Candidates are newest first: the first series match is the newest filing; never replace fresher published holdings.
      if (publishedAsOf && parsed.repPdDate && parsed.repPdDate<=publishedAsOf) return null;
      const names=await loadCompanyTickerMap(config);
      const rows=parsed.holdings.map(row=>({...row,Ticker:names.get(normalizeHoldingName(row.Name))||names.get(normalizeHoldingNameCore(row.Name))||'-'}));
      return {rows:sortHoldings(rows),headers:['Name','Ticker','Identifier','Weight','Market Value','Shares Held','Asset Category'],asOfDate:parsed.repPdDate,source:accession.url,status:'available'};
    } catch(e){lastError=e;outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  if (lastError) throw lastError;
  return null;
}

async function tryRun<T>(action:()=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;error:unknown}> {
  try {return {ok:true,value:await action()};} catch(error){return {ok:false,error};}
}
async function optional<T>(label:string, action:()=>Promise<T>):Promise<T|null> {
  try {return await action();} catch(e){outputNote(`[ fallback ] ${label}: ${errorMessage(e)}`);return null;}
}
const percent=(v:number|null|undefined)=>v==null?'—':`${v.toFixed(2)}%`;
const money=(v:number|null|undefined)=>v==null?'—':`$${v.toFixed(2)}`;
export function mergeHistory(previous:JsonRecord[], fresh:ChartDay[]):JsonRecord[] {
  const byDate=new Map<string,JsonRecord>();
  // Dates are text ("Jun 30 2026"): parse them as calendar dates, never through the local-time Date parser.
  for (const row of previous) {
    const iso=displayDateToIso(row.Date);
    if (iso) byDate.set(iso,row);
  }
  for (const day of fresh) byDate.set(day.date,historyRows([day])[0]);
  return [...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
}
function chartDaysFromRows(rows:JsonRecord[]):ChartDay[] {
  return rows.flatMap(row=>{
    const date=displayDateToIso(row.Date), close=numberOrNull(row.Close), adjClose=numberOrNull(row['Adj Close']);
    return date&&close!==null&&adjClose!==null?[{date,close,adjClose,volume:numberOrNull(row.Volume)??0}]:[];
  });
}
function previousDividends(meta:JsonRecord):Array<{epoch:number;amount:number}> {
  return (meta.distributions?.rows??[]).flatMap((row:any[])=>{
    const date=isoDate(row[0]), amount=numberOrNull(row[1]);
    return date&&amount!==null?[{epoch:Date.parse(date)/1000,amount}]:[];
  });
}
function mergeDividends(old:JsonRecord,chart:ParsedChart|null):Array<{epoch:number;amount:number}> {
  const byDate=new Map(previousDividends(old).map(d=>[epochToIsoDate(d.epoch),d]));
  for (const d of chart?.dividends??[]) byDate.set(epochToIsoDate(d.epoch),d);
  return [...byDate.values()].sort((a,b)=>a.epoch-b.epoch);
}
/** Display dates ("Aug 31 2026"), ISO and US dates -> YYYY-MM-DD, or null. */
export function displayDateToIso(value:unknown):string|null {
  const s=String(value??'').trim();
  const m=/^([A-Za-z]{3}) (\d{1,2}) (\d{4})$/.exec(s);
  const idx=m?MONTHS.indexOf(m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()):-1;
  if (m && idx>=0) {
    const iso=`${m[3]}-${String(idx+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    return Number.isFinite(Date.parse(iso))?iso:null;
  }
  return isoDate(s);
}
export const OFFICIAL_RETURNS_BASIS='official abrdn NAV performance where published; missing metrics derived from Yahoo adjusted closes at the same reporting date';
export const YAHOO_RETURNS_BASIS='Yahoo adjusted market-price returns, not official NAV';
export function buildMetrics(month:JsonRecord|null,derived:PriceReturns,secYield:number|null,divYield:number|null,hasOfficialReturns=false):JsonRecord {
  const ytd=month?.ytd??derived.ytd, tr1y=month?.yr1??derived.yr1;
  const cagr3y=month?.yr3??derived.cagr3y,cagr5y=month?.yr5??derived.cagr5y,cagr10y=month?.yr10??derived.cagr10y;
  return {ytd,tr1y,cagr3y,cagr5y,cagr10y,tr3y:annualizedToTotal(cagr3y,3),tr5y:annualizedToTotal(cagr5y,5),tr10y:annualizedToTotal(cagr10y,10),
    siAnn:month?.sinceInception??derived.siAnn,secYield,secYieldText:percent(secYield),dividendYield:divYield,dividendYieldText:percent(divYield),
    returnsBasis:hasOfficialReturns?OFFICIAL_RETURNS_BASIS:YAHOO_RETURNS_BASIS,
    // Date of the provider performance table (or the last Yahoo close when derived), not the NAV date.
    performanceAsOf:displayDateToIso(month?.asOfDate)??(derived.asOfDate||null)};
}
export type FundOutcome = { status: 'updated' | 'skipped' | 'kept'; row?: JsonRecord; reason?: string };
const daysBetween = (fromIso: string | null, toIso: string | null): number | null => {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(`${fromIso}T00:00:00Z`), b = Date.parse(`${toIso}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 86_400_000 : null;
};
/** Distributions with an ex-date in the 12 months up to `asOfIso` over the market price; null without 12 months of history or any distribution in the window. */
export function trailingYield(dividends: Array<{ epoch: number; amount: number }>, price: number | null, asOfIso: string | null, historyStartIso: string | null): number | null {
  if (!asOfIso || !historyStartIso || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const startIso = new Date(Date.parse(`${asOfIso}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  if (historyStartIso > startIso) return null;
  const total = dividends.filter(d => { const day = epochToIsoDate(d.epoch); return day > startIso && day <= asOfIso; }).reduce((sum, d) => sum + d.amount, 0);
  return total > 0 ? round((total / price) * 100, 2) : null;
}
async function processFund(fund:CatalogFund,config:UpdaterConfig,previousIndex:JsonRecord):Promise<FundOutcome> {
  const ticker=fund.ticker, dir=new URL(`funds/${ticker}/`,API_ROOT);
  const old=await readJson(new URL('meta.json',dir))??{};
  // Published values stand in only for a source the operator skipped. A source that
  // failed keeps the whole fund as published; an honest null from a source stays null.
  const oA:JsonRecord=config.skipAberdeen?old:{}, oAny:JsonRecord=config.skipAberdeen||config.skipYahoo?old:{};
  const failed:string[]=[];
  const run=async<T>(source:string,label:string,action:()=>Promise<T>):Promise<T|null>=>{
    try {return await action();} catch(e){failed.push(source);outputNote(`[ fallback ] ${label}: ${errorMessage(e)}`);return null;}
  };
  const get=async(endpoint:string,body:JsonRecord)=>{
    const raw=await post(endpoint,body,config);
    await storeRaw(ticker,`${endpoint.replaceAll('/','-')}${body.quarterly===undefined?'':body.quarterly?'-quarter':'-month'}`,raw,config);
    return raw;
  };
  let detail:JsonRecord|null=null, key:JsonRecord|null=null, codes:JsonRecord|null=null;
  let month:JsonRecord|null=null, quarter:JsonRecord|null=null, holdings:JsonRecord|null=null, holdingsFailed=false;
  if (!config.skipAberdeen && fund.id) {
    detail=await run('detail',`${ticker} detail`,async()=>{
      const d=parseDetail(await fetchText(fund.fundPage,`[ product  ] ${ticker}`,yahooHeaders(),config));
      if (d.id!==fund.id || d.selectedShareclass?.id!==fund.shareclassId) throw new Error('Fund/share-class identity mismatch');
      await storeRaw(ticker,'detail',d,config);return d;
    });
    const body=basePayload(fund,detail??{});
    key=await run('key information',`${ticker} key information`,async()=>{
      const k=parseKeyInformation(await get('fundDetailsKeyInformation',body));
      if (k.ticker!==ticker) throw new Error('Ticker mismatch');return k;
    });
    // Evaluate known, fresh headline filters before holdings/history downloads (a skipped fund keeps its published files).
    const aum=key?.aum??old.aum?.value??previousIndex.aumValue??null;
    const ter=key?(key.netExpense??key.ter):(old.expenseRatio?.value??previousIndex.terValue??null);
    if (!inRange(aum,config.aumRange)||!inRange(ter,config.terRange)) return {status:'skipped'};
    if (!inRange(key?key.secYield:(old.yields?.secYield??null),config.secYieldRange)) return {status:'skipped'};
    codes=await run('codes',`${ticker} codes`,async()=>(await get('fundDetailsCodes',body)).content);
    if (detail?.availableFundDetailsTabs?.performanceTab?.tab!==false) {
      let ok=true;
      const blocks:(JsonRecord|null)[]=[];
      for (const quarterly of [false,true]) {
        const annual=await run('performance',`${ticker} annualized`,()=>get('performance/annualized',{...body,endpoint:'performance/annualized',quarterly}));
        const cumulative=await run('performance',`${ticker} cumulative`,()=>get('performance/cumulative',{...body,endpoint:'performance/cumulative',quarterly}));
        if (!annual||!cumulative) ok=false;
        blocks.push(performanceBlock(annual,cumulative));
      }
      if (ok) [month,quarter]=blocks;
    }
    if (detail) {
      const official=await tryRun(()=>officialHoldings(fund,detail!,config));
      if (official.ok) holdings=official.value; else {holdingsFailed=true;outputNote(`[ fallback ] ${ticker} official holdings: ${errorMessage(official.error)}`);}
    }
  }
  const physical=detail?.fundManagementApproach==='US ETFs – Physical'||/1933 Act/.test(key?.legalStructure??old.legalStructure??'');
  // 1933 Act physical trusts do not have an N-PORT securities portfolio.
  if (!holdings && config.edgarFallback && !physical) {
    const sec=await tryRun(()=>resolveNportFiling(fund,config,old.holdings?.status==='available'?old.holdings?.asOfDate??null:null));
    if (sec.ok) holdings=sec.value; else {holdingsFailed=true;outputNote(`[ fallback ] ${ticker} SEC holdings: ${errorMessage(sec.error)}`);}
  }
  if (!holdings && holdingsFailed) failed.push('holdings');
  const chart=config.skipYahoo?null:await run('yahoo',`${ticker} Yahoo`,async()=>{
    const raw=await fetchJson(chartUrl(ticker,config),`[ chart    ] ${ticker}`,yahooHeaders(),config);
    await storeRaw(ticker,'yahoo',raw,config);return parseChart(raw);
  });
  const hasPublished=Object.keys(old).length>0&&Boolean(previousIndex.ticker);
  if (failed.length) {
    const reason=`source failed: ${[...new Set(failed)].join(', ')}`;
    // Fund-level consistency: fully updated or fully kept as published.
    if (hasPublished) return {status:'kept',row:previousIndex,reason};
    throw new Error(`${ticker}: ${reason}; nothing published to keep`);
  }
  if (!holdings) {
    const rows=await readPreviousSheet(ticker,'holdings'), headers=await readPreviousSheetHeaders(ticker,'holdings');
    if (old.holdings?.totalRows && rows.length!==old.holdings.totalRows) throw new Error(`${ticker}: previous holdings incomplete; refusing overwrite`);
    holdings={...old.holdings,rows,headers:headers.length?headers:HOLDINGS_HEADERS,asOfDate:old.holdings?.asOfDate??null,
      source:old.holdings?.source??(physical?'not published as a securities portfolio (physical precious metals trust)':'unavailable from official/SEC sources'),
      status:old.holdings?.status??(rows.length?'available':physical?'not-applicable':'unavailable')};
  }
  const oldHistory=await readPreviousSheet(ticker,'history');
  if (old.history?.totalRows && oldHistory.length!==old.history.totalRows) throw new Error(`${ticker}: previous history incomplete; refusing overwrite`);
  const history=chart?.days.length?mergeHistory(oldHistory,chart.days):oldHistory;
  const days=chartDaysFromRows(history);
  const dividends=mergeDividends(old,chart), latest=dividends.at(-1)??null;
  const frequency=decodeDividendFrequency(key?.frequency??oA.distributions?.frequency)??(dividends.length?inferDistributionFrequency(dividends):{frequency:'—',paymentsPerYear:null});
  const sc=detail?.selectedShareclass;
  const officialMarket=sc?.investmentTrustPrices?.[0], officialNav=sc?.prices?.[0];
  const nav=numberOrNull(officialNav?.pricePerUnit)??fund.nav??oA.nav?.value??null;
  const navDate=isoDate(officialNav?.currentAsAt)??fund.navDate??displayDateToIso(oA.nav?.asOfDate);
  const price=numberOrNull(officialMarket?.exchangePrice)??chart?.regularMarketPrice??oAny.marketPrice?.value??null;
  const priceDate=isoDate(officialMarket?.exchangeDate)??(chart?.regularMarketTime?epochToIsoDate(chart.regularMarketTime):displayDateToIso(oAny.marketPrice?.asOfDate));
  // Never compute a premium from prices belonging to different days; unmatched dates give null.
  const premium=nav!==null&&nav>0&&price!==null&&navDate&&navDate===priceDate?round((price/nav-1)*100,2):null;
  const aum=key?key.aum:(oA.aum?.value??previousIndex.aumValue??null);
  // terValue is the NET expense ratio (after waivers; the single published figure when there is only one), gross is kept alongside.
  const terGross=key?key.ter:(oA.expenseRatio?.gross??null), terNet=key?key.netExpense:(oA.expenseRatio?.net??null);
  const ter=terNet??terGross;
  const secYield=key?key.secYield:(oA.yields?.secYield??null);
  const asOfForYield=priceDate??(days.length?days.at(-1)!.date:null);
  const divYield=trailingYield(dividends,price,asOfForYield,days.length?days[0].date:null);
  const freshOfficialReturns=Boolean(month);
  const oldOfficial=Boolean(old.returns?.derivedFrom)&&!String(old.returns.derivedFrom).startsWith('Yahoo adjusted');
  // A published official table is reused only when the operator skipped abrdn; an old Yahoo-derived block never stands in for it.
  if (!month&&config.skipAberdeen&&oldOfficial) {month=old.returns?.monthEnd??null; quarter=old.returns?.quarterEnd??null;}
  const monthIso=displayDateToIso(month?.asOfDate);
  const anchor=monthIso?new Date(`${monthIso}T00:00:00Z`):days.length?new Date(`${days.at(-1)!.date}T00:00:00Z`):null;
  const usable=anchor?days.filter(d=>Date.parse(`${d.date}T00:00:00Z`)<=anchor.getTime()):[];
  const derived=usable.length?priceReturns(usable,anchor!):{...EMPTY_PRICE_RETURNS};
  // A range-limited Yahoo download is not a since-inception return.
  if (!chart?.firstTradeDate || !days.length || Date.parse(`${days[0].date}T00:00:00Z`)/1000-chart.firstTradeDate>7*86400) derived.siAnn=null;
  const hasOfficialReturns=freshOfficialReturns || Boolean(month);
  const inception=key?key.inception??(chart?.firstTradeDate?epochToIsoDate(chart.firstTradeDate):null):(oA.inception?.fundInceptionDate??(chart?.firstTradeDate?epochToIsoDate(chart.firstTradeDate):null));
  const metrics=buildMetrics(month,derived,secYield,divYield,hasOfficialReturns);
  // since-inception is annualized only for a fund with at least a year of life at the as-of date
  const siAllowed=(daysBetween(inception,metrics.performanceAsOf)??0)>=365;
  if (!siAllowed) metrics.siAnn=null;
  if(month) month={...month,ytd:month.ytd??derived.ytd,mo1:month.mo1??derived.mo1,qtd:month.qtd??derived.qtd,...(siAllowed?{}:{sinceInception:null})};
  if (!month && usable.length) {
    month={asOfDate:formatEdgarDate(derived.asOfDate!),mo1:derived.mo1,qtd:derived.qtd,ytd:derived.ytd,yr1:derived.yr1,yr3:derived.cagr3y,yr5:derived.cagr5y,yr10:derived.cagr10y,sinceInception:siAllowed?derived.siAnn:null};
  }
  const filtered=fundFilterReasons({ticker,aumValue:aum,terValue:ter,metrics},config);
  if (filtered.length) return {status:'skipped'};
  const category=key?.category||fund.assetClass||old.category||'ETF';
  const exchange=chart?.exchangeName||old.inception?.exchange||previousIndex.exchange||'';
  // Order: pages, then meta.json, then stale-page cleanup; the index row is written by the caller last.
  const holdingsManifest=await writePages(dir,ticker,'holdings',holdings.headers,holdings.rows,config.holdingsPageSize);
  const oldHistoryHeaders=await readPreviousSheetHeaders(ticker,'history');
  const historyManifest=await writePages(dir,ticker,'history',chart?.days.length?['Date','Close','Adj Close','Volume']:oldHistoryHeaders.length?oldHistoryHeaders:['Date','Close','Adj Close','Volume'],history,config.historyPageSize);
  const historySource=chart?.days.length?'Yahoo Finance daily market-price closes / adjusted closes (not official NAV)':old.history?.source??'unavailable';
  const returnsBasis=metrics.returnsBasis;
  const meta={
    ticker,name:fund.name,category,categoryPath:key?.exposure?`${category} / ${key.exposure}`:old.categoryPath??category,
    source:{fundPage:fund.fundPage,catalog:CATALOG_PAGE,keyInformation:`${GATEWAY}/fundDetailsKeyInformation`,holdingsDownload:`${GATEWAY}/breakdown/dailyHoldingsSheet`,
      holdingsSource:holdings.source,historySource,yahooChart:`${YAHOO_CHART_URL}/${ticker}`,provider:'abrdn official gateway; SEC EDGAR N-PORT-P holdings fallback; Yahoo Finance market-history/dividend fallback'},
    providerIds:fund,legalStructure:key?key.legalStructure:(old.legalStructure??null),
    identifiers:{cusip:codes?codes.cusip??null:(oA.identifiers?.cusip??null),isin:codes?.isin??fund.isin??old.identifiers?.isin??null,indexTicker:old.identifiers?.indexTicker??null},
    inception:{fundInceptionDate:inception,shareClassInceptionDate:old.inception?.shareClassInceptionDate??null,exchange},
    expenseRatio:{display:percent(ter),value:ter,gross:terGross,net:terNet},
    nav:{display:money(nav),value:nav,asOfDate:navDate?formatEdgarDate(navDate):'—'},
    marketPrice:{display:money(price),value:price,asOfDate:priceDate?formatEdgarDate(priceDate):'—'},
    premiumDiscount:{display:percent(premium),value:premium},
    aum:{display:aum===null?'—':formatAumDisplay(aum),value:aum,asOfDate:key?.aumDate?formatEdgarDate(key.aumDate):oA.aum?.asOfDate??'—',source:key?.aum!=null?'aberdeeninvestments.com fundDetailsKeyInformation':oA.aum?.source??'unavailable'},
    yields:{dividendYield:metrics.dividendYield,dividendYieldText:metrics.dividendYieldText,dividendYieldKind:'trailing 12 months (distributions with an ex-date in the last 12 months / market price; null with under 12 months of history)',
      secYield:metrics.secYield,secYieldText:metrics.secYieldText,secYieldKind:key?.secYield!=null?`30-day SEC yield subsidized, as of ${key.secYieldDate??'unknown'}`:oA.yields?.secYieldKind??'not published',unsubsidizedSecYield:key?key.unsubsidizedSecYield:(oA.yields?.unsubsidizedSecYield??null)},
    returns:{monthEnd:month,quarterEnd:quarter,derivedFrom:returnsBasis,performanceAsOf:metrics.performanceAsOf},
    distributions:{frequency:frequency.frequency,paymentsPerYear:frequency.paymentsPerYear,headers:['Ex-Date','Amount'],rows:distributionRows(dividends)},
    holdings:{...holdingsManifest,asOfDate:holdings.asOfDate,asOf:holdings.asOfDate?formatEdgarDate(holdings.asOfDate):'—',source:holdings.source,status:holdings.status},
    history:{...historyManifest,asOf:days.length?formatEdgarDate(days.at(-1)!.date):old.history?.asOf??'—',source:historySource},
  };
  await writeIfChanged(new URL('meta.json',dir),meta);
  await removeStalePages(dir,'holdings',new Set(holdingsManifest.pages));
  await removeStalePages(dir,'history',new Set(historyManifest.pages));
  return {status:'updated',row:{ticker,name:fund.name,category,fundPage:fund.fundPage,dataFile:`./funds/${ticker}/meta.json`,
    cusip:meta.identifiers.cusip,isin:meta.identifiers.isin,ter:meta.expenseRatio.display,terValue:ter,terGross:percent(terGross),terGrossValue:terGross,nav:meta.nav.display,navValue:nav,aum:meta.aum.display,aumValue:aum,
    asOfDate:meta.nav.asOfDate,inceptionDate:inception?formatEdgarDate(inception):'—',exchange,closePrice:meta.marketPrice.display,closePriceValue:price,premiumDiscount:meta.premiumDiscount.display,premiumDiscountValue:premium,
    distributions:{frequency:frequency.frequency,exDate:latest?formatUsDate(latest.epoch):'—',dividend:latest?String(round(latest.amount,6)):'—'},returns:meta.returns,metrics,holdings:holdings.rows.length,history:history.length}};
}

/** Funds that pass the TICKERS allowlist, in cursor order (the fund after the cursor first, wrapping around). */
export function selectionOrder(funds:CatalogFund[],config:UpdaterConfig,cursor:string|null):CatalogFund[] {
  const selected=funds.filter(f=>!config.tickers.length||config.tickers.includes(f.ticker));
  if (!config.maxFetches) return selected;
  const i=selected.findIndex(f=>f.ticker===cursor);
  return i<0?selected:selected.slice(i+1).concat(selected.slice(0,i+1));
}
// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// File defaults and explicit overrides. Allowlisted scalar values only: the
// same resolver is used by Actions without interpolating user input into bash.
export const CONTROL_NAMES = [
  'MAX_FETCHES','REQUEST_SLEEP','CONCURRENCY','AUM','TER','DIVIDEND_YIELD','SEC_YIELD','TICKERS',
  'HOLDINGS_PAGE_SIZE','HISTORY_PAGE_SIZE','MAX_RETRIES','HISTORY_RANGE','STORE_RAW_DOWNLOADS',
  'SEC_UA','SKIP_YAHOO','SKIP_ABERDEEN','EDGAR_FALLBACK','VERBOSE','USE_SYSTEM_CA',
  ...['PERFORMANCE','TOTAL_RETURN'].flatMap(prefix=>['YTD','1Y','3Y','5Y','10Y'].map(period=>`${prefix}_${period}`)),
] as const;
// Brand/legacy environment aliases, resolved here so the CLI and Actions behave the same.
export const CONTROL_ALIASES: Record<string, string[]> = {
  MAX_FETCHES: ['ABERDEEN_LIMIT'],
  HISTORY_PAGE_SIZE: ['ABERDEEN_HISTORICAL_PAGE_SIZE', 'HISTORICAL_PAGE_SIZE'],
};
export function resolveControls(file:unknown={},advanced:unknown={},inputs:unknown={},env:Record<string,string|undefined>={}):Record<string,string> {
  const result:Record<string,string>={};
  const apply=(value:unknown,skipEmpty=false)=>{
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key,raw] of Object.entries(value)) {
      if (!CONTROL_NAMES.includes(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw===''||raw===undefined||raw===null)) continue;
      if (!['string','number','boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text=String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key]=text;
    }
  };
  apply(file);apply(advanced);apply(inputs,true);
  for(const key of CONTROL_NAMES){
    const names=[`ABERDEEN_${key}`,key,...(CONTROL_ALIASES[key]??[])];
    const value=names.map(name=>env[name]).find(v=>v!==undefined);
    if(value!==undefined)apply({[key]:value});
  }
  for(const key of ['MAX_FETCHES','CONCURRENCY','HOLDINGS_PAGE_SIZE','HISTORY_PAGE_SIZE','MAX_RETRIES']){
    const v=result[key];if(v===undefined||v==='')continue;
    const min=key==='MAX_FETCHES'?0:1;
    if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<min)throw new Error(`${key}: expected integer >= ${min}`);
  }
  if(result.REQUEST_SLEEP && (!Number.isFinite(Number(result.REQUEST_SLEEP))||Number(result.REQUEST_SLEEP)<0))throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  if(result.HISTORY_RANGE && !/^(max|[1-9]\d*y)$/i.test(result.HISTORY_RANGE))throw new Error('HISTORY_RANGE: use max or Ny');
  for(const key of ['STORE_RAW_DOWNLOADS','SKIP_YAHOO','SKIP_ABERDEEN','EDGAR_FALLBACK','VERBOSE']){
    if(result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key]))throw new Error(`${key}: expected boolean`);
  }
  if(result.USE_SYSTEM_CA!==undefined && result.USE_SYSTEM_CA!==''){
    if(!/^(auto|true|false)$/i.test(result.USE_SYSTEM_CA))throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA=result.USE_SYSTEM_CA.toLowerCase();
  }
  readConfig(result); // validate all min:max filters before a request or write
  return result;
}
export async function runtimeControls(env:Record<string,string|undefined>):Promise<Record<string,string>> {
  let file:unknown={};
  try {file=JSON.parse(await readFile(new URL('./update-data.config.json',import.meta.url),'utf8'));}
  catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  return resolveControls(file,{}, {},env);
}

// The run stops taking new funds at a soft deadline (workflow timeout is 30 min) and still writes the index.
let runDeadlineMs = 25 * 60_000;
export function setRunDeadlineMs(ms: number): void { runDeadlineMs = ms; }
const isoSeconds = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function main(env:Record<string,string|undefined>=process.env):Promise<void> {
  const startedAt=Date.now();
  const controls=await runtimeControls(env);
  if(controls.VERBOSE!==undefined)process.env.VERBOSE=controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA??'auto');
  const config=readConfig(controls); setRequestSleep(config.requestSleep);
  outputPrintConfig('abrdn',config);
  const previous=await readJson(INDEX_FILE), oldFunds=new Map<string,JsonRecord>((previous?.funds??[]).map((f:JsonRecord)=>[f.ticker,f]));
  let catalog:CatalogFund[]|null=null;
  if (!config.skipAberdeen) catalog=await optional('catalog',()=>loadCatalog(config));
  const officialCatalog=catalog!==null;
  if (!catalog) {
    console.warn('[ catalog  ] official source unavailable/skipped — using published provider identities');
    catalog=[];
    for (const [ticker,row] of oldFunds) {
      const meta=await readJson(new URL(`funds/${ticker}/meta.json`,API_ROOT));
      if (meta?.providerIds) catalog.push(meta.providerIds);
      else catalog.push({ticker,name:row.name,id:'',shareclassId:'',isin:row.isin??'',assetClass:row.category??'ETF',correlationFundRangeId:'',fundPage:row.fundPage,nav:row.navValue??null,navDate:isoDate(row.asOfDate)});
    }
  }
  catalog.sort((a,b)=>a.ticker.localeCompare(b.ticker));
  if (!catalog.length) throw new Error('No official or previously published catalog; refusing empty success');
  console.log(`[ catalog  ] ${catalog.length} abrdn ETFs (official gateway / published fallback)`);
  const known=new Set(catalog.map(f=>f.ticker)), unknown=config.tickers.filter(t=>!known.has(t));
  if (unknown.length) throw new Error(`Unknown TICKERS: ${unknown.join(', ')} (not in the catalog of ${catalog.length} funds)`);
  const newFunds=officialCatalog&&oldFunds.size?catalog.filter(f=>!oldFunds.has(f.ticker)).map(f=>f.ticker):[];
  if (newFunds.length) console.log(`NEW FUNDS: ${newFunds.join(', ')}`);
  const state=await readJson(STATE_FILE), order=selectionOrder(catalog,config,state?.cursor??null);
  outputPrintFilter(order.length,catalog.length,outputHasOutputFilters(config));
  const limit=config.maxFetches;
  const reporter=outputCreateReporter(API_ROOT,limit&&!outputHasOutputFilters(config)?Math.min(limit,order.length):order.length), result=new Map(oldFunds);
  const deadlineAt=startedAt+runDeadlineMs;
  let failures=0,processed=0,skipped=0,kept=0,examined=0,truncated=false,position=0,lastExamined:CatalogFund|null=null;
  // A bounded batch counts funds that pass the filters: keep taking funds in cursor order until MAX_FETCHES of them were updated.
  while (position<order.length && !truncated && (!limit||processed<limit)) {
    const size=limit?Math.min(order.length-position,limit-processed):order.length-position;
    const chunk=order.slice(position,position+size);
    let next=0,done=0;
    const worker=async()=>{
      for (;;) {
        if (Date.now()>deadlineAt) {truncated=true;return;}
        const i=next++; if(i>=chunk.length)return;
        const fund=chunk[i],before=await reporter.before(fund.ticker);
        try {
          const outcome=await processFund(fund,config,oldFunds.get(fund.ticker)??{});
          if(outcome.status==='updated'){result.set(fund.ticker,outcome.row!);processed++;}
          else if(outcome.status==='kept')kept++;
          else skipped++;
          await reporter.result(fund.ticker,before,outcome.status==='updated'?undefined:outcome.status,outcome.reason);
        } catch(e) {failures++;await reporter.result(fund.ticker,before,'failed',errorMessage(e));}
        done++;
      }
    };
    await runWorkers(config.concurrency,worker);
    examined+=done;
    if (done===chunk.length) lastExamined=chunk.at(-1)!;
    position+=size;
  }
  if (truncated) console.log(`[ deadline ] stopped taking new funds after ${Math.round(runDeadlineMs/60_000)} min; ${order.length-examined} of ${order.length} not examined`);
  if (!result.size) throw new Error('No publishable funds; not replacing the index');
  const funds=[...result.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
  const counts={funds:funds.length,holdings:funds.reduce((s,f)=>s+f.holdings,0),history:funds.reduce((s,f)=>s+f.history,0)};
  const stamp=isoSeconds();
  await writeIfChanged(INDEX_FILE,{generatedAt:stamp,catalogReadAt:stamp,source:{provider:'abrdn ETFs',site:ABERDEEN_SITE,catalog:CATALOG_PAGE},counts,funds});
  // The cursor follows deterministic order, not completion order, and is advanced only by an unfiltered-by-ticker run
  // without failures or truncation; a TICKERS run never reads, moves or deletes it.
  if (!config.tickers.length && !failures && !truncated) {
    if (limit) {if (lastExamined) await writeIfChanged(STATE_FILE,{cursor:lastExamined.ticker});}
    else await rm(STATE_FILE,{force:true});
  }
  console.log(`[ done     ] ${processed} funds processed, ${skipped} skipped, ${kept} kept as published, ${failures} failures`);
  console.log(`[ done     ] counts: ${counts.funds} funds / ${counts.holdings} holdings rows / ${counts.history} history rows`);
  if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`### abrdn update\n\n${processed} processed; ${skipped} skipped; ${kept} kept as published; ${failures} failed.\n${counts.funds} funds / ${counts.holdings} holdings / ${counts.history} history rows.\n${newFunds.length?`\nNEW FUNDS: ${newFunds.join(', ')}\n`:''}${truncated?'\nStopped at the soft deadline; remaining funds keep their published data.\n':''}`);
  // Non-zero when anything failed, or when every examined fund failed or was kept because a source failed.
  if(failures||(examined>0&&kept===examined))process.exitCode=1;
}
if(import.meta.main){
  if(process.argv.some(a=>a==='--help'||a==='-h')){
    console.log('abrdn ETF updater — bun scripts/update-data.ts\nCanonical environment controls (ABERDEEN_ aliases accepted):');
    outputPrintConfig('abrdn effective configuration',readConfig(await runtimeControls(process.env)));
    console.log('Defaults: scripts/update-data.config.json; explicit environment overrides the file. Actions: file < advanced JSON < individual inputs.');
    console.log('Ranges: min:max (inclusive, AND). AUM: amounts with K/M/B/T or nano/micro/small/mid/large.\nMAX_FETCHES=0: full pass/reset cursor; positive: resumable batch that counts funds passing the filters.\nTICKERS: comma/space/semicolon-separated allowlist (an unknown ticker is an error); others keep published data.\nREQUEST_SLEEP: seconds between request starts, paced per worker lane. CONCURRENCY: parallel fund workers (about N times the request rate).\nHISTORY_RANGE: max or Ny; merges with prior history. SKIP_*: skip provider.\nSTORE_RAW_DOWNLOADS: source JSON snapshots. SEC_UA: real identifying contact.\nVERBOSE=1: per-request fallback diagnostics.\nUSE_SYSTEM_CA: auto (restart once with Bun --use-system-ca on an untrusted-certificate error), true or false.');
  }else await main().catch(e=>{console.error(`[ done     ] ${errorMessage(e)}`);process.exitCode=1;});
}
