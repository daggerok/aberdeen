/// <reference types="bun" />
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES, CONTROL_ALIASES, resolveControls, runtimeControls, readConfig, parseRange, parseAumRange, fundFilterReasons, selectionOrder,
  parseCatalog, catalogPayload, parseDetail, parseKeyInformation, parseHoldings, parsePerformance, parseChart, mergeHistory, collectPages,
  parseNport, parseFundTickerMap, nportMatches, isoDate, displayDateToIso, numberOrNull, normalizeNumberText, decodeDividendFrequency,
  buildMetrics, yieldBasisCode, withYieldBasis, priceReturns, annualizedToTotal, trailingYield, OFFICIAL_RETURNS_BASIS, YAHOO_RETURNS_BASIS, samePublishedContent,
  fetchWithRetry, fetchTextWithRetry, runWorkers, setRequestSleep, setFetchTimeoutMs, chartUrl, isCertError, installSystemCa,
} from './update-data';

const root = (path: string) => new URL(`../${path}`, import.meta.url);
const read = (path: string) => readFile(root(path), 'utf8');
const file = JSON.parse(await read('scripts/update-data.config.json'));

// Every test starts from the same state: pinned zone, no leaked exit code, original fetch and timers.
const realFetch = globalThis.fetch;
beforeEach(() => { process.env.TZ = 'UTC'; });
afterEach(() => { globalThis.fetch = realFetch; process.exitCode = 0; setRequestSleep(0); setFetchTimeoutMs(45_000); });

// Child processes never inherit the control variables the workflow exports.
const cleanEnv = (extra: Record<string, string> = {}) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || (CONTROL_NAMES as readonly string[]).includes(k) || k.startsWith('ABERDEEN_') || k === 'HISTORICAL_PAGE_SIZE' || k.startsWith('GITHUB_')) continue;
    env[k] = v;
  }
  return { ...env, TZ: 'UTC', ...extra };
};
const spawnText = async (cmd: string[], opts: { cwd?: string; env: Record<string, string> }) => {
  const child = Bun.spawn(cmd, { ...opts, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
};

// Small inline samples shaped like the official abrdn gateway responses.
const AGEM_ID = '5479d397-d289-81f2-8ee2-ddaa923783cf';
const overview = [
  { id: 'a590c36e', name: 'abrdn Bloomberg All Commodity Longer Dated Strategy K-1 Free ETF', assetClass: 'Alternatives', correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: 'sc-bcd', isin: 'US0032612030' }] },
  { id: AGEM_ID, name: 'abrdn Emerging Markets Dividend Active ETF', assetClass: 'Active Equities', correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: 'sc-agem', isin: 'US00384X3017' }] },
  { id: 'c0ffee00', name: 'abrdn Physical Gold Shares ETF', assetClass: 'Alternatives', correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: 'sc-sgol', isin: 'US00027Y1001' }] },
];
const prices = [
  { id: 'a590c36e', name: overview[0].name, correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: 'sc-bcd', isin: 'US0032612030', date: '2026-09-25T00:00:00Z', nav: '38.9448', ticker: 'BCD' }] },
  { id: AGEM_ID, name: overview[1].name, correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: 'sc-agem', isin: 'US00384X3017', date: '2026-09-25T00:00:00Z', nav: '49.7222', ticker: 'AGEM' }] },
  { id: 'c0ffee00', name: overview[2].name, correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: 'sc-sgol', isin: 'US00027Y1001', date: '2026-09-25T00:00:00Z', nav: '40.1', ticker: 'SGOL' }] },
];
const funds = parseCatalog(overview, prices);
const agem = funds.find(f => f.ticker === 'AGEM')!;
const detail = {
  id: AGEM_ID, name: overview[1].name, isPageAvailable: true, assetClassId: 'Active Equities', fundNameId: overview[1].name,
  fundRangeName: 'Exchange Traded Fund', fundManagementApproach: 'US ETFs - Active', correlationFundRangeID: 'corr',
  availableFundDetailsTabs: { holdingsTab: { tab: true, quarterlyHoldings: true }, performanceTab: { tab: true } },
  selectedShareclass: { id: 'sc-agem', prices: [{ pricePerUnit: '49.7222', currentAsAt: '2026-09-25T00:00:00Z' }], investmentTrustPrices: [{ exchangePrice: '49.8', exchangeDate: '2026-09-25T00:00:00Z' }] },
};
const keyInfo = {
  content: {
    shareClass: { totalExpenseRatio: '1.18%', netExpenseRatio: '0.7', ticker: 'AGEM', shareClassDividendFrequency: 'Quarterly', thirtyDaySecYieldSubsidizedWithDate: { value: '1.48', date: '2026-07-31T00:00:00Z' } },
    fund: { fundSizeWithDate: { value: '375893057.43', date: '2026-09-25T00:00:00Z' }, legalStructure: ' 1940 Act' },
  },
  statusCode: 200,
};
const holdingRow = (name: string, ticker: string, weight: string) => ({
  rowLabel: name,
  columns: [
    { columnLabel: 'Weight', invariantColumnLabel: 'Weight', columnRowValue: weight },
    { columnLabel: 'FundTicker', invariantColumnLabel: 'FundTicker', columnRowValue: 'AGEM' },
    { columnLabel: 'TICKER', invariantColumnLabel: 'TICKER', columnRowValue: ticker },
  ],
});
const holdingsPayload = { reportDate: '2026-09-25T00:00:00', totalResults: 95, results: [holdingRow('SAMSUNG ELECTRONICS PREF', 'A005935', '13.2'), holdingRow('TAIWAN SEMICONDUCTOR', '2330', '9.1')] };
const perf = (periods: [string, string][]) => ({
  content: {
    lastRelevantDate: '2026-08-31T00:00:00Z',
    performanceSet: [
      { performanceCategoryType: 'NAV', values: periods.map(([label, value]) => ({ performanceTimePeriodLabel: label, performanceTimePeriod: label, value })) },
      { performanceCategoryType: 'US Retail Investor 1', values: periods.map(([label]) => ({ performanceTimePeriodLabel: label, performanceTimePeriod: label, value: '1.00' })) },
    ],
  },
});
const day = (date: string, v: number) => ({ date, close: v, adjClose: v, volume: 0 });
const nportXml = '<edgarSubmission><genInfo><regName>abrdn Funds</regName><regCik>1413594</regCik><seriesName>abrdn Emerging Markets Dividend Active ETF</seriesName><seriesId>S000001</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSec><name>Example</name><cusip>123456789</cusip><pctVal>5</pctVal><valUSD>50</valUSD><balance>2</balance><assetCat>EC</assetCat></invstOrSec></edgarSubmission>';

