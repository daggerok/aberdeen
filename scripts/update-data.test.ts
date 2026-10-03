/// <reference types="bun" />
import { describe, test, expect, afterEach } from 'bun:test';
import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES, resolveControls, runtimeControls,
  parseCatalog, catalogPayload, parseHoldings, parseKeyInformation, parsePerformance, parseDetail, readConfig, parseRange,
  parseAumRange, numberOrNull, normalizeNumberText, isoDate, decodeDividendFrequency, samePublishedContent, collectPages,
  parseNport, parseFundTickerMap, nportMatches, parseChart, priceReturns, annualizedToTotal, mergeHistory,
  selectionOrder, fundFilterReasons, buildMetrics, displayDateToIso, OFFICIAL_RETURNS_BASIS, YAHOO_RETURNS_BASIS, fetchWithRetry, runWorkers, setRequestSleep,
  isCertError, installSystemCa, CONTROL_ALIASES, chartUrl, trailingYield, setFetchTimeoutMs, fetchTextWithRetry,
} from './update-data';

// main() sets process.exitCode = 1 when a run failed; no test may leak that into the bun test exit code.
afterEach(() => { process.exitCode = 0; });

const root = (path: string) => new URL(`../${path}`, import.meta.url);
const read = (path: string) => readFile(root(path), 'utf8');

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
const keyInfo = () => ({
  content: {
    shareClass: {
      totalExpenseRatio: '1.18%', netExpenseRatio: '0.7', ticker: 'AGEM', shareClassDividendFrequency: 'Quarterly',
      thirtyDaySecYieldSubsidizedWithDate: { value: '1.48', date: '2026-07-31T00:00:00Z' },
    },
    fund: { fundSizeWithDate: { value: '375893057.43', date: '2026-09-25T00:00:00Z' }, legalStructure: ' 1940 Act' },
  },
  statusCode: 200,
});
const holdingRow = (name: string, ticker: string, weight: string) => ({
  rowLabel: name,
  columns: [
    { columnLabel: 'Weight', invariantColumnLabel: 'Weight', columnRowValue: weight },
    { columnLabel: 'FundTicker', invariantColumnLabel: 'FundTicker', columnRowValue: 'AGEM' },
    { columnLabel: 'TICKER', invariantColumnLabel: 'TICKER', columnRowValue: ticker },
  ],
});
const holdingsPayload = { reportDate: '2026-09-25T00:00:00', totalResults: 2, results: [holdingRow('SAMSUNG ELECTRONICS PREF', 'A005935', '13.2'), holdingRow('TAIWAN SEMICONDUCTOR', '2330', '9.1')] };
const perf = (periods: [string, string][]) => ({
  content: {
    lastRelevantDate: '2026-08-31T00:00:00Z',
    performanceSet: [
      { performanceCategoryType: 'NAV', values: periods.map(([label, value]) => ({ performanceTimePeriodLabel: label, performanceTimePeriod: label, value })) },
      { performanceCategoryType: 'US Retail Investor 1', values: periods.map(([label]) => ({ performanceTimePeriodLabel: label, performanceTimePeriod: label, value: '1.00' })) },
    ],
  },
});
const annual = perf([['timePeriodYears3', '27.89'], ['timePeriodYears5', '8.89']]);
const cumulative = perf([['timePeriodMonths1', '1.53'], ['timePeriodYears1', '43.17']]);

describe('configuration, filters and cursor', () => {
  test('defaults and explicit zero differ', () => {
    expect(readConfig({}).requestSleep).toBe(1);
    expect(readConfig({ REQUEST_SLEEP: '0' }).requestSleep).toBe(0);
    expect(readConfig({}).maxRetries).toBe(2);
  });
  test('brand aliases win', () => expect(readConfig({ TICKERS: 'BCD', ABERDEEN_TICKERS: 'AGEM SGOL' }).tickers).toEqual(['AGEM', 'SGOL']));
  test('ranges are strict', () => {
    expect(parseRange(':', 'TER')).toBeUndefined();
    expect(parseRange(':0.3%', 'TER')).toEqual({ min: undefined, max: 0.3 });
    for (const s of ['15', '1:2:3', 'a:2', '4:1']) expect(() => parseRange(s, 'TER')).toThrow();
  });
  test('AUM suffixes and presets', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 1e7, max: 2e9 });
    expect(parseAumRange('large')).toEqual({ min: 1e10, max: undefined });
    expect(() => parseAumRange('bad:2B')).toThrow();
  });
  test('all filters include SEC_YIELD and reject unknown values', () => {
    const cfg = readConfig({ SEC_YIELD: '1:2', PERFORMANCE_3Y: '2:4', TOTAL_RETURN_3Y: '5:20' });
    expect(fundFilterReasons({ ticker: 'X', metrics: { secYield: 1.5, cagr3y: 3, tr3y: 10 } }, cfg)).toEqual([]);
    expect(fundFilterReasons({ ticker: 'X', metrics: { secYield: null, cagr3y: 3, tr3y: 10 } }, cfg)).toContain('SEC_YIELD');
  });
  test('bounded queue rotates deterministically after filtering', () => {
    const cfg = readConfig({ TICKERS: 'AGEM BCD SGOL', MAX_FETCHES: '2' });
    expect(selectionOrder(funds, cfg, 'AGEM').slice(0, cfg.maxFetches).map(f => f.ticker)).toEqual(['BCD', 'SGOL']);
    expect(selectionOrder(funds, readConfig({ TICKERS: 'AGEM BCD', MAX_FETCHES: '0' }), 'BCD').map(f => f.ticker)).toEqual(['AGEM', 'BCD']);
  });
});

