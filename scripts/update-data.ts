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
  return `[ ${`${String(index).padStart(width)}/${total}`.padEnd(8)} ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
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
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
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

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}

// ---------------------------------------------------------------------------
// SEC EDGAR fallback: N-PORT-P positions for funds whose official holdings are
// unavailable. The shared nport-reader block at the end of this file finds,
// reads and checks the filing; a fund missing from SEC's fund ticker table
// gets its registrant from the EDGAR full-text search by name (or the
// verified NPORT_REGISTRANTS table) and is then matched by its fund name.
// ---------------------------------------------------------------------------
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

// adjCloseRaw: Yahoo's unrounded value, only used to tell float noise from a real change (never persisted).
export type ChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };

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
      adjCloseRaw: adjClose,
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

/** A gateway or display date as ISO, or null: plain calendar text, never the local time zone (shared calendar-dates block). */
export function isoDate(value: unknown): string | null {
  const s = String(value ?? '').trim();
  // a U.S. date with a time of day ("8/31/2026 12:00:00 AM") keeps its calendar part
  const usWithTime = /^(\d{1,2}\/\d{1,2}\/\d{4})\s/.exec(s);
  return calendarIso(s) ?? (usWithTime ? calendarIso(usWithTime[1]) : null);
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
  // The site moved pageData under pageProps.page (seen 2026-10-12); the old location stays as a fallback.
  const pageProps=m ? JSON.parse(m[1])?.props?.pageProps : null;
  const detail=(pageProps?.page?.pageData ?? pageProps?.pageData)?.fundDetailsData ?? null;
  if (!detail?.id || !detail.isPageAvailable) throw new Error('Missing fundDetailsData');
  return detail;
}
export const HOLDINGS_HEADERS=['Name','Ticker','Identifier','Weight','Market Value','Shares Held','Asset Category','ISIN','CUSIP','SEDOL','Country','Price'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
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

/** Share classes SEC's fund ticker table does not list, with the registrant (abrdn Funds) their public filings name; the filing must still name the fund. */
const NPORT_REGISTRANTS:Record<string,string>={AGEM:'0001413594',AFSC:'0001413594',ASCI:'0001413594',AMUN:'0001413594'};
/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState:{funds:Promise<Map<string,NportSeriesRef>>|null;names:Promise<Map<string,string>>|null;reader:Map<string,unknown>}={funds:null,names:null,reader:new Map()};
/** A fresh SEC state for a run (main and tests). */
export function resetSecState():void {
  secState={funds:null,names:null,reader:new Map()};
}
/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config:UpdaterConfig):Promise<Map<string,NportSeriesRef>> {
  if (!secState.funds) {
    const loading=fetchJson(SEC_FUND_TICKERS_URL,'[ edgar    ] ticker table',secHeaders(config),config).then((payload)=>parseSecFundTickers(payload));
    secState.funds=loading;
    loading.catch(()=>{if (secState.funds===loading) secState.funds=null;});
  }
  return secState.funds;
}
/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config:UpdaterConfig):Promise<Map<string,string>> {
  if (!secState.names) {
    const loading=fetchJson(SEC_COMPANY_TICKERS_URL,'[ edgar    ] company table',secHeaders(config),config).then((payload)=>parseSecCompanyNames(payload));
    secState.names=loading;
    loading.catch(()=>{if (secState.names===loading) secState.names=null;});
  }
  return secState.names;
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
}
/**
 * The abrdn holdings sheet of an N-PORT filing, with exactly the published HOLDINGS_HEADERS. A missing number stays empty
 * (never 0), a missing text is '-'; tickers come from nportTickers (U.S. equities only), identifiers are the position's own.
 */
export function nportHoldingsSheet(filing:NportFiling,tickers:ReadonlyArray<string>):JsonRecord[] {
  return filing.positions.map((position,index)=>({
    Name:position.name||'-',Ticker:tickers[index]||'-',Identifier:nportIdentifier(position)||'-',
    Weight:nportCell(position.weight),'Market Value':nportCell(position.value,2),'Shares Held':nportCell(position.balance),
    'Asset Category':position.assetCat||'-',ISIN:position.isin,CUSIP:position.cusip,SEDOL:/sedol/i.test(position.otherDesc)?position.other:'',
    Country:position.country,Price:'',
  }));
}
/**
 * The fund's newest own N-PORT-P filing as a holdings block, or null with the reason in the log (no filing, not its series or
 * name, not strictly newer than the published holdings). A fund in SEC's fund ticker table is read through its series id; one
 * that is not gets its registrant from the full-text search or NPORT_REGISTRANTS and is matched by its fund name.
 */
async function nportHoldings(fund:CatalogFund,config:UpdaterConfig,old:JsonRecord):Promise<JsonRecord|null> {
  const table=await loadFundTickerTable(config).catch((e)=>{outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);return null;});
  const ref=table?table.get(fund.ticker):undefined;
  let cik=ref?.cik;
  if (!cik) cik=(await optional(`${fund.ticker} EDGAR full-text search`,async()=>pickEftsCik(await fetchJson(eftsSearchUrl(fund.name),'[ edgar    ] discovery',secHeaders(config),config),fund.name)))??NPORT_REGISTRANTS[fund.ticker];
  if (!cik) {outputNote(`[ edgar    ] ${fund.ticker}: no registrant CIK in SEC's fund ticker table or the full-text search`);return null;}
  // a registrant of many series files one N-PORT-P per series and period: read up to 40 documents to find the fund's own by name
  const read=await readNportHoldings({ticker:fund.ticker,cik,seriesId:ref?ref.seriesId:null,name:fund.name},{asOf:old.holdings?.asOfDate,rows:numberOrNull(old.holdings?.totalRows)??0},
    (url,label)=>fetchText(url,`[ edgar    ] ${label}`,secHeaders(config),config),{cache:secState.reader,maxDocuments:ref?undefined:40});
  if ('problem' in read) {outputNote(`[ edgar    ] ${read.problem}`);return null;}
  if (read.loose) outputNote(`[ edgar    ] ${fund.ticker}: ${read.candidate.accession} matched by a partial fund name ("${read.filing.seriesName}")`);
  const names=await loadCompanyNames(config).catch(()=>null);
  const rows=nportHoldingsSheet(read.filing,nportTickers(read.filing.positions,names,await loadUsListings((url,label)=>fetchText(url,`[ edgar    ] ${label}`,secHeaders(config),config))));
  return {rows:sortHoldings(rows),headers:HOLDINGS_HEADERS,asOfDate:read.filing.repPdDate||null,
    source:`SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate||'n/a'}): ${read.url}`,status:'available'};
}