// ---------------------------------------------------------------------------
// Scenario runner: the real main() in a child process against a mocked multi-fund
// transport and a temporary API root (no network, no committed data).
// ---------------------------------------------------------------------------
const PRELUDE = String.raw`import * as M from './scripts/update-data';
const DEFS = {
  AGEM: { id: 'id-agem', sc: 'sc-agem', isin: 'US00384X3017', name: 'abrdn Emerging Markets Dividend Active ETF', nav: 49.7222, net: '0.7', gross: '1.18', freq: 'Quarterly', physical: false },
  BCD: { id: 'id-bcd', sc: 'sc-bcd', isin: 'US0032612030', name: 'abrdn Bloomberg All Commodity Longer Dated Strategy K-1 Free ETF', nav: 38.9448, net: '0.3', gross: '0.3', freq: 'Quarterly', physical: false },
  SGOL: { id: 'id-sgol', sc: 'sc-sgol', isin: 'US00027Y1001', name: 'abrdn Physical Gold Shares ETF', nav: 40.1, net: '0.17', gross: '0.17', freq: '', physical: true },
};
const S = {
  fail: () => false, catalog: ['AGEM', 'BCD', 'SGOL'], perfTab: true, perfDate: '2026-08-31', perfDateQ: '2026-06-30', ytd: '10',
  navDate: '2026-09-25', priceDate: '2026-09-25', price: 50, navAdd: 0, secYield: '1.48', chartFrom: '2024-01-02', chartTo: '2026-09-25',
  divs: {
    AGEM: [['2025-12-15', 0.5], ['2026-03-16', 0.5], ['2026-06-15', 0.5], ['2026-09-14', 0.5]],
    BCD: [['2025-10-01', 0.2], ['2026-01-02', 0.2], ['2026-04-01', 0.2], ['2026-09-14', 2.0]],
    SGOL: [],
  },
};
const ep = (day) => Date.parse(day + 'T14:30:00Z') / 1000;
function chart(t) {
  const from = ep(S.chartFrom), to = ep(S.chartTo), ts = [], close = [];
  for (let x = from, i = 0; x <= to; x += 86400, i++) { ts.push(x); close.push(Math.round((40 + i * 0.005) * 10000) / 10000); }
  const dividends = {};
  for (const [day, amount] of S.divs[t]) dividends['d' + day] = { date: ep(day), amount };
  return { chart: { result: [{ meta: { fullExchangeName: 'NYSE Arca', longName: DEFS[t].name, regularMarketPrice: S.price, regularMarketTime: to, firstTradeDate: from },
    timestamp: ts, indicators: { quote: [{ close, volume: close.map(() => 1000) }], adjclose: [{ adjclose: close }] }, events: { dividends } }] } };
}
const perf = (date, periods) => ({ content: { lastRelevantDate: date + 'T00:00:00Z', performanceSet: [{ performanceCategoryType: 'NAV', values: periods.map(([label, value]) => ({ performanceTimePeriodLabel: label, performanceTimePeriod: label, value })) }] }, statusCode: 200 });
const holdRow = (name, weight) => ({ rowLabel: name, columns: [{ columnLabel: 'Weight', invariantColumnLabel: 'Weight', columnRowValue: weight }, { columnLabel: 'TICKER', invariantColumnLabel: 'TICKER', columnRowValue: name.slice(0, 3).toUpperCase() }] });
const byBody = (body) => Object.entries(DEFS).find(([, d]) => d.id === body.fund || d.sc === body.shareClass);
globalThis.fetch = async (input, init) => {
  const u = String(input), body = init && init.body ? JSON.parse(init.body) : {};
  if (S.fail(u, body)) return new Response('nope', { status: 404 });
  if (u.includes('query1.finance.yahoo.com')) return Response.json(chart(u.split('/chart/')[1].split('?')[0]));
  if (u.includes('/view-all-funds/')) {
    const e = Object.entries(DEFS).find(([, d]) => u.endsWith('-' + d.isin.toLowerCase()));
    if (!e) return new Response('', { status: 404 });
    const d = e[1];
    const detail = { id: d.id, name: d.name, isPageAvailable: true, assetClassId: 'Active Equities', fundNameId: d.name, fundRangeName: 'Exchange Traded Fund',
      fundManagementApproach: d.physical ? 'US ETFs – Physical' : 'US ETFs - Active', correlationFundRangeID: 'corr',
      availableFundDetailsTabs: { holdingsTab: d.physical ? { tab: false } : { tab: true, quarterlyHoldings: true }, performanceTab: { tab: S.perfTab } },
      selectedShareclass: { id: d.sc, prices: [{ pricePerUnit: String(d.nav + S.navAdd), currentAsAt: S.navDate + 'T00:00:00Z' }], investmentTrustPrices: [{ exchangePrice: String(S.price), exchangeDate: S.priceDate + 'T00:00:00Z' }] } };
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { pageData: { fundDetailsData: detail } } } }) + '</script>');
  }
  const endpoint = u.split('/api/gateway/funds/')[1];
  const catalog = S.catalog.map(t => [t, DEFS[t]]);
  if (endpoint === 'overview') return Response.json({ content: { overview: catalog.map(([, d]) => ({ id: d.id, name: d.name, assetClass: 'Active Equities', correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: d.sc, isin: d.isin }] })), resultCount: catalog.length } });
  if (endpoint === 'prices') return Response.json({ content: { prices: catalog.map(([t, d]) => ({ id: d.id, name: d.name, correlationFundRangeId: 'corr', shareclasses: [{ shareclassID: d.sc, isin: d.isin, date: S.navDate + 'T00:00:00Z', nav: String(d.nav + S.navAdd), ticker: t }] })), resultCount: catalog.length } });
  const hit = byBody(body);
  if (!hit) return new Response('', { status: 404 });
  const [t, d] = hit;
  if (endpoint === 'fundDetailsKeyInformation') return Response.json({ statusCode: 200, content: { shareClass: { totalExpenseRatio: d.gross + '%', netExpenseRatio: d.net, ticker: t, shareClassDividendFrequency: d.freq, ...(S.secYield == null ? {} : { thirtyDaySecYieldSubsidizedWithDate: { value: S.secYield, date: '2026-07-31T00:00:00Z' } }) }, fund: { fundSizeWithDate: { value: '375893057.43', date: S.navDate + 'T00:00:00Z' }, legalStructure: d.physical ? '1933 Act' : '1940 Act', assetClass: 'Active Equities', fundLaunchDate: '2022-03-01T00:00:00Z' } } });
  if (endpoint === 'fundDetailsCodes') return Response.json({ statusCode: 200, content: { isin: d.isin, cusip: '123456789' } });
  const date = body.quarterly ? S.perfDateQ : S.perfDate;
  if (endpoint === 'performance/annualized') return Response.json(perf(date, [['timePeriodYears3', '27.89'], ['timePeriodYears5', '8.89']]));
  if (endpoint === 'performance/cumulative') return Response.json(perf(date, [['timePeriodMonths1', '1.53'], ['timePeriodYears1', '43.17'], ['timePeriodYTD', S.ytd]]));
  if (endpoint === 'breakdown/dailyHoldings') return Response.json({ statusCode: 200, reportDate: S.navDate + 'T00:00:00', totalResults: 2, results: [holdRow('Alpha Corp', '60'), holdRow('Beta Corp', '40')] });
  return new Response('', { status: 404 });
};
const baseEnv = { REQUEST_SLEEP: '0', MAX_RETRIES: '1', EDGAR_FALLBACK: '0' };
async function run(env) {
  process.exitCode = 0;
  try { await M.main({ ...baseEnv, ...(env || {}) }); } catch (e) { console.log('[ main threw ] ' + e.message); process.exitCode = 1; }
  const code = process.exitCode || 0; process.exitCode = 0; return code;
}
const readJ = async (f) => JSON.parse(await Bun.file(f).text());
const idx = () => readJ('api/aberdeen/index.json');
const row = async (t) => (await idx()).funds.find(f => f.ticker === t);
const meta = (t) => readJ('api/aberdeen/funds/' + t + '/meta.json');
const snap = async (prefix) => { const r = {}; for await (const f of new Bun.Glob('api/**/*.json').scan('.')) if (!prefix || f.includes(prefix)) r[f] = await Bun.file(f).text(); return JSON.stringify(Object.entries(r).sort()); };
const ok = (c, m) => { if (!c) throw new Error('ASSERT ' + m); };
`;