describe('official response parsers (inline samples)', () => {
  test('catalog: unique tickers, official NAV is not market price', () => {
    expect(funds.map(f => f.ticker)).toEqual(['AGEM', 'BCD', 'SGOL']);
    expect(agem.nav).toBe(49.7222);
    expect(agem.navDate).toBe('2026-09-25');
    expect(catalogPayload('prices')).not.toHaveProperty('date');
  });
  test('do not manufacture an ETF ticker from the name', () => {
    expect(() => parseCatalog(overview, [{ id: 'x', name: 'Test ETF', shareclasses: [{}] }])).toThrow();
  });
  test('detail comes from NEXT_DATA and validates shape', () => {
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { pageData: { fundDetailsData: detail } } } })}</script>`;
    expect(parseDetail(html).id).toBe(agem.id);
    expect(() => parseDetail('<html/>')).toThrow();
  });
  test('key information figures', () => {
    const p = parseKeyInformation(keyInfo());
    expect(p.ter).toBe(1.18);
    expect(p.netExpense).toBe(0.7);
    expect(p.aum).toBe(375893057.43);
    expect(p.secYield).toBe(1.48);
  });
  test('holdings first page declares the full count and is not the full portfolio', () => {
    const h = parseHoldings({ ...holdingsPayload, totalResults: 95 });
    expect(h.total).toBe(95);
    expect(h.rows.length).toBe(2);
    expect(h.asOfDate).toBe('2026-09-25');
    expect(h.rows[0].Ticker).toBe('A005935');
  });
  test('FundTicker never becomes a constituent ticker; missing weight is not zero', () => {
    const h = parseHoldings({ totalResults: 1, results: [{ rowLabel: 'Cash', columns: [{ columnLabel: 'FundTicker', columnRowValue: 'BCD' }] }] });
    expect(h.rows[0].Ticker).toBe('-');
    expect(h.rows[0].Weight).toBe('');
  });
  test('unknown weight vs zero vs negative preserved', () => {
    const make = (v: string) => parseHoldings({ totalResults: 1, results: [{ rowLabel: 'Cash', columns: [{ columnLabel: 'Weight', columnRowValue: v }] }] }).rows[0].Weight;
    expect(make('0')).toBe('0');
    expect(make('-0.35')).toBe('-0.35');
    expect(make('N/A')).toBe('');
  });
  test('official return figures; benchmark ignored', () => {
    expect(parsePerformance(annual).values.yr3).toBe(27.89);
    expect(parsePerformance(cumulative).values.yr1).toBe(43.17);
    expect(parsePerformance(annual).date).toBe('2026-08-31');
  });
  test('calendar 2025 is not trailing one year', () => {
    expect(parsePerformance({ performanceSet: [{ performanceCategoryType: 'NAV', values: [{ performanceTimePeriodLabel: 'timePeriod2025', performanceTimePeriod: '2025', value: '99' }] }] }).values.yr1).toBeNull();
  });
  test('US timestamp dates parsed correctly', () => {
    expect(isoDate('8/31/2026 12:00:00 AM')).toBe('2026-08-31');
    expect(isoDate('2026-09-25T00:00:00Z')).toBe('2026-09-25');
    expect(isoDate('')).toBeNull();
  });
});

describe('pagination completeness', () => {
  test('multiple pages until exact declared total', async () => {
    const skips: number[] = [];
    const rows = await collectPages(async (skip, take) => { skips.push(skip); return { rows: [0, 1, 2, 3, 4].slice(skip, skip + take), total: 5 }; }, 2);
    expect(rows).toEqual([0, 1, 2, 3, 4]);
    expect(skips).toEqual([0, 2, 4]);
  });
  test('empty intermediate page fails instead of truncating', async () => expect(collectPages(async () => ({ rows: [], total: 5 }))).rejects.toThrow('Incomplete'));
  test('changing total fails', async () => expect(collectPages(async skip => ({ rows: [skip], total: skip ? 4 : 3 }), 1)).rejects.toThrow('Total changed'));
  test('empty actual dataset accepted by the generic collector', async () => expect(collectPages(async () => ({ rows: [], total: 0 }))).resolves.toEqual([]));
});

describe('Yahoo history, financial math and deterministic writers', () => {
  test('round Yahoo adjusted close at parse time', () => {
    const p = parseChart({ chart: { result: [{ timestamp: [1700000000], indicators: { quote: [{ close: [40.123456789], volume: [10] }], adjclose: [{ adjclose: [40.129991] }] }, events: { dividends: { x: { date: 1700000000, amount: 0.5 } } } }] } });
    expect(p.days[0].adjClose).toBe(40.13);
    expect(p.dividends.length).toBe(1);
  });
  test('zero CAGR produces zero cumulative rather than null', () => expect(annualizedToTotal(0, 3)).toBe(0));
  test('short history cannot invent three-year returns', () => {
    expect(priceReturns([{ date: '2026-01-01', close: 10, adjClose: 10, volume: 0 }, { date: '2026-09-25', close: 11, adjClose: 11, volume: 0 }], new Date('2026-09-25')).cagr3y).toBeNull();
  });
  test('recursive timestamps and key order do not rewrite data', () => {
    expect(samePublishedContent('{"source":{"generatedAt":"old","x":1},"catalogReadAt":"old"}', { catalogReadAt: 'new', source: { x: 1, generatedAt: 'new' } })).toBe(true);
    expect(samePublishedContent('{"x":1}', { x: 2 })).toBe(false);
  });
  test('limited history merges instead of truncating the past', () => {
    expect(mergeHistory([{ Date: 'Jan 01 2020', Close: '10', 'Adj Close': '10', Volume: '0' }], [{ date: '2026-09-25', close: 11, adjClose: 11, volume: 1 }]).length).toBe(2);
  });
  test('full-word frequency: Semi-annually is not monthly', () => {
    expect(decodeDividendFrequency('Semi-annually')?.paymentsPerYear).toBe(2);
    expect(decodeDividendFrequency('Monthly')?.paymentsPerYear).toBe(12);
    expect(decodeDividendFrequency('')).toBeNull();
  });
  test('missing numbers stay null', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('0')).toBe(0);
    expect(normalizeNumberText('2.9E8')).toBe('290000000');
  });
});

describe('metrics contract: returnsBasis and performanceAsOf', () => {
  const none = { ...priceReturns([]) };
  test('display, ISO and US dates become YYYY-MM-DD; garbage is null', () => {
    expect(displayDateToIso('Aug 31 2026')).toBe('2026-08-31');
    expect(displayDateToIso('2026-09-25T00:00:00Z')).toBe('2026-09-25');
    expect(displayDateToIso('9/5/2026')).toBe('2026-09-05');
    expect(displayDateToIso('—')).toBeNull();
    expect(displayDateToIso('Foo 31 2026')).toBeNull();
    expect(displayDateToIso(undefined)).toBeNull();
  });
  test('official table: as-of is the table date, basis is the official label, both keys come last', () => {
    const m = buildMetrics({ asOfDate: 'Aug 31 2026', ytd: 1, yr1: 2 }, { ...none, asOfDate: '2026-08-28' }, 0.5, 1.2, true);
    expect(m.performanceAsOf).toBe('2026-08-31');
    expect(m.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
    expect(Object.keys(m).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
  });
  test('Yahoo-derived: as-of is the last close, basis says not official NAV; unknown is null, basis never empty', () => {
    const derived = { ...none, asOfDate: '2026-09-25' };
    const y = buildMetrics(null, derived, null, null, false);
    expect(y.performanceAsOf).toBe('2026-09-25');
    expect(y.returnsBasis).toBe(YAHOO_RETURNS_BASIS);
    const u = buildMetrics(null, none, null, null, false);
    expect(u.performanceAsOf).toBeNull();
    expect(String(u.returnsBasis).trim()).not.toBe('');
    expect(u.returnsBasis).not.toBe('-');
  });
});

describe('SEC sibling parser and series isolation', () => {
  const xml = '<edgarSubmission><genInfo><regName>abrdn Funds</regName><regCik>1413594</regCik><seriesName>abrdn Emerging Markets Dividend Active ETF</seriesName><seriesId>S000001</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSec><name>Example</name><cusip>123456789</cusip><pctVal>5</pctVal><valUSD>50</valUSD><balance>2</balance><assetCat>EC</assetCat></invstOrSec></edgarSubmission>';
  test('ticker map is field order independent', () => {
    expect(parseFundTickerMap({ fields: ['symbol', 'classId', 'cik', 'seriesId'], data: [['AGEM', 'C1', 1413594, 'S000001']] }).get('AGEM')).toEqual({ cik: '0001413594', seriesId: 'S000001', classId: 'C1' });
  });
  test('N-PORT extraction', () => {
    const p = parseNport(xml);
    expect(p.holdings[0].Identifier).toBe('123456789');
    expect(p.netAssets).toBe(1000);
  });
  test('different series under the same trust is rejected', () => {
    const p = parseNport(xml);
    expect(nportMatches(agem, p, { cik: '0001413594', seriesId: 'S000002', classId: 'C1' })).toBe(false);
    expect(nportMatches(agem, p)).toBe(true);
    expect(nportMatches({ ...agem, name: 'Another Fund' }, p)).toBe(false);
  });
});

// Isolated end-to-end runner: real writer/main, mocked public transport,
// temporary API root. No network requests, no mutation of committed data.
test('offline pipeline: first publication, byte-identical rerun, outage retention, fresh filters and cursor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aberdeen-test-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await cp(new URL('update-data.ts', import.meta.url), join(dir, 'scripts/update-data.ts'));
    const payloads = {
      overview: { content: { overview: [overview[1]], resultCount: 1 } },
      prices: { content: { prices: [prices[1]], resultCount: 1 } },
      detail, key: keyInfo(), annual, cumulative, holdings: holdingsPayload,
    };
    await Bun.write(join(dir, 'fixture.json'), JSON.stringify(payloads));
    await Bun.write(join(dir, 'runner.ts'), `import {main} from './scripts/update-data';