async function tryRun<T>(action:()=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;error:unknown}> {
  try {return {ok:true,value:await action()};} catch(error){return {ok:false,error};}
}
async function optional<T>(label:string, action:()=>Promise<T>):Promise<T|null> {
  try {return await action();} catch(e){outputNote(`[ fallback ] ${label}: ${errorMessage(e)}`);return null;}
}
const percent=(v:number|null|undefined)=>v==null?'—':`${v.toFixed(2)}%`;
const money=(v:number|null|undefined)=>v==null?'—':`$${v.toFixed(2)}`;
// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE=1e-4;
export function mergeHistory(previous:JsonRecord[], fresh:ChartDay[]):JsonRecord[] {
  const byDate=new Map<string,JsonRecord>();
  // Dates are text ("Jun 30 2026"): parse them as calendar dates, never through the local-time Date parser.
  for (const row of previous) {
    const iso=displayDateToIso(row.Date);
    if (iso) byDate.set(iso,row);
  }
  for (const day of fresh) {
    const row=historyRows([day])[0], prior=byDate.get(day.date), priorAdj=prior?numberOrNull(prior['Adj Close']):null, raw=day.adjCloseRaw??day.adjClose;
    if (prior&&priorAdj!==null&&row['Adj Close']!==prior['Adj Close']&&Math.abs(raw-priorAdj)<=0.005+ADJ_CLOSE_NOISE) row['Adj Close']=prior['Adj Close'];
    byDate.set(day.date,row);
  }
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
  return isoDate(value);
}
export const OFFICIAL_RETURNS_BASIS='official abrdn NAV performance where published; missing metrics derived from Yahoo adjusted closes at the same reporting date';
export const YAHOO_RETURNS_BASIS='Yahoo adjusted market-price returns, not official NAV';
// dividendYieldBasis: code for the definition behind dividendYield (null exactly when the yield is null).
// abrdn publishes no yield in its payloads: the only source is the updater's trailing-12-month sum of Yahoo distributions / market price.
export type DividendYieldSource='computed-trailing-12m';
export const YIELD_BASIS_BY_SOURCE:Record<DividendYieldSource,'computed-trailing-12m'>={'computed-trailing-12m':'computed-trailing-12m'};
export const yieldBasisCode=(dividendYield:number|null|undefined,source:DividendYieldSource='computed-trailing-12m'):string|null=>
  dividendYield===null||dividendYield===undefined?null:YIELD_BASIS_BY_SOURCE[source];