async function runScenario(body: string, env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'aberdeen-scenario-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await cp(new URL('update-data.ts', import.meta.url), join(dir, 'scripts/update-data.ts'));
    await Bun.write(join(dir, 'runner.ts'), `${PRELUDE}\n${body}`);
    return await spawnText([process.execPath, 'runner.ts'], { cwd: dir, env: cleanEnv(env) });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
// "[ tag ]" lines are the updater's own warnings; anything else on stderr is a crash or a failed ok()
const passes = async (body: string, env: Record<string, string> = {}) => {
  const r = await runScenario(body, env);
  expect({ code: r.code, stderr: r.stderr.split('\n').filter(l => l.trim() && !l.startsWith('[ ')).join('\n') }).toEqual({ code: 0, stderr: '' });
  expect(r.stdout).not.toContain('NaN');
  return r;
};

describe('controls', () => {
  test('precedence: file < advanced < nonblank input < env (brand alias wins) < protected SEC_UA', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'AGEM' }, { CONCURRENCY: 3, TICKERS: 'SGOL' }, { CONCURRENCY: '4', TICKERS: '' }, { ABERDEEN_CONCURRENCY: '5', CONCURRENCY: '6' });
    expect(c).toEqual({ CONCURRENCY: '5', TICKERS: 'SGOL' });
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'AGEM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    // an explicitly set empty env variable clears the control
    expect(resolveControls({ TICKERS: 'AGEM' }, { TICKERS: 'SGOL' }, { TICKERS: 'BCD' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, {}).SEC_UA).toBe('advanced');
  });
  test('scheduled path equals the config defaults; keys equal CONTROL_NAMES; defaults are the documented ones', () => {
    const c = resolveControls(file, {}, {}, {});
    expect(c).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    const config = readConfig(c);
    expect([config.tickers, config.maxFetches, config.concurrency, config.maxRetries]).toEqual([[], 0, 2, 2]);
    expect([file.HISTORY_RANGE, file.EDGAR_FALLBACK, file.USE_SYSTEM_CA]).toEqual(['max', 'true', 'auto']);
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig({ REQUEST_SLEEP: '0' }).requestSleep).toBe(0);
    expect(readConfig({}).requestSleep).toBe(1);
  });
  test('validation is strict: bad values, unknown keys, non-scalars and CR/LF/NUL are errors', () => {
    for (const bad of [{ UNKNOWN: 1 }, { TICKERS: ['AGEM'] }, { TICKERS: { a: 1 } }, { TICKERS: null }, null, [], 'x', 1]) expect(() => resolveControls(bad as any)).toThrow();
    for (const bad of [{ CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { AUM: '1:2:3' }, { TER: 'a:b' }, { HOLDINGS_PAGE_SIZE: 0 }]) {
      expect(() => resolveControls(bad)).toThrow();
    }
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
    expect(resolveControls({ MAX_RETRIES: 1 }).MAX_RETRIES).toBe('1');
    expect(() => resolveControls({}, { SEC_UA: 'x\nEVIL=yes' })).toThrow();
    expect(() => resolveControls({}, {}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { ABERDEEN_SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, [] as any)).toThrow();
    for (const v of ['auto', 'TRUE', 'False']) expect(resolveControls(file, {}, {}, { USE_SYSTEM_CA: v }).USE_SYSTEM_CA).toBe(v.toLowerCase());
  });
  test('brand env aliases: ABERDEEN_<NAME> > <NAME> > legacy alias; an invalid alias value is an error', () => {
    const config = readConfig(resolveControls(file, {}, {}, { HISTORICAL_PAGE_SIZE: '100', ABERDEEN_LIMIT: '3' }));
    expect([config.historyPageSize, config.maxFetches]).toEqual([100, 3]);
    expect(CONTROL_ALIASES.MAX_FETCHES).toContain('ABERDEEN_LIMIT');
    expect(resolveControls({}, {}, {}, { ABERDEEN_HISTORY_PAGE_SIZE: '7', HISTORY_PAGE_SIZE: '8', HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('7');
    expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: '8', HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('8');
    expect(() => resolveControls({}, {}, {}, { ABERDEEN_LIMIT: 'x' })).toThrow();
    expect(readConfig({ TICKERS: 'BCD', ABERDEEN_TICKERS: 'AGEM SGOL' }).tickers).toEqual(['AGEM', 'SGOL']);
  });
  test('ranges, AUM presets, filters (incl. SEC_YIELD) and the rotating bounded queue', () => {
    expect(parseRange(':', 'TER')).toBeUndefined();
    expect(parseRange(':0.3%', 'TER')).toEqual({ min: undefined, max: 0.3 });
    for (const s of ['15', '1:2:3', 'a:2', '4:1']) expect(() => parseRange(s, 'TER')).toThrow();
    expect(parseAumRange('10M:2B')).toEqual({ min: 1e7, max: 2e9 });
    expect(parseAumRange('large')).toEqual({ min: 1e10, max: undefined });
    expect(() => parseAumRange('bad:2B')).toThrow();
    const cfg = readConfig({ SEC_YIELD: '1:2', PERFORMANCE_3Y: '2:4', TOTAL_RETURN_3Y: '5:20' });
    expect(fundFilterReasons({ ticker: 'X', metrics: { secYield: 1.5, cagr3y: 3, tr3y: 10 } }, cfg)).toEqual([]);
    expect(fundFilterReasons({ ticker: 'X', metrics: { secYield: null, cagr3y: 3, tr3y: 10 } }, cfg)).toContain('SEC_YIELD');
    const batch = readConfig({ TICKERS: 'AGEM BCD SGOL', MAX_FETCHES: '2' });
    expect(selectionOrder(funds, batch, 'AGEM').slice(0, batch.maxFetches).map(f => f.ticker)).toEqual(['BCD', 'SGOL']);
    expect(selectionOrder(funds, readConfig({ TICKERS: 'AGEM BCD', MAX_FETCHES: '0' }), 'BCD').map(f => f.ticker)).toEqual(['AGEM', 'BCD']);
  });
  test('runtimeControls reads the colocated config independently of cwd; env still wins', async () => {
    expect((await runtimeControls({})).CONCURRENCY).toBe(file.CONCURRENCY);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
    const dir = await mkdtemp(join(tmpdir(), 'aberdeen-config-location-'));
    try {
      await mkdir(join(dir, 'scripts'));
      await mkdir(join(dir, 'other-cwd'));
      await cp(new URL('update-data.ts', import.meta.url), join(dir, 'scripts/update-data.ts'));
      await Bun.write(join(dir, 'scripts/update-data.config.json'), JSON.stringify({ CONCURRENCY: 7, TICKERS: 'AGEM' }));
      // Decoys: neither the repository root nor the current directory may win.
      await Bun.write(join(dir, 'update-data.config.json'), JSON.stringify({ CONCURRENCY: 9 }));
      await Bun.write(join(dir, 'other-cwd/update-data.config.json'), JSON.stringify({ CONCURRENCY: 11 }));
      for (const [override, expected] of [[{}, 7], [{ CONCURRENCY: '3' }, 3]] as const) {
        const r = await spawnText([process.execPath, join(dir, 'scripts/update-data.ts'), '--help'], { cwd: join(dir, 'other-cwd'), env: cleanEnv(override) });
        expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' });
        expect(r.stdout).toContain(`CONCURRENCY=${expected}\n`);
        expect(r.stdout).toContain('TICKERS=AGEM\n');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test('USE_SYSTEM_CA: certificate errors are recognised, fetch is wrapped and re-executed only for them', async () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
    const original = globalThis.fetch;
    const never = (() => { throw new Error('reexec'); }) as () => never;
    installSystemCa('false', never, false);
    expect(globalThis.fetch).toBe(original);
    installSystemCa('auto', never, true);
    expect(globalThis.fetch).toBe(original);
    let reexecs = 0;
    const reexec = (() => { reexecs++; throw new Error('restart'); }) as () => never;
    let behavior: () => Promise<Response> = async () => new Response('ok');
    globalThis.fetch = (async () => behavior()) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    expect(await (await fetch('http://x.test')).text()).toBe('ok');
    behavior = async () => { throw new Error('connect ECONNRESET'); };
    await expect(fetch('http://x.test')).rejects.toThrow('ECONNRESET');
    expect(reexecs).toBe(0);
    behavior = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } }); };
    await expect(fetch('http://x.test')).rejects.toThrow('restart');
    expect(reexecs).toBe(1);
  });
});

describe('parsing', () => {
  test('catalog: unique tickers, official NAV is not a market price, no ticker invented from the name', () => {
    expect(funds.map(f => f.ticker)).toEqual(['AGEM', 'BCD', 'SGOL']);
    expect([agem.nav, agem.navDate]).toEqual([49.7222, '2026-09-25']);
    expect(catalogPayload('prices')).not.toHaveProperty('date');
    expect(() => parseCatalog(overview, [{ id: 'x', name: 'Test ETF', shareclasses: [{}] }])).toThrow();
  });
  test('fund page: detail comes from NEXT_DATA and its shape is validated', () => {
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { pageData: { fundDetailsData: detail } } } })}</script>`;
    expect(parseDetail(html).id).toBe(agem.id);
    expect(() => parseDetail('<html/>')).toThrow();
  });
  test('key information: net TER, AUM and SEC yield', () => {
    const p = parseKeyInformation(keyInfo);
    expect([p.ter, p.netExpense, p.aum, p.secYield]).toEqual([1.18, 0.7, 375893057.43, 1.48]);
  });
  test('holdings: declared total, FundTicker is not a constituent, missing weight is blank never 0', () => {
    const h = parseHoldings(holdingsPayload);
    expect([h.total, h.rows.length, h.asOfDate, h.rows[0].Ticker]).toEqual([95, 2, '2026-09-25', 'A005935']);
    const cash = parseHoldings({ totalResults: 1, results: [{ rowLabel: 'Cash', columns: [{ columnLabel: 'FundTicker', columnRowValue: 'BCD' }] }] });
    expect([cash.rows[0].Ticker, cash.rows[0].Weight]).toEqual(['-', '']);
    const weight = (v: string) => parseHoldings({ totalResults: 1, results: [{ rowLabel: 'Cash', columns: [{ columnLabel: 'Weight', columnRowValue: v }] }] }).rows[0].Weight;
    expect([weight('0'), weight('-0.35'), weight('N/A')]).toEqual(['0', '-0.35', '']);
  });
  test('returns: official NAV rows only, calendar year is not trailing 1y, missing periods are null', () => {
    const annual = perf([['timePeriodYears3', '27.89'], ['timePeriodYears5', '8.89']]);
    expect(parsePerformance(annual).values.yr3).toBe(27.89);
    expect(parsePerformance(annual).date).toBe('2026-08-31');
    expect(parsePerformance(perf([['timePeriodMonths1', '1.53'], ['timePeriodYears1', '43.17']])).values.yr1).toBe(43.17);
    expect(parsePerformance(annual).values.yr1).toBeNull();
    expect(parsePerformance({ performanceSet: [{ performanceCategoryType: 'NAV', values: [{ performanceTimePeriodLabel: 'timePeriod2025', performanceTimePeriod: '2025', value: '99' }] }] }).values.yr1).toBeNull();
  });
  test('dates, numbers and distribution frequency: unknown is null, zero stays zero', () => {
    expect([isoDate('8/31/2026 12:00:00 AM'), isoDate('2026-09-25T00:00:00Z'), isoDate('')]).toEqual(['2026-08-31', '2026-09-25', null]);
    expect([displayDateToIso('Aug 31 2026'), displayDateToIso('9/5/2026'), displayDateToIso('—'), displayDateToIso('Foo 31 2026'), displayDateToIso(undefined)]).toEqual(['2026-08-31', '2026-09-05', null, null, null]);
    expect([numberOrNull(''), numberOrNull('0')]).toEqual([null, 0]);
    expect(normalizeNumberText('2.9E8')).toBe('290000000');
    expect([decodeDividendFrequency('Semi-annually')?.paymentsPerYear, decodeDividendFrequency('Monthly')?.paymentsPerYear, decodeDividendFrequency('')]).toEqual([2, 12, null]);
  });
  test('Yahoo history: adjusted close rounded at parse time, limited history merges instead of truncating', () => {
    const p = parseChart({ chart: { result: [{ timestamp: [1700000000], indicators: { quote: [{ close: [40.123456789], volume: [10] }], adjclose: [{ adjclose: [40.129991] }] }, events: { dividends: { x: { date: 1700000000, amount: 0.5 } } } }] } });
    expect([p.days[0].adjClose, p.dividends.length]).toEqual([40.13, 1]);
    expect(mergeHistory([{ Date: 'Jan 01 2020', Close: '10', 'Adj Close': '10', Volume: '0' }], [{ date: '2026-09-25', close: 11, adjClose: 11, volume: 1 }]).length).toBe(2);
    // text dates are calendar dates, whatever the machine zone
    process.env.TZ = 'Pacific/Auckland';
    const rows = mergeHistory([{ Date: 'Jun 30 2026', Close: '1', 'Adj Close': '1', Volume: '1' }], [{ date: '2026-06-30', close: 2, adjClose: 2, volume: 2 }, { date: '2026-07-01', close: 3, adjClose: 3, volume: 3 }]);
    expect(rows.map(x => [x.Date, x.Close])).toEqual([['Jun 30 2026', '2'], ['Jul 01 2026', '3']]);
  });
  test('pagination: every page until the exact declared total, an empty or changing total fails', async () => {
    const skips: number[] = [];
    expect(await collectPages(async (skip, take) => { skips.push(skip); return { rows: [0, 1, 2, 3, 4].slice(skip, skip + take), total: 5 }; }, 2)).toEqual([0, 1, 2, 3, 4]);
    expect(skips).toEqual([0, 2, 4]);
    await expect(collectPages(async () => ({ rows: [], total: 5 }))).rejects.toThrow('Incomplete');
    await expect(collectPages(async skip => ({ rows: [skip], total: skip ? 4 : 3 }), 1)).rejects.toThrow('Total changed');
    expect(await collectPages(async () => ({ rows: [], total: 0 }))).toEqual([]);
  });
  test('N-PORT: field-order independent ticker map, holdings extraction, other series under the same trust is rejected', () => {
    expect(parseFundTickerMap({ fields: ['symbol', 'classId', 'cik', 'seriesId'], data: [['AGEM', 'C1', 1413594, 'S000001']] }).get('AGEM')).toEqual({ cik: '0001413594', seriesId: 'S000001', classId: 'C1' });
    const p = parseNport(nportXml);
    expect([p.holdings[0].Identifier, p.netAssets]).toEqual(['123456789', 1000]);
    expect(nportMatches(agem, p, { cik: '0001413594', seriesId: 'S000002', classId: 'C1' })).toBe(false);
    expect(nportMatches(agem, p)).toBe(true);
    expect(nportMatches({ ...agem, name: 'Another Fund' }, p)).toBe(false);
  });
  test('N-PORT fallback: only a filing newer than the published holdings replaces them; a transport failure is an error', async () => {
    const harness = (published: string, extra = '') => `const fund = { ticker: 'AGEM', name: 'abrdn Emerging Markets Dividend Active ETF', id: 'x', shareclassId: 'y', isin: 'z', assetClass: 'a', correlationFundRangeId: '', fundPage: '', nav: null, navDate: null };
const atom = '<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0001413594-26-000001</accession-number><filing-href>https://www.sec.gov/Archives/edgar/data/1413594/000141359426000001/x-index.htm</filing-href><filing-date>2026-08-01</filing-date><period>2026-06-30</period></entry></feed>';
globalThis.fetch = async (input) => {
  const u = String(input);
  ${extra}
  if (u.includes('company_tickers_mf')) return Response.json({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1413594, 'S000001', 'C1', 'AGEM']] });
  if (u.includes('company_tickers.json')) return Response.json({});
  if (u.includes('browse-edgar')) return new Response(atom);
  if (u.includes('primary_doc.xml')) return new Response(${JSON.stringify(nportXml)});
  return new Response('', { status: 404 });
};
M.setRequestSleep(0);
const config = M.readConfig({ REQUEST_SLEEP: '0', MAX_RETRIES: '1' });`;
    const out = (published: string) => passes(`${harness(published)}