const p=await Bun.file('./fixture.json').json();let fail=false;
globalThis.fetch=async(input,init)=>{const u=String(input); if(fail) return new Response('denied',{status:403});
let v;if(u.includes('/view-all-funds/'))return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{pageData:{fundDetailsData:p.detail}}}})+'</script>');
if(u.endsWith('/overview'))v=p.overview;else if(u.endsWith('/prices'))v=p.prices;else if(u.endsWith('fundDetailsKeyInformation'))v=p.key;else if(u.endsWith('fundDetailsCodes'))v={content:{isin:'US00384X3017'}};else if(u.endsWith('/annualized'))v=p.annual;else if(u.endsWith('/cumulative'))v=p.cumulative;else if(u.endsWith('/dailyHoldings'))v=p.holdings;else return new Response('',{status:404});return Response.json(v);};
const env={REQUEST_SLEEP:'0',MAX_RETRIES:'1',EDGAR_FALLBACK:'0',SKIP_YAHOO:'1'};
const hash=async()=>{const g=new Bun.Glob('api/**/*.json');const r={};for await(const f of g.scan('.'))r[f]=await Bun.file(f).text();return JSON.stringify(Object.entries(r).sort());};
await main(env);const first=await hash();
{const idx=await Bun.file('api/aberdeen/index.json').json();for(const f of idx.funds){const k=Object.keys(f.metrics);if(k.slice(-2).join()!=='returnsBasis,performanceAsOf')throw Error('metrics key order');if(!String(f.metrics.returnsBasis).trim()||f.metrics.returnsBasis==='-')throw Error('empty returnsBasis');if(f.metrics.performanceAsOf!==null&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(f.metrics.performanceAsOf))throw Error('performanceAsOf format');}}await main(env);if(first!==await hash())throw Error('Not idempotent');
fail=true;await main(env);if(process.exitCode!==1)throw Error('Outage must exit non-zero');process.exitCode=0;if(first!==await hash())throw Error('Outage changed published files');
fail=false;p.key.content.fund.fundSizeWithDate.value='500';await main({...env,AUM:'1000:'});if(first!==await hash())throw Error('Fresh filter did not preserve excluded fund');
await main({...env,MAX_FETCHES:'1'});const state=await Bun.file('api/aberdeen/update-state.json').json();if(state.cursor!=='AGEM')throw Error('Cursor incorrect');await main(env);if(await Bun.file('api/aberdeen/update-state.json').exists())throw Error('Full run did not reset cursor');if(process.exitCode)throw Error('Unexpected exit code '+process.exitCode);`);
    const child = Bun.spawn([process.execPath, 'runner.ts'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
    const code0 = await child.exited; if (code0) console.log(stdout);
    expect({ code: code0, stderr: /error/i.test(stderr) ? stderr : '', stdout: stdout.includes('NaN') ? 'NaN' : '' }).toEqual({ code: 0, stderr: '', stdout: '' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);

const file = JSON.parse(await read('scripts/update-data.config.json').catch(() => '{}'));

describe('resolveControls layering', () => {
  test('precedence: file < advanced < nonblank input < environment (brand alias wins)', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'AGEM' }, { CONCURRENCY: 3, TICKERS: 'SGOL' }, { CONCURRENCY: '4', TICKERS: '' }, { ABERDEEN_CONCURRENCY: '5', CONCURRENCY: '6' });
    expect(c).toEqual({ CONCURRENCY: '5', TICKERS: 'SGOL' });
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });
  test('an explicitly set empty environment variable clears the control', () => {
    expect(resolveControls({ TICKERS: 'AGEM' }, { TICKERS: 'SGOL' }, { TICKERS: 'BCD' }, { TICKERS: '' }).TICKERS).toBe('');
  });
  test('blank input inherits the file value; advanced can clear a key deliberately', () => {
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'AGEM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  });
  test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
    const c = resolveControls(file, {}, {}, {});
    expect(c).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
    for (const value of Object.values(c)) expect(typeof value).toBe('string');
  });
  test('invalid shapes, unknown keys, non-scalars and control characters are rejected', () => {
    for (const bad of [{ UNKNOWN: 1 }, { TICKERS: ['AGEM'] }, { TICKERS: { a: 1 } }, { TICKERS: null }, null, [], 'x', 1]) {
      expect(() => resolveControls(bad as any)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\nEVIL=yes' })).toThrow();
    expect(() => resolveControls({}, {}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { ABERDEEN_SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, [] as any)).toThrow();
    expect(() => JSON.parse('{oops')).toThrow();
  });
  test('per-control validation is strict (no silent fallback)', () => {
    const bad = [{ CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { AUM: '1:2:3' }, { TER: 'a:b' }, { HOLDINGS_PAGE_SIZE: 0 }];
    for (const b of bad) expect(() => resolveControls(b)).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
    expect(resolveControls({ MAX_RETRIES: 1 }).MAX_RETRIES).toBe('1');
  });
});

describe('abrdn defaults and docs parity', () => {
  test('provider-specific default values', () => {
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.concurrency).toBe(2);
    expect(config.maxRetries).toBe(2);
    expect(file.REQUEST_SLEEP).toBe('1');
    expect(file.HISTORY_RANGE).toBe('max');
    expect(file.HOLDINGS_PAGE_SIZE).toBe('250');
    expect(file.HISTORY_PAGE_SIZE).toBe('1000');
    expect(file.EDGAR_FALLBACK).toBe('true');
    expect(file.SKIP_ABERDEEN).toBe('false');
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
  });
  test('config values are strings and keys equal CONTROL_NAMES', () => {
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
  });
  test('README rows, --help and the config file agree with CONTROL_NAMES', async () => {
    const doc = await read('README.md');
    const rows = [...doc.matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map(m => m[1]);
    expect(rows.sort()).toEqual([...CONTROL_NAMES].sort());
    expect(doc).toContain('scripts/update-data.config.json');
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], { stdout: 'pipe', stderr: 'pipe' });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) expect(help).toContain(name);
    expect(help).not.toContain('daggerok@gmail.com');
  });
  test('README structure and verification section', async () => {
    const doc = await read('README.md');
    const headings = [...doc.matchAll(/^#{1,3} (.+)$/gm)].map(m => m[1]);
    const order = ['Using Bun', 'Updating the static abrdn data', 'Data sources', 'Metrics and caveats', 'Update controls', 'Examples', 'TypeScript and verification', 'Brands table', 'Sibling applications', 'License'];
    let at = -1;
    for (const h of order) { const i = headings.indexOf(h); expect(i).toBeGreaterThan(at); at = i; }
    for (const cmd of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) expect(doc).toContain(cmd);
    expect(doc).not.toMatch(/worklog|evidence\/|fixtures|config-docs\.test/i);
  });
  test('runtimeControls reads the file and lets the environment win', async () => {
    expect((await runtimeControls({})).CONCURRENCY).toBe(file.CONCURRENCY);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
  });
});

describe('config colocated with the updater', () => {
  test('runtime reads scripts/update-data.config.json independently of cwd; env still wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aberdeen-config-location-'));
    try {
      await mkdir(join(dir, 'scripts'));
      await mkdir(join(dir, 'other-cwd'));
      await cp(new URL('update-data.ts', import.meta.url), join(dir, 'scripts/update-data.ts'));
      await Bun.write(join(dir, 'scripts/update-data.config.json'), JSON.stringify({ CONCURRENCY: 7, TICKERS: 'AGEM' }));
      // Decoys ensure neither the repository root nor the current directory wins.
      await Bun.write(join(dir, 'update-data.config.json'), JSON.stringify({ CONCURRENCY: 9 }));
      await Bun.write(join(dir, 'other-cwd/update-data.config.json'), JSON.stringify({ CONCURRENCY: 11 }));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !(CONTROL_NAMES as readonly string[]).includes(key) && !key.startsWith('ABERDEEN_')));
      for (const [override, expected] of [[{}, 7], [{ CONCURRENCY: '3' }, 3]] as const) {
        const child = Bun.spawn([process.execPath, join(dir, 'scripts/update-data.ts'), '--help'], { cwd: join(dir, 'other-cwd'), env: { ...env, ...override }, stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
        expect(stdout).toContain(`CONCURRENCY=${expected}\n`);
        expect(stdout).toContain('TICKERS=AGEM\n');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('workflow', () => {
  let workflow = '';
  let inputsBlock = '';
  let inputNames: string[] = [];
  test('inputs: at most 25, advanced defaults to {}, every individual input is a control', async () => {
    workflow = await read('.github/workflows/update-data.yml');
    inputsBlock = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
    inputNames = [...inputsBlock.matchAll(/^      (\w+):$/gm)].map(m => m[1]);
    expect(inputNames.length).toBeLessThanOrEqual(25);
    expect(inputNames).toContain('advanced');
    expect(inputsBlock).toMatch(/advanced:[\s\S]*?default: '\{\}'/);
    for (const name of inputNames.filter(n => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
    expect(inputNames).toContain('concurrency');
    expect(inputNames).toContain('tickers');
  });
  test('schedule, fixed output dir, hardening and no direct inputs interpolation', async () => {
    workflow = await read('.github/workflows/update-data.yml');
    expect(workflow).toContain("cron: '0 0 * * 0'");
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).toContain('toJSON(inputs)');
    expect(workflow).not.toMatch(/\$\{\{\s*(github\.event\.)?inputs\./);
    expect(workflow).not.toContain('OUTPUT_DIR');
    expect(workflow).toContain('timeout-minutes: 30');
    expect(workflow).toContain('persist-credentials: false');
    expect([...workflow.matchAll(/git add (\S+)/g)].map(m => m[1])).toEqual(['api/aberdeen']);
    expect(workflow).toContain('git add api/aberdeen\n          if git diff --cached --quiet -- api/aberdeen');
  });
  test('protected SEC_UA variable wins only when nonblank and is never an input', async () => {
    workflow = await read('.github/workflows/update-data.yml');
    expect(workflow).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(workflow).toContain('if ((process.env.PROTECTED_SEC_UA ?? "").trim())');
    expect(workflow).not.toMatch(/^      sec_ua:/m);
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, {}).SEC_UA).toBe('advanced');
  });
  test('the actual Actions resolver step loads the config and applies manual overrides', async () => {
    const parsed = Bun.YAML.parse(await read('.github/workflows/update-data.yml')) as any;
    const step = parsed.jobs['update-data'].steps.find((s: any) => s.name === 'Resolve file defaults and manual overrides');
    const dir = await mkdtemp(join(tmpdir(), 'aberdeen-actions-config-'));
    try {
      const githubEnv = join(dir, 'github-env');
      const child = Bun.spawn(['bash', '-c', step.run], {
        cwd: root('').pathname,
        env: {
          ...process.env,
          PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:${process.env.PATH ?? ''}`,
          GITHUB_ENV: githubEnv,
          DISPATCH_INPUTS: JSON.stringify({ concurrency: '3', tickers: 'AGEM', advanced: JSON.stringify({ MAX_FETCHES: 2 }) }),
        },
        stdout: 'pipe', stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' });
      const values = Object.fromEntries((await readFile(githubEnv, 'utf8')).trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
      expect(values.CONCURRENCY).toBe('3');
      expect(values.TICKERS).toBe('AGEM');
      expect(values.MAX_FETCHES).toBe('2');
      expect(values.REQUEST_SLEEP).toBe('1');
      expect(Object.keys(values)).toHaveLength(CONTROL_NAMES.length);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('real concurrency', () => {
  async function peakInFlight(concurrency: number, sleepSeconds: number, funds = 6): Promise<{ peak: number; ms: number }> {
    const realFetch = globalThis.fetch;
    let inFlight = 0, peak = 0, next = 0;
    globalThis.fetch = (async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 60));
      inFlight--;
      return new Response('{}');
    }) as unknown as typeof fetch;
    setRequestSleep(sleepSeconds);
    const started = Date.now();
    try {
      await runWorkers(concurrency, async () => {
        for (;;) {
          const i = next++; if (i >= funds) return;
          await fetchWithRetry(`https://example.test/${i}`, `[ test ] ${i}`, {}, 0);
        }
      });
    } finally { globalThis.fetch = realFetch; setRequestSleep(0); }
    return { peak, ms: Date.now() - started };
  }
  test('CONCURRENCY=1 peaks at 1 in-flight request', async () => {
    expect((await peakInFlight(1, 0.02)).peak).toBe(1);
  });
  test('CONCURRENCY=3 peaks at 3 with REQUEST_SLEEP>0 (lanes, not one global gate)', async () => {
    const { peak } = await peakInFlight(3, 0.05);
    expect(peak).toBe(3);
  });
  test('workers scale throughput under REQUEST_SLEEP', async () => {
    const one = await peakInFlight(1, 0.1, 6);
    const three = await peakInFlight(3, 0.1, 6);
    expect(three.ms).toBeLessThan(one.ms * 0.7);
  });
});