/** Rows published before the code existed (kept, skipped or not selected in this run) get it from their own yield: every earlier yield was the computed trailing one. */
export function withYieldBasis(row:JsonRecord):JsonRecord {
  const m=row.metrics as JsonRecord|undefined;
  if(!m||typeof m!=='object')return row;
  const code=yieldBasisCode(numberOrNull(m.dividendYield));
  const metrics:JsonRecord={};
  for(const [k,v] of Object.entries(m)){if(k==='dividendYieldBasis')continue;metrics[k]=v;if(k==='dividendYieldText')metrics.dividendYieldBasis=code;}
  if(!('dividendYieldBasis' in metrics))metrics.dividendYieldBasis=code;
  return {...row,metrics};
}
export function buildMetrics(month:JsonRecord|null,derived:PriceReturns,secYield:number|null,divYield:number|null,hasOfficialReturns=false):JsonRecord {
  const ytd=month?.ytd??derived.ytd, tr1y=month?.yr1??derived.yr1;
  const cagr3y=month?.yr3??derived.cagr3y,cagr5y=month?.yr5??derived.cagr5y,cagr10y=month?.yr10??derived.cagr10y;
  return {ytd,tr1y,cagr3y,cagr5y,cagr10y,tr3y:annualizedToTotal(cagr3y,3),tr5y:annualizedToTotal(cagr5y,5),tr10y:annualizedToTotal(cagr10y,10),
    siAnn:month?.sinceInception??derived.siAnn,secYield,secYieldText:percent(secYield),dividendYield:divYield,dividendYieldText:percent(divYield),dividendYieldBasis:yieldBasisCode(divYield),
    returnsBasis:hasOfficialReturns?OFFICIAL_RETURNS_BASIS:YAHOO_RETURNS_BASIS,
    // Date of the provider performance table (or the last Yahoo close when derived), not the NAV date.
    performanceAsOf:displayDateToIso(month?.asOfDate)??(derived.asOfDate||null)};
}
export type FundOutcome = { status: 'updated' | 'skipped' | 'kept'; row?: JsonRecord; reason?: string };
export const NO_DATA_BASIS='no data published for this fund yet; the next successful update fills it';
/** Index row of a catalog fund with no published meta.json (new, or its first update failed or the guard rejected it): catalog headlines only, dataFile null, every metric unknown (null). */
export function catalogOnlyRow(fund:CatalogFund):JsonRecord {
  const metrics={...buildMetrics(null,{...EMPTY_PRICE_RETURNS},null,null),returnsBasis:NO_DATA_BASIS};
  return {ticker:fund.ticker,name:fund.name,category:fund.assetClass||'ETF',fundPage:fund.fundPage,dataFile:null,cusip:null,isin:fund.isin||null,ter:'—',terValue:null,terGross:'—',terGrossValue:null,
    nav:money(fund.nav),navValue:fund.nav,aum:'—',aumValue:null,asOfDate:fund.navDate?formatEdgarDate(fund.navDate):'—',inceptionDate:'—',exchange:'',closePrice:'—',closePriceValue:null,premiumDiscount:'—',premiumDiscountValue:null,
    distributions:{frequency:'—',exDate:'—',dividend:'—'},returns:{monthEnd:null,quarterEnd:null,derivedFrom:NO_DATA_BASIS,performanceAsOf:null},metrics,holdings:0,history:0};
}
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
    // the fund's own newest filing, read only when strictly newer than the published holdings (shared nport-reader block)
    const sec=await tryRun(()=>nportHoldings(fund,config,old));
    if (sec.ok) holdings=sec.value; else {holdingsFailed=true;outputNote(`[ fallback ] ${ticker} SEC holdings: ${errorMessage(sec.error)}`);}
  }
  if (!holdings && holdingsFailed) failed.push('holdings');
  // Fresh holdings (official dailyHoldings or N-PORT) that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone,
  // not one numeric weight where the published sheet had them) never replace the published ones: the fund fails before any write and keeps its
  // published files and index row; a fund with nothing published is not written.
  const publishedWeights=holdings&&Object.keys(old).length?holdingsWeightCount(await readPreviousSheetHeaders(ticker,'holdings'),await readPreviousSheet(ticker,'holdings')):null;
  const holdingsProblem=holdings?holdingsGuard(holdings.headers,holdings.rows,numberOrNull(old.holdings?.totalRows),HOLDINGS_GUARD_RELAX[ticker]??HOLDINGS_GUARD_RELAX['*']??[],publishedWeights):null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${Object.keys(old).length?'kept the previous complete data':'no data published for this fund yet'}`);
  const chart=config.skipYahoo?null:await run('yahoo',`${ticker} Yahoo`,async()=>{
    const raw=await fetchJson(chartUrl(ticker,config),`[ chart    ] ${ticker}`,yahooHeaders(),config);
    await storeRaw(ticker,'yahoo',raw,config);
    const fetched=parseChart(raw);
    // A fresh chart never shrinks the published history: a HISTORY_RANGE window, and also a truncated `max` answer (2026-10-29: Yahoo
    // returned 2 bars for Franklin DVAL and USFI). A full `max` answer starts at inception: nothing older, unchanged. Older rows are put on the fresh Adj Close basis (shared windowed-chart block)
    const merged=mergeWindowedChart(fetched,await readPreviousSheet(ticker,'history'),Array.isArray(old.distributions?.rows)?old.distributions.rows:[]);
    if (!merged) throw new Error(`chart does not join the published history (${config.historyRange}, ${fetched.days.length} days)`);
    return merged;
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
    const previousHoldings:JsonRecord={...old.holdings,rows,headers:headers.length?headers:HOLDINGS_HEADERS,asOfDate:old.holdings?.asOfDate??null,
      source:old.holdings?.source??(physical?'not published as a securities portfolio (physical precious metals trust)':'unavailable from official/SEC sources'),
      status:old.holdings?.status??(rows.length?'available':physical?'not-applicable':'unavailable')};
    holdings=previousHoldings;
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
  // The shared "younger than its horizon" rule on the final returns, official or derived: no 1-year or since-inception
  // return before the first calendar anniversary of the inception (inclusive), no 3, 5 or 10-year one before those; an
  // unknown inception date keeps the value (shared calendar-dates block).
  const built=buildMetrics(month,derived,secYield,divYield,hasOfficialReturns);
  const metrics=withoutYoungReturns(built,inception,built.performanceAsOf,{tr1y:1,cagr3y:3,tr3y:3,cagr5y:5,tr5y:5,cagr10y:10,tr10y:10,siAnn:1});
  const youngBlock=(block:JsonRecord):JsonRecord=>withoutYoungReturns(block,inception,block.asOfDate,{yr1:1,yr3:3,yr5:5,yr10:10,sinceInception:1});
  if(month) month=youngBlock({...month,ytd:month.ytd??derived.ytd,mo1:month.mo1??derived.mo1,qtd:month.qtd??derived.qtd});
  if (!month && usable.length) {
    month=youngBlock({asOfDate:formatEdgarDate(derived.asOfDate!),mo1:derived.mo1,qtd:derived.qtd,ytd:derived.ytd,yr1:derived.yr1,yr3:derived.cagr3y,yr5:derived.cagr5y,yr10:derived.cagr10y,sinceInception:derived.siAnn});
  }
  if(quarter) quarter=youngBlock(quarter);
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
  resetSecState();
  outputPrintConfig('abrdn',config);
  const previous=await readJson(INDEX_FILE), previousRows:JsonRecord[]=Array.isArray(previous?.funds)?previous.funds:[];
  const oldFunds=new Map<string,JsonRecord>(previousRows.map((f:JsonRecord)=>[f.ticker,f] as [string,JsonRecord]));
  let catalog:CatalogFund[]|null=null;
  if (!config.skipAberdeen) catalog=await optional('catalog',()=>loadCatalog(config));
  const officialCatalog=catalog!==null;
  if (!catalog) {
    console.warn('[ catalog  ] official source unavailable/skipped — using published provider identities');
    catalog=[];
    for (const [ticker,row] of oldFunds) {
      const meta=await readJson(new URL(`funds/${ticker}/meta.json`,API_ROOT));
      if (meta?.providerIds) catalog.push(meta.providerIds);
      // A catalog-only row (nothing published) has no identity to update from: it stays listed as it is.
      else if (row.dataFile) catalog.push({ticker,name:row.name,id:'',shareclassId:'',isin:row.isin??'',assetClass:row.category??'ETF',correlationFundRangeId:'',fundPage:row.fundPage,nav:row.navValue??null,navDate:isoDate(row.asOfDate)});
    }
  }
  catalog.sort((a,b)=>a.ticker.localeCompare(b.ticker));
  if (!catalog.length) throw new Error('No official or previously published catalog; refusing empty success');
  console.log(`[ catalog  ] ${catalog.length} abrdn ETFs (official gateway / published fallback)`);
  // The live catalog (null when only the published feed is known): a catalog-only row it no longer lists is dropped, never retried.
  const live=officialCatalog?catalog.map(f=>f.ticker):null;
  // Q27: a TICKERS entry outside the live catalog and the published funds (a closed fund the catalog dropped included) stops the run before any fund request
  assertKnownTickers(config.tickers.length?config.tickers:null,knownTickers(live,previousRows),'the abrdn catalog or published feed');
  // A closed fund leaves the queue after the TICKERS filter and before the MAX_FETCHES budget: never fetched, guarded or reported.
  const state=await readJson(STATE_FILE), order=withoutClosedFunds(selectionOrder(catalog,config,state?.cursor??null),f=>f.ticker,CLOSED_FUNDS);
  outputPrintFilter(order.length,catalog.length,outputHasOutputFilters(config));
  const limit=config.maxFetches;
  const reporter=outputCreateReporter(API_ROOT,limit&&!outputHasOutputFilters(config)?Math.min(limit,order.length):order.length);
  // Filtered, bounded, skipped and failed funds keep their published row: the index never shrinks (stale catalog-only rows aside).
  const result=new Map<string,JsonRecord>(withoutStalePlaceholders(previousRows,live).map((f)=>[f.ticker,f] as [string,JsonRecord]));
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
  // A catalog fund with nothing published (new, or its first update failed or the guard rejected it) is still listed: no meta.json, so dataFile is null.
  for (const fund of catalog) if (!result.has(fund.ticker) && !(await Bun.file(new URL(`funds/${fund.ticker}/meta.json`,API_ROOT)).exists())) result.set(fund.ticker,catalogOnlyRow(fund));
  // the 52-week range of every row from its published history pages (shared range-52w block)
  const funds=await withRange52w(API_ROOT,markClosedFunds([...result.values()].map(withYieldBasis).sort((a,b)=>a.ticker.localeCompare(b.ticker)),CLOSED_FUNDS));
  const counts={funds:funds.length,holdings:funds.reduce((s,f)=>s+f.holdings,0),history:funds.reduce((s,f)=>s+f.history,0)};
  const stamp=isoSeconds();
  await writeIfChanged(INDEX_FILE,{generatedAt:stamp,catalogReadAt:stamp,source:{provider:'abrdn ETFs',site:ABERDEEN_SITE,catalog:CATALOG_PAGE},counts,funds});
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds=newFundsLines(newFundsReport(previousRows,funds));
  for (const line of newFunds) console.log(line);
  // The cursor follows deterministic order, not completion order, and is advanced only by an unfiltered-by-ticker run
  // without failures or truncation; a TICKERS run never reads, moves or deletes it.
  if (!config.tickers.length && !failures && !truncated) {
    if (limit) {if (lastExamined) await writeIfChanged(STATE_FILE,{cursor:lastExamined.ticker});}
    else await rm(STATE_FILE,{force:true});
  }
  console.log(`[ done     ] ${processed} funds processed, ${skipped} skipped, ${kept} kept as published, ${failures} failures`);
  console.log(`[ done     ] counts: ${counts.funds} funds / ${counts.holdings} holdings rows / ${counts.history} history rows`);
  if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`### abrdn update\n\n${processed} processed; ${skipped} skipped; ${kept} kept as published; ${failures} failed.\n${counts.funds} funds / ${counts.holdings} holdings / ${counts.history} history rows.\n${newFunds.length?`\n${newFunds.join('\n')}\n`:''}${truncated?'\nStopped at the soft deadline; remaining funds keep their published data.\n':''}`);
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

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; an abbreviated or reordered name the
 *   exact key misses through a looser key that must name one company (`nportLooseKey`, Q35: `Lowe's Cos` = `LOWES COMPANIES`,
 *   `SCHWAB CHARLES CORP`); never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/**
 * Abbreviated words of issuer names (open-items etfs Q35) -> one spelling, each seen in N-PORT-P filings of the brands against
 * the SEC company_tickers.json title of the same CUSIP issuer (2026-10-26): `LOWES COS` / `LOWES COMPANIES`, `AMERIPRISE FINL`,
 * `VICI PPTYS`, `TAIWAN SEMICONDUCTOR MFG`, `ZIONS BANCORP NA` / `ZIONS BANCORPORATION NATIONAL ASSOCIATION`. '' drops the word.
 */