const out = await M.resolveNportFiling(fund, config, ${published});
console.log('RESULT ' + (out ? out.asOfDate + ':' + out.rows.length : 'null'));`);
    expect((await out("'2026-03-31'")).stdout).toContain('RESULT 2026-06-30:1');
    expect((await out("'2026-06-30'")).stdout).toContain('RESULT null');
    expect((await out("'2026-09-25'")).stdout).toContain('RESULT null');
    const failed = await passes(`${harness('null', "if (u.includes('primary_doc.xml') || u.includes('browse-edgar')) return new Response('denied', { status: 404 });")}
let threw = false; try { await M.resolveNportFiling(fund, config, null); } catch { threw = true; }
console.log('RESULT ' + threw);`);
    expect(failed.stdout).toContain('RESULT true');
  });
});

describe('metrics', () => {
  const none = priceReturns([]);
  test('returnsBasis and performanceAsOf travel together: official table date and label, Yahoo last close, unknown is null', () => {
    const m = buildMetrics({ asOfDate: 'Aug 31 2026', ytd: 1, yr1: 2 }, { ...none, asOfDate: '2026-08-28' }, 0.5, 1.2, true);
    expect([m.performanceAsOf, m.returnsBasis]).toEqual(['2026-08-31', OFFICIAL_RETURNS_BASIS]);
    expect(Object.keys(m).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    const y = buildMetrics(null, { ...none, asOfDate: '2026-09-25' }, null, null, false);
    expect([y.performanceAsOf, y.returnsBasis]).toEqual(['2026-09-25', YAHOO_RETURNS_BASIS]);
    const u = buildMetrics(null, none, null, null, false);
    expect(u.performanceAsOf).toBeNull();
    expect(String(u.returnsBasis).trim()).not.toBe('');
    expect(u.returnsBasis).not.toBe('-');
    expect(Object.keys(u)).toEqual(Object.keys(m));
  });
  test('dividendYieldBasis: computed-trailing-12m with a yield, null with null, same key set on fresh and rebuilt rows', () => {
    const none2 = priceReturns([]);
    const withYield = buildMetrics(null, none2, null, 4, false), noYield = buildMetrics(null, none2, null, null, false), zero = buildMetrics(null, none2, null, 0, false);
    expect([withYield.dividendYieldBasis, noYield.dividendYieldBasis, zero.dividendYieldBasis]).toEqual(['computed-trailing-12m', null, 'computed-trailing-12m']);
    expect(yieldBasisCode(undefined)).toBeNull();
    const { dividendYieldBasis, ...legacy } = withYield;
    const kept = withYieldBasis({ ticker: 'X', metrics: legacy }), keptNull = withYieldBasis({ ticker: 'Y', metrics: { ...legacy, dividendYield: null } });
    expect((kept.metrics as any).dividendYieldBasis).toBe('computed-trailing-12m');
    expect((keptNull.metrics as any).dividendYieldBasis).toBeNull();
    expect(Object.keys(kept.metrics as object)).toEqual(Object.keys(withYield));
    expect(Object.keys(keptNull.metrics as object)).toEqual(Object.keys(noYield));
    // a stale code never survives next to a different yield
    expect((withYieldBasis({ metrics: { ...withYield, dividendYield: null } }).metrics as any).dividendYieldBasis).toBeNull();
  });
  test('young funds: no 3y CAGR, no since-inception annualisation under a year, no trailing yield without 12 months; zero CAGR is 0 not null', () => {
    const asOf = new Date('2026-09-25');
    expect(priceReturns([day('2026-01-01', 10), day('2026-09-25', 11)], asOf).cagr3y).toBeNull();
    expect(priceReturns([day('2026-01-02', 10), day('2026-09-25', 11)], asOf).siAnn).toBeNull();
    expect(priceReturns([day('2025-09-24', 10), day('2026-09-25', 11)], asOf).siAnn).not.toBeNull();
    expect(annualizedToTotal(0, 3)).toBe(0);
    const d = [{ epoch: Date.parse('2026-03-16T14:30:00Z') / 1000, amount: 1 }, { epoch: Date.parse('2025-03-16T14:30:00Z') / 1000, amount: 5 }];
    expect(trailingYield(d, 50, '2026-09-25', '2024-01-02')).toBe(2);
    expect(trailingYield(d, 50, '2026-09-25', '2026-03-02')).toBeNull();
    for (const bad of [trailingYield([], 50, '2026-09-25', '2024-01-02'), trailingYield(d, null, '2026-09-25', '2024-01-02'), trailingYield(d, 0, '2026-09-25', '2024-01-02')]) expect(bad).toBeNull();
  });
  test('TER is the net figure with gross alongside; trailing-12m dividend yield; same metrics key set on every row', async () => {
    await passes(`ok(await run() === 0, 'run');
