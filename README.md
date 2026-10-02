# abrdn

One of the app's features lets you select abrdn ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/aberdeen` static feed (official Aberdeen Investments catalog, NAV, expenses, yields, portfolio holdings and month-/quarter-end NAV performance; SEC EDGAR N-PORT-P holdings fallback; Yahoo Finance market-price history and dividend fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/aberdeen#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The application URL is <https://daggerok.github.io/aberdeen/>.

## Updating the static abrdn data

Run the updater with Bun:

```bash
bun test
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print the effective configuration and usage examples. The updater has **no runtime dependencies**.

Defaults live next to the updater in [`scripts/update-data.config.json`](./scripts/update-data.config.json) (every control as a string). Precedence: file defaults < `advanced` JSON < nonblank inputs < protected Actions variable or environment. With no overrides the updater refreshes the entire discovered US ETF catalog (`MAX_FETCHES=0`, `TICKERS=""`), keeps published data when a provider fails, and writes only meaningful changes. It does not skip fetching a fund merely because yesterday's data exists. Unchanged reruns do not create timestamp-only diffs.

The **Update abrdn ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic. It runs Sundays at **00:00 UTC** and on manual dispatch, with no push trigger. It writes only `api/aberdeen`.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US abrdn ETFs), official NAV | POST `https://www.aberdeeninvestments.com/api/gateway/funds/overview` and `/prices`, with `fund_product_type=Exchange Traded Fund`, pagination, and no date override. The public entry points are the [ETF page](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) and [fund finder](https://www.aberdeeninvestments.com/en-us/investor/funds/view-all-funds?table=prices&fund_product_type=Exchange%20Traded%20Fund). |
| Per-fund facts and exchange price | Official fund page `__NEXT_DATA__.props.pageProps.pageData.fundDetailsData`, plus POST `/api/gateway/funds/fundDetailsKeyInformation` and `/fundDetailsCodes`. Example: [AGEM](https://www.aberdeeninvestments.com/en-us/investor/funds/view-all-funds/abrdn-emerging-markets-dividend-active-etf-us00384x3017). |
| Full securities holdings | POST `/api/gateway/funds/breakdown/dailyHoldings` with the holding type enabled in the fund's own detail configuration, all pages through `totalResults`. The official `/breakdown/dailyHoldingsSheet` XLSX download was independently verified; the updater uses its structured JSON counterpart. Top-ten lists are never substituted for full holdings. |
| NAV total returns | POST `/api/gateway/funds/performance/annualized` and `/performance/cumulative`, `quarterly=false` for month-end, `quarterly=true` for quarter-end. Use the NAV category, not benchmark or market-price returns. Reporting dates come from the response, even if stale. |
| Market-price history and dividends | Yahoo Finance public chart API `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}` with daily bars and dividend events. Adjusted close is rounded to 2 decimals. These are **not official NAV history rows** (market-price estimates). |
| Holdings fallback | SEC fund-ticker/series map, series Atom feed, registrant submissions/full-text discovery, and N-PORT-P XML. Shared parsers follow JPMorgan; each filing must match the requested series (or exact normalized fund name). abrdn Funds filings associate AGEM/AFSC/ASCI/AMUN with CIK 0001413594 ([1](https://www.sec.gov/Archives/edgar/data/1413594/000110465924112193/tm2423635d8_485bpos.htm), [1](https://www.sec.gov/Archives/edgar/data/1413594/000110465926082281/tm2619092d1_ncsrs.htm)); other mappings are discovered from SEC, not guessed. |
| Last resort | Existing committed `meta.json`, holdings and history pages. An unavailable endpoint must not erase published data. |

### Metrics and caveats

The generated snapshot verified on 2026-09-27 contains **11 ETFs, 328 securities positions, and 27,067 daily history rows**. Source as-of dates remain attached to each fund and each series.

Each fund carries the same derived `metrics` object as the sibling sites:

- `ytd` / `tr1y` — official returns when published; gaps derived from Yahoo adjusted closes at the same reporting date.
- `cagr3y` / `cagr5y` / `cagr10y` — official annualized NAV returns first.
- `tr3y` / `tr5y` / `tr10y` — `(1 + CAGR)^n - 1`; a real zero stays zero.
- `siAnn` — official annualized since-inception return, or adequately covered Yahoo history; range-limited history is not called since-inception.
- `dividendYield` — indicated latest distribution × annual payment frequency ÷ market price (an estimate from the market price, not an official figure).
- `secYield` — official subsidized 30-day SEC yield when available; otherwise previously published value or null.

Unavailable values stay null and are never shown as zero; only a published zero is zero.

**Known limitations**

- **Physical trusts:** GLTR, PALL, PPLT, SGOL and SIVR do not expose a securities-holdings tab in the verified API. They remain in the catalog with facts/performance/history, but their securities portfolio is marked `not-applicable`; no synthetic bullion rows or invented tickers are generated. Physical bar lists are not converted into securities positions.
- **SEC live access:** this environment returned HTTP 403 for SEC lookup/submissions endpoints. The fallback is implemented and unit-tested, including wrong-series rejection, but live SEC retrieval has not been validated here. Official holdings supply all six securities ETFs in the initial snapshot; no third-party holdings scraper was needed. If all holdings sources fail, published holdings are kept.
- **History/distributions:** a usable official daily NAV-history/dividend-series endpoint was not found during this implementation. Yahoo market-price history and distributions fill that role. Official cumulative growth charts and calendar-year returns are not misrepresented as daily NAV or trailing one-year returns.
- **Dates and inception:** a converted ETF can publish its predecessor fund's inception and historical NAV returns. These official dates are preserved rather than replaced by its first Yahoo trading day. NAV and market-price dates can differ; premium/discount is not computed across unmatched dates.
- **Network/CI:** provider schemas, throttling and CDN availability can change. Conservative request pacing and bounded retries apply. Tests are offline; a passing test suite does not imply every live provider is reachable.
- **Client dependencies:** like the sibling UI, the browser loads Tailwind/Babel from CDNs and needs network access for them. No server backend or runtime package installation is required for the app.

### Update controls

Precedence: `scripts/update-data.config.json` defaults < Actions `advanced` JSON < nonblank individual inputs < protected Actions variable or environment. The same `resolveControls` runs locally and in Actions. Locally, environment variables override the file and `ABERDEEN_<NAME>` overrides the unprefixed name.

Actions exposes 24 individual inputs plus `advanced`, respecting GitHub's 25-input limit. `SEC_UA`, `VERBOSE`, `STORE_RAW_DOWNLOADS` and `SKIP_ABERDEEN` are available through `advanced` and the config file. Unknown keys, invalid ranges, non-scalar values and newline injection are rejected before any request. No credentials belong in the config file.

`SEC_UA` can be supplied by the protected repository Actions variable `SEC_UA`; when nonblank it wins over every other layer and is never printed or exposed as an input. The config default is the owner's feed User-Agent.

Blank individual inputs mean **inherit**, not clear. To clear a file's ticker restriction in Actions, use `{"TICKERS":""}` in `advanced`.

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size; positive resumes cursor, 0 refreshes the selected universe and resets cursor. |
| `REQUEST_SLEEP` | `1` | Seconds between request starts including retries; conservative shared gate. |
| `CONCURRENCY` | `2` | Parallel fund workers; request starts remain conservatively paced. |
| `AUM` | `:` | Net assets min:max in USD; K/M/B/T or nano/micro/small/mid/large preset. |
| `TER` | `:` | Gross expense ratio percent min:max. |
| `DIVIDEND_YIELD` | `:` | Indicated dividend yield percent min:max. |
| `SEC_YIELD` | `:` | 30-day SEC yield percent min:max. |
| `TICKERS` | empty (all) | Ticker allowlist separated by spaces, commas or semicolons; empty means all. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows per holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows per market-price history JSON page. |
| `MAX_RETRIES` | `2` | Retries after the first request; at least 1. |
| `HISTORY_RANGE` | `max` | Yahoo daily history range: max or Ny (e.g. 5y); preserves prior history. |
| `STORE_RAW_DOWNLOADS` | `false` | Save source JSON under api/aberdeen/raw. |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent (redacted in config logs); the protected `SEC_UA` variable or env overrides it. |
| `SKIP_YAHOO` | `false` | Skip Yahoo history and dividends; retain published data. |
| `SKIP_ABERDEEN` | `false` | Use published catalog/details; only fallback providers are called. |
| `EDGAR_FALLBACK` | `true` | Enable SEC N-PORT holdings fallback; never use an unrelated series. |
| `VERBOSE` | `false` | Print per-request failures and fallback diagnostics. |
| `PERFORMANCE_YTD` | `:` | Annualized YTD return percent min:max. |
| `PERFORMANCE_1Y` | `:` | Annualized 1Y return percent min:max. |
| `PERFORMANCE_3Y` | `:` | Annualized 3Y return percent min:max. |
| `PERFORMANCE_5Y` | `:` | Annualized 5Y return percent min:max. |
| `PERFORMANCE_10Y` | `:` | Annualized 10Y return percent min:max. |
| `TOTAL_RETURN_YTD` | `:` | Cumulative YTD return percent min:max. |
| `TOTAL_RETURN_1Y` | `:` | Cumulative 1Y return percent min:max. |
| `TOTAL_RETURN_3Y` | `:` | Cumulative 3Y return percent min:max. |
| `TOTAL_RETURN_5Y` | `:` | Cumulative 5Y return percent min:max. |
| `TOTAL_RETURN_10Y` | `:` | Cumulative 10Y return percent min:max. |

`TICKERS` combines with all other filters. Excluded and failed funds keep their previous published files and index entries. A bounded batch counts selected funds, follows deterministic ticker order, and does not advance its cursor if the batch has failures. A successful full pass removes the cursor.

### Examples

```bash
# Entire catalog, using committed defaults
bun scripts/update-data.ts

# Primary runtime controls
TICKERS="AGEM AMUN SGOL" CONCURRENCY=2 bun scripts/update-data.ts
MAX_FETCHES=3 bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
STORE_RAW_DOWNLOADS=1 VERBOSE=1 bun scripts/update-data.ts
```

Manual Actions `advanced` example (leave individual inputs blank to inherit):

```json
{"CONCURRENCY":2,"TICKERS":"AGEM BCD SGOL","VERBOSE":true,"STORE_RAW_DOWNLOADS":false}
```

Override `SEC_UA` (environment or the protected Actions variable) to use a different identifying contact for SEC requests. A User-Agent change does not guarantee that an execution environment's HTTP 403 will disappear.

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone — no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` (`scripts/update-data.test.ts`) also covers the config file, `--help`, README controls and workflow checks. Optionally check the UI bundle with `bun build app.tsx --outfile=/dev/null`. These do **not** perform semantic TypeScript checking. Do not add `tsc`, a TypeScript dependency or a `tsconfig.json`.

The UI reference is **daggerok/JPMorgan @ c1ef7858f61689f3d20636d6c83711d41faa722e**.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) (deployment pending) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as the sibling ETF repositories.](./LICENSE)

abrdn®, Aberdeen and the fund names/tickers referenced here are trademarks of their respective owners. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by abrdn or Aberdeen Investments. Data is obtained from the official public fund site, public SEC filings when accessible, and Yahoo Finance for research purposes. All other trademarks, including index names, belong to their respective owners.