function nportLooseWords(): Record<string, string> {
  return {
    COS: '', COMPANIES: '', AND: '', OF: '', NA: '', NATIONAL_ASSOCIATION: '', INCORPORATION: '', REIT: '',
    BANCORPORATION: 'BANCORP', FINL: 'FINANCIAL', PPTYS: 'PROPERTIES', PPTY: 'PROPERTY', MFG: 'MANUFACTURING', GRP: 'GROUP',
    HLDGS: 'HOLDINGS', HLDG: 'HOLDING', INTL: 'INTERNATIONAL', SVCS: 'SERVICES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES',
    SYS: 'SYSTEMS', NATL: 'NATIONAL', RES: 'RESOURCES', RLTY: 'REALTY', INDS: 'INDUSTRIES', INS: 'INSURANCE', BROS: 'BROTHERS', SVGS: 'SAVINGS',
  };
}

/**
 * The second, looser company key (open-items etfs Q35), used only for a row the exact key (`nportNameKey`) left without a
 * ticker: a Bloomberg location or article after a slash dropped (`Charles Schwab Corp/The`, `Energy Fuels Inc/canada`; never a
 * one-word start like `RE/MAX`), abbreviations read as one word (`nportLooseWords`), the share class dropped (the caller picks
 * the class) and the words sorted, so EDGAR's reordered titles meet the usual order: `SCHWAB CHARLES CORP` = `Charles Schwab
 * Corp`, `HORTON D R INC` = `DR Horton Inc`, `PRICE T ROWE GROUP INC` = `T Rowe Price Group Inc`. Several companies can share a
 * loose key: `parseSecCompanyNames` and `parseUsListings` keep such a key empty, so it never gives a ticker.
 */