const r = await row('AGEM'), m = await meta('AGEM');
ok(r.terValue === 0.7 && r.terGrossValue === 1.18 && r.ter === '0.70%' && r.terGross === '1.18%', 'row ' + JSON.stringify([r.ter, r.terValue, r.terGross, r.terGrossValue]));
ok(m.expenseRatio.value === 0.7 && m.expenseRatio.gross === 1.18 && m.expenseRatio.net === 0.7, 'meta');
const bcd = await row('BCD'), sgol = await row('SGOL');
ok(r.metrics.dividendYield === 4, 'AGEM ' + r.metrics.dividendYield);
ok(bcd.metrics.dividendYield === 5.2 && bcd.metrics.dividendYieldText === '5.20%', 'BCD lumpy ' + bcd.metrics.dividendYield);
ok(sgol.metrics.dividendYield === null, 'SGOL has no distributions');
ok((await meta('BCD')).yields.dividendYieldKind.includes('trailing 12 months'), 'kind');
const keys = JSON.stringify(Object.keys(r.metrics));
ok(keys === JSON.stringify(Object.keys(bcd.metrics)) && keys === JSON.stringify(Object.keys(sgol.metrics)), 'metrics key set differs');
ok(keys.endsWith('"returnsBasis","performanceAsOf"]'), 'basis keys last');
ok(r.metrics.dividendYieldBasis === 'computed-trailing-12m' && bcd.metrics.dividendYieldBasis === 'computed-trailing-12m' && sgol.metrics.dividendYieldBasis === null, 'basis ' + JSON.stringify([r.metrics.dividendYieldBasis, sgol.metrics.dividendYieldBasis]));`);
  });
  test('a young fund (under 12 months of history) has null dividend yield', async () => {
    await passes(`S.chartFrom = '2026-03-02';