describe('USE_SYSTEM_CA', () => {
  test('resolver accepts auto/true/false case-insensitively, rejects others; default is auto', () => {
    expect(resolveControls(file).USE_SYSTEM_CA).toBe('auto');
    for (const v of ['auto', 'TRUE', 'False']) expect(resolveControls(file, {}, {}, { USE_SYSTEM_CA: v }).USE_SYSTEM_CA).toBe(v.toLowerCase());
    expect(() => resolveControls(file, {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow(/USE_SYSTEM_CA/);
  });
  test('isCertError recognizes certificate failures, including nested causes', () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
  });
  test('installSystemCa wraps fetch only when needed', async () => {
    const original = globalThis.fetch;
    const never = (() => { throw new Error('reexec'); }) as () => never;
    try {
      installSystemCa('false', never, false);
      expect(globalThis.fetch).toBe(original);
      installSystemCa('auto', never, true);
      expect(globalThis.fetch).toBe(original);
      let calls = 0;
      expect(() => installSystemCa('true', (() => { calls++; throw new Error('now'); }) as () => never, false)).toThrow('now');
      expect(calls).toBe(1);
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
    } finally { globalThis.fetch = original; }
  });
});

// ---------------------------------------------------------------------------
// Fix-contract tests. Each scenario runs the real main() in a child process against a
// mocked multi-fund transport and a temporary API root (no network, no committed data).
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
    const child = Bun.spawn([process.execPath, 'runner.ts'], { cwd: dir, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const passes = async (body: string, env: Record<string, string> = {}) => {
  const r = await runScenario(body, env);
  // "[ tag ]" lines are the updater's own warnings; anything else on stderr is a crash or a failed ASSERT
  expect({ code: r.code, stderr: r.stderr.split('\n').filter(l => l.trim() && !l.startsWith('[ ')).join('\n') }).toEqual({ code: 0, stderr: '' });
  return r;
};

describe('brand aliases through resolveControls', () => {
  test('HISTORICAL_PAGE_SIZE and ABERDEEN_LIMIT reach the config', () => {
    const config = readConfig(resolveControls(file, {}, {}, { HISTORICAL_PAGE_SIZE: '100', ABERDEEN_LIMIT: '3' }));
    expect(config.historyPageSize).toBe(100);
    expect(config.maxFetches).toBe(3);
    expect(CONTROL_ALIASES.MAX_FETCHES).toContain('ABERDEEN_LIMIT');
  });
  test('precedence: ABERDEEN_<NAME> > <NAME> > legacy alias; an invalid alias value is an error', () => {
    expect(resolveControls({}, {}, {}, { ABERDEEN_HISTORY_PAGE_SIZE: '7', HISTORY_PAGE_SIZE: '8', HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('7');
    expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: '8', HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('8');
    expect(() => resolveControls({}, {}, {}, { ABERDEEN_LIMIT: 'x' })).toThrow();
  });
});

describe('metrics are not frozen or invented', () => {
  test('a Yahoo-derived month-end block never stands in for the official table: returns and performanceAsOf move with the data', async () => {
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
  test('returns and performanceAsOf stay together: no old table under a new date', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok((await row('AGEM')).metrics.performanceAsOf === '2026-08-31', 'as-of');
S.perfDate = '2026-09-30'; S.ytd = '12.5';
ok(await run() === 0, 'run 2');
const r = await row('AGEM');
ok(r.metrics.performanceAsOf === '2026-09-30' && r.metrics.ytd === 12.5, 'new table travels with new date ' + JSON.stringify(r.metrics));`);
  });
  test('an honest null from a source that answered is not replaced by the previous value', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok((await row('AGEM')).metrics.secYield === 1.48, 'secYield 1');
S.secYield = null;
ok(await run() === 0, 'run 2');
const r = await row('AGEM');
ok(r.metrics.secYield === null && r.metrics.secYieldText === '—', 'honest null ' + JSON.stringify(r.metrics.secYield));
ok((await meta('AGEM')).yields.secYield === null, 'meta secYield');`);
  });
  test('premium/discount is null when NAV and price dates differ, never the old value', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok((await row('AGEM')).premiumDiscountValue !== null, 'premium 1');
S.priceDate = '2026-09-24';
ok(await run() === 0, 'run 2');
const r = await row('AGEM');
ok(r.premiumDiscountValue === null, 'premium after date mismatch ' + r.premiumDiscountValue);`);
  });
  test('dividend yield is the trailing 12 months, not the latest lumpy distribution', async () => {
    const r = await passes(`ok(await run() === 0, 'run');
const agem = await row('AGEM'), bcd = await row('BCD'), sgol = await row('SGOL');
ok(agem.metrics.dividendYield === 4, 'AGEM ' + agem.metrics.dividendYield);
ok(bcd.metrics.dividendYield === 5.2, 'BCD lumpy ' + bcd.metrics.dividendYield);
ok(sgol.metrics.dividendYield === null, 'SGOL has no distributions');
ok(bcd.metrics.dividendYieldText === '5.20%', 'text');
ok((await meta('BCD')).yields.dividendYieldKind.includes('trailing 12 months'), 'kind');`);
    expect(r.stdout).not.toContain('NaN');
  });
  test('trailing yield needs 12 months of history and a distribution in the window', async () => {
    const d = [{ epoch: Date.parse('2026-03-16T14:30:00Z') / 1000, amount: 1 }, { epoch: Date.parse('2025-03-16T14:30:00Z') / 1000, amount: 5 }];
    expect(trailingYield(d, 50, '2026-09-25', '2024-01-02')).toBe(2);
    expect(trailingYield(d, 50, '2026-09-25', '2026-03-02')).toBeNull();
    expect(trailingYield([], 50, '2026-09-25', '2024-01-02')).toBeNull();
    expect(trailingYield(d, null, '2026-09-25', '2024-01-02')).toBeNull();
    expect(trailingYield(d, 0, '2026-09-25', '2024-01-02')).toBeNull();
  });
  test('a young fund (under 12 months of history) has no yield', async () => {
    await passes(`S.chartFrom = '2026-03-02';
ok(await run() === 0, 'run');
ok((await row('BCD')).metrics.dividendYield === null, 'BCD young');
ok((await row('AGEM')).metrics.dividendYield === null, 'AGEM young');`);
  });
  test('siAnn needs a year of life at the as-of date', () => {
    const day = (date: string, v: number) => ({ date, close: v, adjClose: v, volume: 0 });
    expect(priceReturns([day('2026-01-02', 10), day('2026-09-25', 11)], new Date('2026-09-25')).siAnn).toBeNull();
    expect(priceReturns([day('2025-09-24', 10), day('2026-09-25', 11)], new Date('2026-09-25')).siAnn).not.toBeNull();
  });
});

describe('expense ratio: terValue is the net figure', () => {
  test('net in terValue, gross alongside; the TER filter acts on net', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const r = await row('AGEM'), m = await meta('AGEM');
ok(r.terValue === 0.7 && r.terGrossValue === 1.18 && r.ter === '0.70%' && r.terGross === '1.18%', 'row ' + JSON.stringify([r.ter, r.terValue, r.terGross, r.terGrossValue]));
ok(m.expenseRatio.value === 0.7 && m.expenseRatio.gross === 1.18 && m.expenseRatio.net === 0.7, 'meta');
S.navAdd = 1;
ok(await run({ TER: ':0.8' }) === 0, 'filtered run');
ok((await meta('AGEM')).nav.value === 50.7222, 'AGEM passes TER 0.8 on net');`);
  });
});

describe('fund-level consistency and exit code', () => {
  test('a failed source keeps that fund fully as published; the others still update; exit 0', async () => {
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
  test('every examined fund kept because its source failed gives a non-zero exit and no change', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const before = await snap();
S.navAdd = 1; S.fail = (u) => u.includes('/chart/');
ok(await run() === 1, 'expected exit 1');
ok(before === await snap(), 'files changed');`);
  });
  test('a fund that was never published and fails is not published half-way', async () => {
    const r = await runScenario(`S.catalog = ['AGEM', 'BCD']; ok(await run() === 0, 'run 1');
S.catalog = ['AGEM', 'BCD', 'SGOL']; S.fail = (u) => u.includes('/chart/SGOL');
const code = await run();
ok(code === 1, 'exit ' + code);
ok((await idx()).funds.length === 2, 'rows');
ok(!(await Bun.file('api/aberdeen/funds/SGOL/meta.json').exists()), 'no meta for the failed new fund');`);
    expect({ code: r.code, stderr: r.stderr.trim() }).toEqual({ code: 0, stderr: '' });
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
});

describe('filtered runs, cursor and ticker validation', () => {
  test('a TICKERS run on a multi-fund index keeps every row and file, and never moves or deletes the cursor', async () => {
    await passes(`ok(await run() === 0, 'run 1');
ok((await idx()).funds.length === 3, 'rows 1');
ok(await run({ MAX_FETCHES: '2' }) === 0, 'batch');
const state = await Bun.file('api/aberdeen/update-state.json').text();
const others = await snap('/BCD/') + await snap('/SGOL/');
S.navAdd = 1;
ok(await run({ TICKERS: 'AGEM' }) === 0, 'tickers');
ok((await idx()).funds.length === 3, 'index shrank');
ok(others === await snap('/BCD/') + await snap('/SGOL/'), 'unselected fund files changed');
ok((await meta('AGEM')).nav.value === 50.7222, 'selected fund updated');
ok(state === await Bun.file('api/aberdeen/update-state.json').text(), 'cursor touched by a TICKERS run');
ok(await run({ TICKERS: 'AGEM', MAX_FETCHES: '1' }) === 0, 'tickers with batch');
ok(state === await Bun.file('api/aberdeen/update-state.json').text(), 'cursor moved by a TICKERS batch');`);
  });
  test('an unknown ticker is an error (exit 1, nothing written)', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const before = await snap();
ok(await run({ TICKERS: 'AGEM NOPE' }) === 1, 'unknown ticker must exit 1');
ok(await run({ TICKERS: 'NOPE' }) === 1, 'only unknown must exit 1');
ok(before === await snap(), 'files changed');`);
  });
  test('MAX_FETCHES counts funds that pass the filters and wraps around', async () => {
    await passes(`ok(await run() === 0, 'run 1');
// TER >= 0.2 excludes SGOL (0.17): the batch of 2 must still refresh two funds that pass
S.navAdd = 1;
ok(await run({ MAX_FETCHES: '2', TER: '0.2:' }) === 0, 'batch');
ok((await meta('AGEM')).nav.value === 50.7222 && (await meta('BCD')).nav.value === 39.9448, 'two passing funds updated');
ok((await meta('SGOL')).nav.value === 40.1, 'excluded fund untouched');
ok((await readJ('api/aberdeen/update-state.json')).cursor === 'BCD', 'cursor after the last examined fund');
S.navAdd = 2;
ok(await run({ MAX_FETCHES: '1', TER: '0.2:' }) === 0, 'next batch wraps');
// order after BCD is SGOL (excluded, does not count), AGEM (counts), so BCD is not reached
ok((await meta('AGEM')).nav.value === 51.7222 && (await meta('BCD')).nav.value === 39.9448, 'wrapped past the excluded fund to AGEM only');
ok((await readJ('api/aberdeen/update-state.json')).cursor === 'AGEM', 'cursor moved to AGEM');`);
  });
});

describe('new funds, stamps, deadline and page order', () => {
  test('NEW FUNDS is printed and appended to the step summary; first publication prints none', async () => {
    const r = await passes(`const fs = await import('node:fs');
S.catalog = ['AGEM', 'BCD'];
ok(await run({ GITHUB_STEP_SUMMARY: 'summary.md' }) === 0, 'run 1');
ok(!fs.readFileSync('summary.md', 'utf8').includes('NEW FUNDS'), 'no new funds on first publication');
S.catalog = ['AGEM', 'BCD', 'SGOL'];
ok(await run({ GITHUB_STEP_SUMMARY: 'summary.md' }) === 0, 'run 2');
ok(fs.readFileSync('summary.md', 'utf8').includes('NEW FUNDS: SGOL'), 'summary');`);
    expect(r.stdout).toContain('NEW FUNDS: SGOL');
    expect(r.stdout.match(/NEW FUNDS/g)?.length).toBe(1);
  });
  test('generatedAt is ISO without milliseconds and moves only with content', async () => {
    await passes(`ok(await run() === 0, 'run 1');
const a = await idx();
ok(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(a.generatedAt) && a.catalogReadAt === a.generatedAt, 'stamp ' + a.generatedAt);
const text = await snap();
await Bun.sleep(1100);
ok(await run() === 0, 'run 2');
ok(text === await snap(), 'a rerun with identical data wrote something');
S.navAdd = 1;
ok(await run() === 0, 'run 3');
ok((await idx()).generatedAt !== a.generatedAt, 'stamp must move with content');`);
  });
  test('the soft deadline stops new funds, keeps published data and still writes the index', async () => {
    const r = await passes(`ok(await run() === 0, 'run 1');
const before = await snap();
S.navAdd = 1; M.setRunDeadlineMs(-1);
ok(await run() === 0, 'deadline run');
ok(before === await snap(), 'a fund was taken after the deadline');`);
    expect(r.stdout).toContain('[ deadline ]');
  });
  test('pages are rewritten before meta.json and stale pages are removed after it', async () => {
    await passes(`const fs = await import('node:fs');
ok(await run({ HOLDINGS_PAGE_SIZE: '1', HISTORY_PAGE_SIZE: '400' }) === 0, 'run 1');
ok(fs.readdirSync('api/aberdeen/funds/AGEM/holdings').length === 2, 'two holdings pages');
ok(await run({ HOLDINGS_PAGE_SIZE: '250', HISTORY_PAGE_SIZE: '5000' }) === 0, 'run 2');
ok(fs.readdirSync('api/aberdeen/funds/AGEM/holdings').join() === '001.json', 'stale holdings page removed');
const m = await meta('AGEM');
ok(m.holdings.pages.join() === 'holdings/001.json' && m.history.pages.length === 1, 'manifest matches the files');
ok(fs.readdirSync('api/aberdeen/funds/AGEM/history').length === 1, 'stale history pages removed');
ok(!fs.readdirSync('api/aberdeen/funds/AGEM').some(f => f.endsWith('.tmp')), 'tmp file left');`);
  });
});

describe('dates are UTC', () => {
  test('a run east of UTC gives the same output as a run in UTC', async () => {
    const scenario = `S.perfTab = false;
ok(await run() === 0, 'run 1');
S.chartTo = '2026-10-02';
ok(await run() === 0, 'run 2');
const r = await row('AGEM'), m = await meta('AGEM');
console.log('RESULT ' + JSON.stringify([r.metrics.performanceAsOf, m.history.asOf, m.returns.monthEnd.asOfDate, r.metrics.ytd, r.metrics.tr1y, r.history]));`;
    const utc = await passes(scenario, { TZ: 'UTC' });
    const moscow = await passes(scenario, { TZ: 'Europe/Moscow' });
    const berlinMinus = await passes(scenario, { TZ: 'America/Los_Angeles' });
    const pick = (o: { stdout: string }) => o.stdout.split('\n').find(l => l.startsWith('RESULT '));
    expect(pick(utc)).toContain('"2026-10-02","Oct 02 2026","Oct 02 2026"');
    expect(pick(moscow)).toBe(pick(utc));
    expect(pick(berlinMinus)).toBe(pick(utc));
  });
  test('mergeHistory keys text dates as calendar dates', async () => {
    const r = await runScenario(`const rows = M.mergeHistory([{ Date: 'Jun 30 2026', Close: '1', 'Adj Close': '1', Volume: '1' }], [{ date: '2026-06-30', close: 2, adjClose: 2, volume: 2 }, { date: '2026-07-01', close: 3, adjClose: 3, volume: 3 }]);
console.log('RESULT ' + JSON.stringify(rows.map(x => [x.Date, x.Close])));`, { TZ: 'Pacific/Auckland' });
    expect(r.stdout).toContain('RESULT [["Jun 30 2026","2"],["Jul 01 2026","3"]]');
  });
});

describe('network: timeout covers headers and body, retried per MAX_RETRIES', () => {
  test('a stalled body is aborted by the timeout and retried', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    setFetchTimeoutMs(60);
    setRequestSleep(0);
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls++;
      if (calls === 1) {
        return { ok: true, status: 200, text: () => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))) } as unknown as Response;
      }
      return new Response('done');
    }) as unknown as typeof fetch;
    try {
      expect(await fetchTextWithRetry('https://example.test/x', '[ test ]', {}, 1)).toBe('done');
      expect(calls).toBe(2);
    } finally { globalThis.fetch = original; setFetchTimeoutMs(45_000); }
  }, 15000);
  test('a request that never answers fails after the retries instead of hanging', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    setFetchTimeoutMs(40);
    globalThis.fetch = ((_url: string, init: RequestInit) => { calls++; return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))); }) as unknown as typeof fetch;
    try {
      await expect(fetchTextWithRetry('https://example.test/y', '[ test ]', {}, 1)).rejects.toThrow('network error');
      expect(calls).toBe(2);
    } finally { globalThis.fetch = original; setFetchTimeoutMs(45_000); }
  }, 15000);
});