export function nportLooseKey(value: unknown): string {
  let raw = String(value === null || value === undefined ? '' : value).trim();
  const slash = /^(.*\s\S*[A-Za-z]{2}[.,]?)\s*\/\s*([A-Za-z][A-Za-z .,']*)$/.exec(raw);
  if (slash) raw = slash[1];
  // a trailing EDGAR or Bloomberg qualifier after the legal form: `CHEVRON CORP NEW`, `US BANCORP DEL`, `PROGRESSIVE CORP OHIO`
  raw = raw.replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|CO(?:MPANY)?|LTD|BANCORP|GROUP|GRP|TRUST|HOLDINGS?)\.?,?\s+(?:NEW|DEL|REINCORPORATION|OHIO|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\.?$/i, '$1');
  const words = nportLooseWords();
  const key = nportNameKey(raw).replace(/ CL [A-Z]$/, '').replace(/\bNATIONAL ASSOCIATION\b/g, 'NATIONAL_ASSOCIATION');
  return key.split(' ').map((word) => (Object.prototype.hasOwnProperty.call(words, word) ? words[word] : word)).filter(Boolean).sort().join(' ');
}

/**
 * SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too).
 * Each loose key (`nportLooseKey`) is added as `\u0001<loose key>` -> the company's tickers, space-separated in the table's
 * order, or '' when two companies (CIKs) share it; `nportTickers` reads them for rows the exact key misses.
 */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const loose = new Map<string, { cik: string; tickers: string[] } | null>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown; cik_str?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
    const looseKey = nportLooseKey(row.title);
    const cik = String(row.cik_str === null || row.cik_str === undefined ? '' : row.cik_str).replace(/\D/g, '');
    if (!looseKey || !Number(cik)) continue;
    const seen = loose.get(looseKey);
    if (seen === undefined) loose.set(looseKey, { cik: String(Number(cik)), tickers: [ticker] });
    else if (seen && seen.cik === String(Number(cik))) { if (seen.tickers.indexOf(ticker) < 0) seen.tickers.push(ticker); }
    else loose.set(looseKey, null);
  }
  loose.forEach((seen, looseKey) => names.set(`\u0001${looseKey}`, seen ? seen.tickers.join(' ') : ''));
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
    const looseKey = nportLooseKey(nportIssuerName(name));
    if (looseKey && nportListedCommon(name)) loose.set(looseKey, (loose.get(looseKey) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  loose.forEach((symbols, looseKey) => listings.set(`\u0001${looseKey}`, symbols.join(' ')));
  return listings;
}

/** Is a symbol directory security name a company's own common or ordinary shares (not preferred, depositary, notes, warrants, units, rights)? */
function nportListedCommon(name: string): boolean {
  return !/\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b|\bPREFERRED\b|\bPREF\b|\bPFD\b|\bNOTES?\b|\bDEBENTURES?\b|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|%|\bDUE\s+\d{4}\b|\bPERPETUAL\b|\bCUMULATIVE\b|\bSUBORDINATED\b|\bTRUST\s+(?:SECURITIES|CERTIFICATES)\b|\bETNS?\b|\bEXCHANGE[- ]TRADED\b/i.test(name);
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or title
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Rows still without a
 * ticker get the second, looser name match (`nportLooseTickers`), which never changes a ticker given here. Bonds, cash, funds
 * and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker, key) => { if (key.charAt(0) !== '\u0001') secTickers.add(ticker); });
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  const exact = tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
  return nportLooseTickers(positions, exact, names, listings);
}