ok(await run() === 0, 'run');
ok((await row('BCD')).metrics.dividendYield === null && (await row('AGEM')).metrics.dividendYield === null, 'young fund yield');`);
  });
  test('an honest null from a source that answered replaces the old value; premium/discount is null when dates differ', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok((await row('AGEM')).metrics.secYield === 1.48 && (await row('AGEM')).premiumDiscountValue !== null, 'first values');
S.secYield = null; S.priceDate = '2026-09-24';
ok(await run() === 0, 'run 2');
const r = await row('AGEM');
ok(r.metrics.secYield === null && r.metrics.secYieldText === '—', 'honest null ' + JSON.stringify(r.metrics.secYield));
ok((await meta('AGEM')).yields.secYield === null, 'meta secYield');
ok(r.premiumDiscountValue === null, 'premium after date mismatch ' + r.premiumDiscountValue);`);
  });
  test('official returns and performanceAsOf move together: no old table under a new date', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok((await row('AGEM')).metrics.performanceAsOf === '2026-08-31', 'as-of');
S.perfDate = '2026-09-30'; S.ytd = '12.5';
ok(await run() === 0, 'run 2');
const r = await row('AGEM');
ok(r.metrics.performanceAsOf === '2026-09-30' && r.metrics.ytd === 12.5, 'new table travels with new date ' + JSON.stringify(r.metrics));`);
  });
  test('Yahoo-derived returns (no official table): as-of is the last close, basis says so, values move with the data', async () => {
    await passes(`S.perfTab = false;
ok(await run({ SKIP_YAHOO: '0' }) === 0, 'run 1');
const first = await row('AGEM');
ok(first.metrics.performanceAsOf === '2026-09-25', 'as-of 1 ' + first.metrics.performanceAsOf);
S.chartTo = '2026-10-02';
ok(await run() === 0, 'run 2');
const second = await row('AGEM');
ok(second.metrics.performanceAsOf === '2026-10-02', 'as-of 2 ' + second.metrics.performanceAsOf);
ok(second.metrics.returnsBasis.startsWith('Yahoo adjusted'), 'basis ' + second.metrics.returnsBasis);
ok(second.metrics.ytd !== first.metrics.ytd, 'ytd frozen');`);
  });
});

describe('pipeline', () => {
  test('first publication, then an identical run writes nothing (zero diff, stamps do not move)', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const a = await idx();
ok(a.funds.length === 3 && a.funds.every(f => f.dataFile === './funds/' + f.ticker + '/meta.json'), 'rows with dataFile');
ok(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(a.generatedAt) && a.catalogReadAt === a.generatedAt, 'stamp ' + a.generatedAt);
const text = await snap();
await Bun.sleep(1100);
ok(await run() === 0, 'run 2');
ok(text === await snap(), 'a rerun with identical data wrote something');
S.navAdd = 1;
ok(await run() === 0, 'run 3');
ok((await idx()).generatedAt !== a.generatedAt, 'stamp must move with content');`);
    expect(samePublishedContent('{"source":{"generatedAt":"old","x":1},"catalogReadAt":"old"}', { catalogReadAt: 'new', source: { x: 1, generatedAt: 'new' } })).toBe(true);
    expect(samePublishedContent('{"x":1}', { x: 2 })).toBe(false);
  });
  test('a TICKERS run keeps every row and file and never moves the cursor; an unknown ticker exits 1 and writes nothing', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok(await run({ MAX_FETCHES: '2' }) === 0, 'batch');
const state = await Bun.file('api/aberdeen/update-state.json').text();
const others = await snap('/BCD/') + await snap('/SGOL/');
S.navAdd = 1;
ok(await run({ TICKERS: 'AGEM' }) === 0, 'tickers');
ok((await idx()).funds.length === 3, 'index shrank');
ok(others === await snap('/BCD/') + await snap('/SGOL/'), 'unselected fund files changed');
ok((await meta('AGEM')).nav.value === 50.7222, 'selected fund updated');
ok(state === await Bun.file('api/aberdeen/update-state.json').text(), 'cursor touched by a TICKERS run');
const before = await snap();
ok(await run({ TICKERS: 'AGEM NOPE' }) === 1 && await run({ TICKERS: 'NOPE' }) === 1, 'unknown ticker must exit 1');
ok(before === await snap(), 'files changed');`);
  });
  test('MAX_FETCHES counts funds that pass the filters, wraps around and the full run resets the cursor', async () => {
    await passes(`ok(await run() === 0, 'run 1');
S.navAdd = 1;
ok(await run({ MAX_FETCHES: '2', TER: '0.2:' }) === 0, 'batch');
ok((await meta('AGEM')).nav.value === 50.7222 && (await meta('BCD')).nav.value === 39.9448, 'two passing funds updated');
ok((await meta('SGOL')).nav.value === 40.1, 'excluded fund untouched');
ok((await readJ('api/aberdeen/update-state.json')).cursor === 'BCD', 'cursor after the last examined fund');
S.navAdd = 2;
ok(await run({ MAX_FETCHES: '1', TER: '0.2:' }) === 0, 'next batch wraps');
ok((await meta('AGEM')).nav.value === 51.7222 && (await meta('BCD')).nav.value === 39.9448, 'wrapped past the excluded fund to AGEM only');
ok((await readJ('api/aberdeen/update-state.json')).cursor === 'AGEM', 'cursor moved to AGEM');
ok(await run() === 0, 'full run');
ok(!(await Bun.file('api/aberdeen/update-state.json').exists()), 'full run did not reset the cursor');`);
  });
  test('a failed source keeps that fund exactly as published, the others update, exit 0', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const before = await snap('/AGEM/');
const beforeRow = JSON.stringify(await row('AGEM'));
S.navAdd = 1; S.fail = (u) => u.includes('/chart/AGEM');
const out = await run();
ok(out === 0, 'exit ' + out);
ok(before === await snap('/AGEM/'), 'AGEM files changed although Yahoo failed');
ok(beforeRow === JSON.stringify(await row('AGEM')), 'AGEM row changed');
ok((await meta('BCD')).nav.value === 39.9448, 'BCD still updated');`);
  });
  test('every fund kept because its source failed gives exit 1 and no change; an outage never rewrites files', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const before = await snap();
S.navAdd = 1; S.fail = (u) => u.includes('/chart/');
ok(await run() === 1, 'expected exit 1');
ok(before === await snap(), 'files changed');
S.fail = () => true;
ok(await run() === 1, 'total outage must exit 1');
ok(before === await snap(), 'outage changed published files');`);
  });
  test('a never-published fund that fails gets no row and no meta (not published half-way)', async () => {
    await passes(`S.catalog = ['AGEM', 'BCD']; ok(await run() === 0, 'run 1');
S.catalog = ['AGEM', 'BCD', 'SGOL']; S.fail = (u) => u.includes('/chart/SGOL');
const code = await run();
ok(code === 1, 'exit ' + code);
ok((await idx()).funds.length === 2, 'rows');
ok(!(await Bun.file('api/aberdeen/funds/SGOL/meta.json').exists()), 'no meta for the failed new fund');`);
  });
  test('skipped sources fall back to published data (SKIP_YAHOO, SKIP_ABERDEEN)', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const a = await row('AGEM');
S.fail = (u) => u.includes('/chart/');
ok(await run({ SKIP_YAHOO: '1' }) === 0, 'skip yahoo');
const b = await row('AGEM');
ok(b.history === a.history && b.metrics.dividendYield === a.metrics.dividendYield && b.metrics.ytd === a.metrics.ytd, 'skip yahoo kept ' + JSON.stringify([b.history, b.metrics.dividendYield]));
S.fail = (u) => u.includes('gateway') || u.includes('view-all-funds');
ok(await run({ SKIP_ABERDEEN: '1', SKIP_YAHOO: '1' }) === 0, 'skip aberdeen');
const c = await row('AGEM');
ok(c.terValue === 0.7 && c.metrics.secYield === 1.48 && c.aumValue === a.aumValue && c.metrics.performanceAsOf === '2026-08-31', 'skip aberdeen kept ' + JSON.stringify([c.terValue, c.metrics.secYield, c.aumValue, c.metrics.performanceAsOf]));`);
  });
  test('new funds are announced once (stdout and step summary), never on first publication', async () => {
    const r = await passes(`const fs = await import('node:fs');
S.catalog = ['AGEM', 'BCD'];
ok(await run({ GITHUB_STEP_SUMMARY: 'summary.md' }) === 0, 'run 1');
ok(!fs.readFileSync('summary.md', 'utf8').includes('NEW FUNDS'), 'no new funds on first publication');
S.catalog = ['AGEM', 'BCD', 'SGOL'];
ok(await run({ GITHUB_STEP_SUMMARY: 'summary.md' }) === 0, 'run 2');
ok(fs.readFileSync('summary.md', 'utf8').includes('NEW FUNDS: SGOL'), 'summary');`);
    expect(r.stdout.match(/NEW FUNDS: SGOL/g)?.length).toBe(1);
  });
  test('the soft deadline stops new funds, keeps published data and still writes the index', async () => {
    const r = await passes(`ok(await run() === 0, 'run 1');
const before = await snap();
S.navAdd = 1; M.setRunDeadlineMs(-1);
ok(await run() === 0, 'deadline run');
ok(before === await snap(), 'a fund was taken after the deadline');`);
    expect(r.stdout).toContain('[ deadline ]');
  });
  test('pages are rewritten before meta.json and stale pages are removed after it (sorted listing, no tmp files)', async () => {
    await passes(`const fs = await import('node:fs');
const ls = (d) => fs.readdirSync(d).sort();
ok(await run({ HOLDINGS_PAGE_SIZE: '1', HISTORY_PAGE_SIZE: '400' }) === 0, 'run 1');
ok(ls('api/aberdeen/funds/AGEM/holdings').length === 2, 'two holdings pages');
ok(await run({ HOLDINGS_PAGE_SIZE: '250', HISTORY_PAGE_SIZE: '5000' }) === 0, 'run 2');
ok(ls('api/aberdeen/funds/AGEM/holdings').join() === '001.json', 'stale holdings page removed');
const m = await meta('AGEM');
ok(m.holdings.pages.join() === 'holdings/001.json' && m.history.pages.length === 1, 'manifest matches the files');
ok(ls('api/aberdeen/funds/AGEM/history').length === 1, 'stale history pages removed');
ok(!ls('api/aberdeen/funds/AGEM').some(f => f.endsWith('.tmp')), 'tmp file left');`);
  });
  test('dates are UTC: runs in other time zones give the same output as UTC', async () => {
    const scenario = `S.perfTab = false;
ok(await run() === 0, 'run 1');
S.chartTo = '2026-10-02';
ok(await run() === 0, 'run 2');
const r = await row('AGEM'), m = await meta('AGEM');
console.log('RESULT ' + JSON.stringify([r.metrics.performanceAsOf, m.history.asOf, m.returns.monthEnd.asOfDate, r.metrics.ytd, r.metrics.tr1y, r.history]));`;
    const [utc, moscow, la] = await Promise.all(['UTC', 'Europe/Moscow', 'America/Los_Angeles'].map(TZ => passes(scenario, { TZ })));
    const pick = (o: { stdout: string }) => o.stdout.split('\n').find(l => l.startsWith('RESULT '));
    expect(pick(utc)).toContain('"2026-10-02","Oct 02 2026","Oct 02 2026"');
    expect(pick(moscow)).toBe(pick(utc));
    expect(pick(la)).toBe(pick(utc));
  });
});