describe('HISTORY_RANGE shrinks the Yahoo request', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  test('max uses period1=0, Ny uses an explicit period1 N years back', () => {
    const period = (url: string, name: string) => Number(new URL(url).searchParams.get(name));
    const max = chartUrl('AGEM', readConfig({ HISTORY_RANGE: 'max' }), now);
    expect(period(max, 'period1')).toBe(0);
    expect(period(max, 'period2')).toBe(Math.floor(now / 1000));
    const five = chartUrl('AGEM', readConfig({ HISTORY_RANGE: '5y' }), now);
    expect(period(five, 'period1')).toBe(Math.floor(now / 1000 - 5 * 365.25 * 86400));
    expect(new URL(five).searchParams.has('range')).toBe(false);
  });
});

describe('N-PORT fallback: freshness and failure', () => {
  const SERIES = 'S000001';
  const xml = (repPd: string) => `<edgarSubmission><genInfo><regName>abrdn Funds</regName><regCik>1413594</regCik><seriesName>abrdn Emerging Markets Dividend Active ETF</seriesName><seriesId>${SERIES}</seriesId><repPdDate>${repPd}</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSec><name>Example</name><cusip>123456789</cusip><pctVal>5</pctVal><valUSD>50</valUSD><balance>2</balance><assetCat>EC</assetCat></invstOrSec></edgarSubmission>`;
  const harness = (published: string, extra = '') => `const fund = { ticker: 'AGEM', name: 'abrdn Emerging Markets Dividend Active ETF', id: 'x', shareclassId: 'y', isin: 'z', assetClass: 'a', correlationFundRangeId: '', fundPage: '', nav: null, navDate: null };
const atom = '<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0001413594-26-000001</accession-number><filing-href>https://www.sec.gov/Archives/edgar/data/1413594/000141359426000001/x-index.htm</filing-href><filing-date>2026-08-01</filing-date><period>2026-06-30</period></entry></feed>';
globalThis.fetch = async (input) => {
  const u = String(input);
  ${extra}
  if (u.includes('company_tickers_mf')) return Response.json({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1413594, '${SERIES}', 'C1', 'AGEM']] });
  if (u.includes('company_tickers.json')) return Response.json({});
  if (u.includes('browse-edgar')) return new Response(atom);
  if (u.includes('primary_doc.xml')) return new Response(${JSON.stringify(xml('2026-06-30'))});
  return new Response('', { status: 404 });
};
M.setRequestSleep(0);
const config = M.readConfig({ REQUEST_SLEEP: '0', MAX_RETRIES: '1' });
const out = await M.resolveNportFiling(fund, config, ${published});`;
  test('a filing that is not newer than the published holdings never replaces them', async () => {
    const newer = await passes(`${harness("'2026-03-31'")}\nconsole.log('RESULT ' + (out ? out.asOfDate + ':' + out.rows.length : 'null'));`);
    expect(newer.stdout).toContain('RESULT 2026-06-30:1');
    const same = await passes(`${harness("'2026-06-30'")}\nconsole.log('RESULT ' + (out ? 'filing' : 'null'));`);
    expect(same.stdout).toContain('RESULT null');
    const fresher = await passes(`${harness("'2026-09-25'")}\nconsole.log('RESULT ' + (out ? 'filing' : 'null'));`);
    expect(fresher.stdout).toContain('RESULT null');
  });
  test('a transport failure with no result is an error (a source failure), a missing filing is not', async () => {
    const r = await passes(`${harness('null', "if (u.includes('primary_doc.xml') || u.includes('browse-edgar')) return new Response('denied', { status: 404 });").replace('const out = await M.resolveNportFiling(fund, config, null);', '')}
let threw = false; try { await M.resolveNportFiling(fund, config, null); } catch { threw = true; }
console.log('RESULT ' + threw);`);
    expect(r.stdout).toContain('RESULT true');
  });
});
