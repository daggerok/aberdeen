/// <reference types="bun" />
import { describe, test, expect } from 'bun:test';
import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES, resolveControls, runtimeControls,
  parseCatalog, catalogPayload, parseHoldings, parseKeyInformation, parsePerformance, parseDetail, readConfig, parseRange,
  parseAumRange, numberOrNull, normalizeNumberText, isoDate, decodeDividendFrequency, samePublishedContent, collectPages,
  parseNport, parseFundTickerMap, nportMatches, parseChart, priceReturns, annualizedToTotal, mergeHistory,
  batchSelection, fundFilterReasons, buildMetrics, displayDateToIso, OFFICIAL_RETURNS_BASIS, YAHOO_RETURNS_BASIS, fetchWithRetry, runWorkers, setRequestSleep,
  isCertError, installSystemCa,
} from './update-data';

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
    expect(batchSelection(funds, cfg, 'AGEM').map(f => f.ticker)).toEqual(['BCD', 'SGOL']);
    expect(batchSelection(funds, readConfig({ TICKERS: 'AGEM BCD', MAX_FETCHES: '0' }), 'BCD').map(f => f.ticker)).toEqual(['AGEM', 'BCD']);
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
fail=true;await main(env);if(first!==await hash())throw Error('Outage changed published files');
fail=false;p.key.content.fund.fundSizeWithDate.value='500';await main({...env,AUM:'1000:'});if(first!==await hash())throw Error('Fresh filter did not preserve excluded fund');
await main({...env,MAX_FETCHES:'1'});const state=await Bun.file('api/aberdeen/update-state.json').json();if(state.cursor!=='AGEM')throw Error('Cursor incorrect');await main(env);if(await Bun.file('api/aberdeen/update-state.json').exists())throw Error('Full run did not reset cursor');`);
    const child = Bun.spawn([process.execPath, 'runner.ts'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
    expect({ code: await child.exited, stderr: stderr.includes('Error:') ? stderr : '', stdout: stdout.includes('NaN') ? 'NaN' : '' }).toEqual({ code: 0, stderr: '', stdout: '' });
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