describe('network', () => {
  test('timeout covers the body and the request is retried per MAX_RETRIES', async () => {
    setFetchTimeoutMs(60);
    let calls = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls++;
      if (calls === 1) return { ok: true, status: 200, text: () => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))) } as unknown as Response;
      return new Response('done');
    }) as unknown as typeof fetch;
    expect(await fetchTextWithRetry('https://example.test/x', '[ test ]', {}, 1)).toBe('done');
    expect(calls).toBe(2);
  }, 15000);
  test('a request that never answers fails after the bounded retries instead of hanging', async () => {
    setFetchTimeoutMs(40);
    let calls = 0;
    globalThis.fetch = ((_url: string, init: RequestInit) => { calls++; return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))); }) as unknown as typeof fetch;
    await expect(fetchTextWithRetry('https://example.test/y', '[ test ]', {}, 1)).rejects.toThrow('network error');
    expect(calls).toBe(2);
  }, 15000);
  test('real concurrency: peak 1 in flight at CONCURRENCY=1, peak N at N (lanes, not one global gate, even with REQUEST_SLEEP)', async () => {
    const peakInFlight = async (concurrency: number, sleepSeconds: number) => {
      let inFlight = 0, peak = 0, next = 0;
      globalThis.fetch = (async () => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 60));
        inFlight--;
        return new Response('{}');
      }) as unknown as typeof fetch;
      setRequestSleep(sleepSeconds);
      await runWorkers(concurrency, async () => {
        for (;;) {
          const i = next++; if (i >= 6) return;
          await fetchWithRetry(`https://example.test/${i}`, `[ test ] ${i}`, {}, 0);
        }
      });
      return peak;
    };
    expect(await peakInFlight(1, 0.02)).toBe(1);
    expect(await peakInFlight(3, 0.05)).toBe(3);
  });
  test('HISTORY_RANGE shrinks the Yahoo request: explicit period1/period2, never range', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    const period = (url: string, name: string) => Number(new URL(url).searchParams.get(name));
    const max = chartUrl('AGEM', readConfig({ HISTORY_RANGE: 'max' }), now);
    expect([period(max, 'period1'), period(max, 'period2')]).toEqual([0, Math.floor(now / 1000)]);
    const five = chartUrl('AGEM', readConfig({ HISTORY_RANGE: '5y' }), now);
    expect(period(five, 'period1')).toBe(Math.floor(now / 1000 - 5 * 365.25 * 86400));
    expect(new URL(five).searchParams.has('range')).toBe(false);
  });
});