/**
 * The second name match (open-items etfs Q35) for the common-stock rows `nportTickers` left without a ticker; the tickers it
 * already gave never change. The row's loose key (`nportLooseKey`) must name one company: in the SEC table (`\u0001` entries of
 * `parseSecCompanyNames`, one CIK) and/or in the symbol directories (`\u0001` entries of `parseUsListings`, common shares only),
 * and when both know the key they must agree on the company. Of that company's tickers only its listed common shares count
 * (with one SEC ticker and no listing, that ticker); several of them (Fox, Lennar, Zillow) need the class the row states in its
 * name or title, matched to the listed security name, else no ticker. A foreign ISIN needs the directory listing of the same
 * key (its own U.S. shares, never depositary ones). A ticker that a row of `exact` holds for another security, or that this pass
 * finds for two securities, is dropped.
 */
function nportLooseTickers(positions: ReadonlyArray<NportPosition>, exact: string[], names: Map<string, string> | null, listings: Map<string, string> | null): string[] {
  if (!names) return exact;
  const companyOf = new Map<string, string>();
  names.forEach((tickers, key) => { if (key.charAt(0) === '\u0001' && tickers) tickers.split(' ').forEach((ticker) => companyOf.set(ticker, key)); });
  const securityOf = (position: NportPosition): string => position.cusip || position.isin || position.other || nportNameKey(position.name);
  const listedClass = (symbol: string): string => nportShareClass(listings ? listings.get(symbol) : '');
  const found = positions.map((position, index) => {
    if (exact[index] || position.assetCat !== 'EC' || position.derivative || nportIsRight(position)) return '';
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    if (foreign ? position.currency !== 'USD' || !listings : position.currency && position.currency !== 'USD') return '';
    if (!/^[0-9A-Z]{9}$/.test(position.cusip) && !/^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) return '';
    const key = nportLooseKey(position.name);
    if (!key) return '';
    const sec = names.get(`\u0001${key}`);
    const listed = listings ? listings.get(`\u0001${key}`) : undefined;
    if (sec === '' || (sec === undefined && listed === undefined) || (foreign && !listed)) return '';
    const listedSymbols = listed ? listed.split(' ') : [];
    // the company: the SEC entry of the key, else the one SEC entry every listed symbol of the key belongs to
    const company = sec !== undefined ? `\u0001${key}` : companyOf.get(listedSymbols[0]) || '';
    if (!company || listedSymbols.some((symbol) => companyOf.get(symbol) !== company)) return '';
    const tickers = String(names.get(company) || '').split(' ').filter(Boolean);
    const common = tickers.filter((ticker) => listings && listings.has(ticker) && nportListedCommon(String(listings.get(ticker))));
    const candidates = common.length ? common : tickers.length === 1 && !foreign ? tickers : [];
    if (foreign && candidates.some((ticker) => listedSymbols.indexOf(ticker) < 0)) return '';
    const wanted = nportShareClass(position.name, position.title);
    if (candidates.length === 1) return !wanted || !listings || !listings.has(candidates[0]) || !listedClass(candidates[0]) || listedClass(candidates[0]) === wanted ? candidates[0] : '';
    const classed = wanted ? candidates.filter((ticker) => listedClass(ticker) === wanted) : [];
    return classed.length === 1 ? classed[0] : '';
  });
  const taken = new Map<string, string[]>();
  exact.forEach((ticker, index) => { if (ticker) taken.set(ticker, (taken.get(ticker) || []).concat(securityOf(positions[index]))); });
  found.forEach((ticker, index) => {
    if (!ticker) return;
    const seen = taken.get(ticker) || [];
    if (seen.indexOf(securityOf(positions[index])) < 0) taken.set(ticker, seen.concat(securityOf(positions[index])));
  });
  return exact.map((ticker, index) => ticker || (found[index] && (taken.get(found[index]) || []).length === 1 ? found[index] : ''));
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>

// <range-52w> shared block of .claude/tools/etfs/etf-std/range-52w.block.ts, applied by apply-block.ts: never edit it in one repo
export type Range52w = {
  week52Low: number | null; week52High: number | null; range52w: number | null; range52wClose: number | null; range52wAsOf: string | null;
  range52wSince: string | null; range52wBasis: string | null;
};

/**
 * The price columns of a history sheet, tried in this order: the market close first, NAV only when no market price is
 * published. A function, not a const: the block sits at the end of update-data.ts, after the top-level `await main()`.
 */
export function range52wColumns(): string[] {
  return ['Close', 'Market Price', 'NAV', 'NAV per Share'];
}

/** The seven `metrics` keys of the 52-week range, all null: a catalog-only row and a fund without history carry this. */
export function range52wEmpty(): Range52w {
  return { week52Low: null, week52High: null, range52w: null, range52wClose: null, range52wAsOf: null, range52wSince: null, range52wBasis: null };
}

/**
 * The 52-week range from the closes of a fund's published history sheet (owner, 2026-10-29: closes, not intraday highs and
 * lows; no extra requests). `headers` are the sheet headers, `rows` objects keyed by header or arrays in header order.
 * - Price column: the first of range52wColumns() with at least two numeric values (`$1,234.50` reads as 1234.5); the date
 *   column is `Date`, else `As Of`, else the first header. Dates go through calendarIso, so every published format works
 * - Window: the last dated close and every close up to 52 weeks (364 days) before it. `week52Low` and `week52High` are the
 *   lowest and highest close of the window, `range52w` the position of the last close between them in percent
 *   (0 = at the low, 100 = at the high, 2 decimals). The last close is part of the window, so it never falls outside;
 *   `range52wClose` and `range52wAsOf` are that close and its date (it can differ from the row's closePrice source)
 * - A fund with less than 52 weeks of history gets the range since its first published close, and `range52wSince` names
 *   that date (owner: "alternative" - the range since launch with a note); a full window has `range52wSince: null`
 * - `range52wBasis` names the column used. Fewer than two closes give range52wEmpty(); a flat window (high = low) keeps
 *   low and high but `range52w: null`, never a made-up 0 or 50
 */
export function range52wMetrics(headers: string[], rows: unknown[]): Range52w {
  const list = Array.isArray(headers) ? headers.map((h) => String(h)) : [];
  const dateHeader = list.indexOf('Date') >= 0 ? 'Date' : list.indexOf('As Of') >= 0 ? 'As Of' : list[0];
  const cell = (row: unknown, header: string): unknown => {
    if (Array.isArray(row)) return row[list.indexOf(header)];
    return row && typeof row === 'object' ? (row as Record<string, unknown>)[header] : undefined;
  };
  const price = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const text = String(value === null || value === undefined ? '' : value).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return number > 0 ? number : null;
  };
  const all = Array.isArray(rows) ? rows : [], columns = range52wColumns();
  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    if (list.indexOf(column) < 0 || !dateHeader) continue;
    const points: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const date = calendarIso(cell(all[i], dateHeader)), close = price(cell(all[i], column));
      if (date && close !== null) points.push({ date, close });
    }
    if (points.length < 2) continue;
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = points[points.length - 1];
    const end = Date.UTC(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)));
    const start = new Date(end - 364 * 86400000).toISOString().slice(0, 10);
    const window = points.filter((p) => p.date >= start);
    if (window.length < 2) continue;
    let low = window[0].close, high = window[0].close;
    for (let i = 1; i < window.length; i++) { low = Math.min(low, window[i].close); high = Math.max(high, window[i].close); }
    const round = (value: number, digits: number): number => Number(value.toFixed(digits));
    return {
      week52Low: round(low, 4), week52High: round(high, 4),
      range52w: high > low ? round(((last.close - low) / (high - low)) * 100, 2) : null, range52wClose: round(last.close, 4), range52wAsOf: last.date,
      range52wSince: points[0].date > start ? points[0].date : null,
      range52wBasis: column,
    };
  }
  return range52wEmpty();
}
/**
 * The index rows with the five 52-week keys in every `metrics`, computed from each fund's published history pages
 * (`funds/<T>/history/*.json` under `feedRoot`, the folder of index.json). Call it on the final rows right before
 * index.json is written: updated, unchanged and kept funds all get the range of the history they publish, a row without
 * `dataFile` or without history pages gets range52wEmpty(). A row without a `metrics` object is left as it is. The seven
 * keys go in front of `returnsBasis` and `performanceAsOf`, so those two stay the last keys of `metrics`.
 */
