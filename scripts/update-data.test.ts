/// <reference types="bun" />
import {describe,test,expect} from 'bun:test';
import {readFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCatalog,catalogPayload,parseHoldings,parseKeyInformation,parsePerformance,parseDetail,readConfig,parseRange,parseAumRange,numberOrNull,normalizeNumberText,isoDate,decodeDividendFrequency,samePublishedContent,collectPages,parseNport,parseFundTickerMap,nportMatches,parseChart,buildMetrics,priceReturns,annualizedToTotal,mergeHistory,batchSelection,fundFilterReasons} from './update-data';
const fixture=async(name:string)=>JSON.parse(await readFile(new URL(`../research/2026-09-27/${name}.json`,import.meta.url),'utf8'));
const overview=await fixture('catalog-overview'), prices=await fixture('catalog-prices');
const funds=parseCatalog(overview.content.overview,prices.content.prices), agem=funds.find(f=>f.ticker==='AGEM')!;
const detail=await fixture('AGEM-fund-details'), key=await fixture('AGEM-key-information');
const holdings=await fixture('AGEM-holdings-first-page');
const annual=await fixture('AGEM-performance-annualized'),cumulative=await fixture('AGEM-performance-cumulative');

describe('configuration, filters and cursor',()=>{
 test('defaults and explicit zero differ',()=>{expect(readConfig({}).requestSleep).toBe(1);expect(readConfig({REQUEST_SLEEP:'0'}).requestSleep).toBe(0);expect(readConfig({MAX_RETRIES:'0'}).maxRetries).toBe(0);});
 test('brand aliases win',()=>expect(readConfig({TICKERS:'BCD',ABERDEEN_TICKERS:'AGEM SGOL'}).tickers).toEqual(['AGEM','SGOL']));
 test('ranges are strict',()=>{expect(parseRange(':','TER')).toBeUndefined();expect(parseRange(':0.3%','TER')).toEqual({min:undefined,max:0.3});for(const s of ['15','1:2:3','a:2','4:1'])expect(()=>parseRange(s,'TER')).toThrow();});
 test('AUM suffixes/presets',()=>{expect(parseAumRange('10M:2B')).toEqual({min:1e7,max:2e9});expect(parseAumRange('large')).toEqual({min:1e10,max:undefined});expect(()=>parseAumRange('bad:2B')).toThrow();});
 test('all filters include SEC_YIELD and reject unknown values',()=>{
  const cfg=readConfig({SEC_YIELD:'1:2',PERFORMANCE_3Y:'2:4',TOTAL_RETURN_3Y:'5:20'});
  expect(fundFilterReasons({ticker:'X',metrics:{secYield:1.5,cagr3y:3,tr3y:10}},cfg)).toEqual([]);
  expect(fundFilterReasons({ticker:'X',metrics:{secYield:null,cagr3y:3,tr3y:10}},cfg)).toContain('SEC_YIELD');
 });
 test('bounded queue rotates deterministically after filtering',()=>{
  const cfg=readConfig({TICKERS:'AGEM BCD SGOL',MAX_FETCHES:'2'});
  expect(batchSelection(funds,cfg,'AGEM').map(f=>f.ticker)).toEqual(['BCD','SGOL']);
  expect(batchSelection(funds,readConfig({TICKERS:'AGEM BCD',MAX_FETCHES:'0'}),'BCD').map(f=>f.ticker)).toEqual(['AGEM','BCD']);
 });
});
describe('official responses verified live on 2026-09-27 (as-of dates retained)',()=>{
 test('11 unique tickers; official NAV is not market price',()=>{expect(funds.length).toBe(11);expect(agem.nav).toBe(49.7222);expect(agem.navDate).toBe('2026-09-25');expect(catalogPayload('prices')).not.toHaveProperty('date');});
 test('do not manufacture ETF ticker from name',()=>{expect(()=>parseCatalog(overview.content.overview,[{id:'x',name:'Test ETF',shareclasses:[{}]}])).toThrow();});
 test('detail comes from NEXT_DATA, validates shape',()=>{expect(parseDetail(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{pageData:{fundDetailsData:detail}}}})}</script>`).id).toBe(agem.id);expect(()=>parseDetail('<html/>')).toThrow();});
 test('key info matches actual AGEM figures',()=>{const p=parseKeyInformation(key);expect(p.ter).toBe(1.18);expect(p.netExpense).toBe(0.7);expect(p.aum).toBe(375893057.43);expect(p.secYield).toBe(1.48);});
 test('holdings first page declares full count; not full portfolio',()=>{const h=parseHoldings(holdings);expect(h.total).toBe(95);expect(h.rows.length).toBe(2);expect(h.asOfDate).toBe('2026-09-25');expect(h.rows[0].Ticker).toBe('A005935');});
 test('FundTicker must never become a constituent ticker; missing weight is not zero',()=>{const h=parseHoldings({totalResults:1,results:[{rowLabel:'Cash',columns:[{columnLabel:'FundTicker',columnRowValue:'BCD'}]}]});expect(h.rows[0].Ticker).toBe('-');expect(h.rows[0].Weight).toBe('');});
 test('unknown weight vs zero vs negative preserved',()=>{const make=(v:string)=>parseHoldings({totalResults:1,results:[{rowLabel:'Cash',columns:[{columnLabel:'Weight',columnRowValue:v}]}]}).rows[0].Weight;expect(make('0')).toBe('0');expect(make('-0.35')).toBe('-0.35');expect(make('N/A')).toBe('');});
 test('official return figures and dates; ignore benchmark',()=>{expect(parsePerformance(annual).values.yr3).toBe(27.89);expect(parsePerformance(cumulative).values.yr1).toBe(43.17);expect(parsePerformance(annual).date).toBe('2026-08-31');});
 test('calendar 2025 is not trailing one year',()=>expect(parsePerformance({performanceSet:[{performanceCategoryType:'NAV',values:[{performanceTimePeriod:'2025',value:'99'}]}]}).values.yr1).toBeNull());
 test('US timestamp dates parsed correctly',()=>{expect(isoDate('8/31/2026 12:00:00 AM')).toBe('2026-08-31');expect(isoDate('2026-09-25T00:00:00Z')).toBe('2026-09-25');expect(isoDate('')).toBeNull();});
});
describe('pagination completeness',()=>{
 test('multiple pages until exact declared total',async()=>{const skips:number[]=[];const rows=await collectPages(async(skip,take)=>{skips.push(skip);return {rows:[0,1,2,3,4].slice(skip,skip+take),total:5};},2);expect(rows).toEqual([0,1,2,3,4]);expect(skips).toEqual([0,2,4]);});
 test('empty intermediate page fails instead of truncating',async()=>expect(collectPages(async()=>({rows:[],total:5}))).rejects.toThrow('Incomplete'));
 test('changing total fails',async()=>expect(collectPages(async(skip)=>({rows:[skip],total:skip?4:3}),1)).rejects.toThrow('Total changed'));
 test('empty actual dataset accepted by generic collector',async()=>expect(collectPages(async()=>({rows:[],total:0}))).resolves.toEqual([]));
});
describe('shared Yahoo / financial math / deterministic writers',()=>{
 test('round Yahoo adjusted close at parse time',()=>{const p=parseChart({chart:{result:[{timestamp:[1700000000],indicators:{quote:[{close:[40.123456789],volume:[10]}],adjclose:[{adjclose:[40.129991]}]},events:{dividends:{x:{date:1700000000,amount:0.5}}}}]}});expect(p.days[0].adjClose).toBe(40.13);expect(p.dividends.length).toBe(1);});
 test('zero CAGR produces zero cumulative rather than null',()=>expect(annualizedToTotal(0,3)).toBe(0));
 test('short history cannot invent three-year returns',()=>expect(priceReturns([{date:'2026-01-01',close:10,adjClose:10,volume:0},{date:'2026-09-25',close:11,adjClose:11,volume:0}],new Date('2026-09-25')).cagr3y).toBeNull());
 test('recursive timestamps and key order do not rewrite data',()=>{expect(samePublishedContent('{"source":{"generatedAt":"old","x":1},"catalogReadAt":"old"}',{catalogReadAt:'new',source:{x:1,generatedAt:'new'}})).toBe(true);expect(samePublishedContent('{"x":1}',{x:2})).toBe(false);});
 test('limited history merges instead of truncating past',()=>{expect(mergeHistory([{Date:'Jan 01 2020',Close:'10','Adj Close':'10',Volume:'0'}],[{date:'2026-09-25',close:11,adjClose:11,volume:1}]).length).toBe(2);});
 test('full-word frequency: Semi-annually is not monthly',()=>{expect(decodeDividendFrequency('Semi-annually')?.paymentsPerYear).toBe(2);expect(decodeDividendFrequency('Monthly')?.paymentsPerYear).toBe(12);expect(decodeDividendFrequency('')).toBeNull();});
 test('missing numbers stay null',()=>{expect(numberOrNull('')).toBeNull();expect(numberOrNull('0')).toBe(0);expect(normalizeNumberText('2.9E8')).toBe('290000000');});
});
describe('SEC sibling parser and series isolation',()=>{
 const xml='<edgarSubmission><genInfo><regName>abrdn Funds</regName><regCik>1413594</regCik><seriesName>abrdn Emerging Markets Dividend Active ETF</seriesName><seriesId>S000001</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSec><name>Example</name><cusip>123456789</cusip><pctVal>5</pctVal><valUSD>50</valUSD><balance>2</balance><assetCat>EC</assetCat></invstOrSec></edgarSubmission>';
 test('ticker map field order independent',()=>expect(parseFundTickerMap({fields:['symbol','classId','cik','seriesId'],data:[['AGEM','C1',1413594,'S000001']]}).get('AGEM')).toEqual({cik:'0001413594',seriesId:'S000001',classId:'C1'}));
 test('N-PORT extraction',()=>{const p=parseNport(xml);expect(p.holdings[0].Identifier).toBe('123456789');expect(p.netAssets).toBe(1000);});
 test('different series under same trust rejected',()=>{const p=parseNport(xml);expect(nportMatches(agem,p,{cik:'0001413594',seriesId:'S000002',classId:'C1'})).toBe(false);expect(nportMatches(agem,p)).toBe(true);expect(nportMatches({...agem,name:'Another Fund'},p)).toBe(false);});
});

// Isolated end-to-end fixture runner: real writer/main, mocked public transport,
// temporary API root. No network requests, no mutation of committed data.
test('offline pipeline: first publication, byte-identical rerun, outage retention, fresh filters and cursor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aberdeen-test-'));
 try{
  await mkdir(join(dir,'scripts'));await cp(new URL('update-data.ts',import.meta.url),join(dir,'scripts/update-data.ts'));
  const payloads={overview:{content:{overview:[overview.content.overview.find((f:any)=>f.id===agem.id)],resultCount:1}},prices:{content:{prices:[prices.content.prices.find((f:any)=>f.id===agem.id)],resultCount:1}},detail,key,annual,cumulative,holdings:{...holdings,totalResults:2}};
  await Bun.write(join(dir,'fixture.json'),JSON.stringify(payloads));
  await Bun.write(join(dir,'runner.ts'),`import {main} from './scripts/update-data';
const p=await Bun.file('./fixture.json').json();let fail=false;
globalThis.fetch=async(input,init)=>{const u=String(input); if(fail) return new Response('denied',{status:403});
let v;if(u.includes('/view-all-funds/'))return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{pageData:{fundDetailsData:p.detail}}}})+'</script>');
if(u.endsWith('/overview'))v=p.overview;else if(u.endsWith('/prices'))v=p.prices;else if(u.endsWith('fundDetailsKeyInformation'))v=p.key;else if(u.endsWith('fundDetailsCodes'))v={content:{isin:'US00384X3017'}};else if(u.endsWith('/annualized'))v=p.annual;else if(u.endsWith('/cumulative'))v=p.cumulative;else if(u.endsWith('/dailyHoldings'))v=p.holdings;else return new Response('',{status:404});return Response.json(v);};
const env={REQUEST_SLEEP:'0',MAX_RETRIES:'0',EDGAR_FALLBACK:'0',SKIP_YAHOO:'1'};
const hash=async()=>{const g=new Bun.Glob('api/**/*.json');const r={};for await(const f of g.scan('.'))r[f]=await Bun.file(f).text();return JSON.stringify(Object.entries(r).sort());};
await main(env);const first=await hash();await main(env);if(first!==await hash())throw Error('Not idempotent');
fail=true;await main(env);if(first!==await hash())throw Error('Outage changed published files');
fail=false;p.key.content.fund.fundSizeWithDate.value='500';await main({...env,AUM:'1000:'});if(first!==await hash())throw Error('Fresh filter did not preserve excluded fund');
await main({...env,MAX_FETCHES:'1'});const state=await Bun.file('api/aberdeen/update-state.json').json();if(state.cursor!=='AGEM')throw Error('Cursor incorrect');await main(env);if(await Bun.file('api/aberdeen/update-state.json').exists())throw Error('Full run did not reset cursor');`);
  const child=Bun.spawn([process.execPath,'runner.ts'],{cwd:dir,stdout:'pipe',stderr:'pipe'});
  const stdout=await new Response(child.stdout).text(),stderr=await new Response(child.stderr).text();
  expect({code:await child.exited,stderr:stderr.includes('Error:')?stderr:'',stdout:stdout.includes('NaN')?'NaN':''}).toEqual({code:0,stderr:'',stdout:''});
 }finally{await rm(dir,{recursive:true,force:true});}
},30000);

test('UI differs from pinned JPMorgan only by recorded string substitutions',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../.plans/ui-copy.json',import.meta.url),'utf8'));
 for(const [name,spec] of Object.entries(manifest.files) as [string,any][]){
  let text=await readFile(new URL('../'+name,import.meta.url),'utf8');
  for(const [before,after] of spec.substitutions.toReversed())text=text.replaceAll(after,before);
  expect(new Bun.CryptoHasher('sha256').update(text).digest('hex')).toBe(spec.referenceSha256);
 }
});