export async function withRange52w<T>(feedRoot: URL | string, funds: T[]): Promise<T[]> {
  const fs = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const root = feedRoot instanceof URL ? new URL(feedRoot.href.replace(/\/?$/, '/')) : new URL(pathToFileURL(String(feedRoot).replace(/\/?$/, '/')).href); // global URL, also with older @types/node (Amplify)
  const out: T[] = [];
  for (const fund of Array.isArray(funds) ? funds : []) {
    const row = fund as unknown as Record<string, unknown>;
    if (!row || typeof row !== 'object' || !row.metrics || typeof row.metrics !== 'object') { out.push(fund); continue; }
    let range = range52wEmpty();
    const dataFile = typeof row.dataFile === 'string' ? row.dataFile : '';
    if (dataFile) {
      const dir = new URL(`${dataFile.replace(/^\.\//, '').replace(/[^/]*$/, '')}history/`, root);
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /\.json$/.test(name)).sort();
      let headers: string[] = [];
      const rows: unknown[] = [];
      for (const name of names) {
        const page = await fs.readFile(new URL(name, dir), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
        if (!page || !Array.isArray(page.rows)) continue;
        if (!headers.length && Array.isArray(page.headers)) headers = page.headers;
        for (const item of page.rows) rows.push(item);
      }
      range = range52wMetrics(headers, rows);
    }
    // the range keys go in front of returnsBasis and performanceAsOf, which stay the last two keys (metrics contract)
    const metrics: Record<string, unknown> = {}, old = row.metrics as Record<string, unknown>, tail = ['returnsBasis', 'performanceAsOf'];
    for (const key of Object.keys(old)) if (tail.indexOf(key) < 0 && !(key in range)) metrics[key] = old[key];
    Object.assign(metrics, range);
    for (const key of tail) if (key in old) metrics[key] = old[key];
    out.push({ ...row, metrics } as unknown as T);
  }
  return out;
}
// </range-52w>
