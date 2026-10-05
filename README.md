# abrdn

One of the app's features lets you select abrdn ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/aberdeen` static feed (official Aberdeen Investments catalog, NAV, expenses, yields, portfolio holdings and month-/quarter-end NAV performance; SEC EDGAR N-PORT-P holdings fallback; Yahoo Finance market-price history and dividend fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/aberdeen#main ./12345 && cd $_
bun install
bun run serve
open http://localhost:1234
```

`bun run serve` starts the Parcel dev server and copies `api/` to `dist/api`. `bun run build` writes the production site to `./dist`; `bun run build-github-pages` builds it for the `/aberdeen/` path of GitHub Pages.

The application URL is <https://daggerok.github.io/aberdeen/>.

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser. `Sticky #` (next to `Filters`, off by default, remembered in the browser) numbers the rows by their rank in the table sorted by the current column before the column filters, so a filtered fund keeps its rank and the numbers keep gaps; the sort, the search and the category and blacklist choices rank again. The catalog starts sorted by Net Assets, largest first, unavailable values sort last in both directions, and every export starts with the `#` column. The red `Clear` button forgets everything saved in the browser without asking, except the blacklist and the theme, so the page looks like a first visit (also after a reload)

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

The asset classes are one `Asset classes` multi-select next to the `All ETFs` pill instead of one tab per class: every class is selected by default (= all ETFs), `Only` or unchecking narrows the table, and the `All ETFs` pill is lit only while nothing narrows it (all or none of the classes checked); clicking the pill clears the selection. The choice is remembered in the browser (localStorage, never the data)

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
| Last resort | Existing committed `meta.json`, holdings and history pages. When any source of a fund fails, that fund is kept exactly as published (see below); a skipped provider (`SKIP_ABERDEEN`, `SKIP_YAHOO`) reads its part from the published files. |

### Metrics and caveats

The generated snapshot verified on 2026-09-27 contains **11 ETFs, 328 securities positions, and 27,067 daily history rows**. Source as-of dates remain attached to each fund and each series.

Each fund carries the same derived `metrics` object as the sibling sites:

- `ytd` / `tr1y` — official returns when published; gaps derived from Yahoo adjusted closes at the same reporting date.
- `cagr3y` / `cagr5y` / `cagr10y` — official annualized NAV returns first.
- `tr3y` / `tr5y` / `tr10y` — `(1 + CAGR)^n - 1`; a real zero stays zero.
- `siAnn` — official annualized since-inception return, or adequately covered Yahoo history; `null` for a fund under one year old at the as-of date, and range-limited history is not called since-inception.
- `dividendYield` — trailing 12 months: distributions with an ex-date in the 12 months up to the price date ÷ market price (computed from the Yahoo dividend events, not an official figure). `null` when the fund has under 12 months of history or paid nothing in the window; a single lumpy distribution is never annualized.
- `dividendYieldBasis` — short code for the definition behind `dividendYield`, `null` exactly when the yield is `null`. A kept or not-refreshed row published before the code existed gets it from its own yield, so every row carries the key:

  | Code | Meaning for abrdn |
  | --- | --- |
  | `computed-trailing-12m` | the updater sums the distributions of the last 12 months (Yahoo dividend events) over the market price; the only source here, abrdn publishes no distribution yield in its payloads |
  | `null` | no yield (fund under 12 months of history or no distributions) |
  | `official-trailing-12m`, `official-distribution-rate`, `official-other`, `indicated` | standard codes that abrdn never produces |
- `secYield` — official subsidized 30-day SEC yield when the fund publishes one, otherwise `null`; a published value is never carried over once the source answers without one.
- `returnsBasis` - mandatory non-empty label of how the returns were computed: official abrdn NAV performance (gaps derived from Yahoo adjusted closes at the same reporting date), or Yahoo adjusted market-price returns that are not official NAV; never empty or `-`
- `performanceAsOf` - mandatory ISO date (`YYYY-MM-DD`) the returns are as of: the date of the abrdn performance table (month-end), or the last Yahoo close date when derived; it is not the NAV date, and `null` only when truly unknown

Unavailable values stay null and are never shown as zero; only a published zero is zero.

**Expense ratio:** `terValue` (and the `TER` filter) is the **net** expense ratio after waivers, or the single figure when only one is published; `terGrossValue` is the gross (total) expense ratio. The text fields `ter` and `terGross` sit next to them, and `meta.json` carries `expenseRatio.value`, `gross` and `net`.

**Fund-level consistency:** a fund is either fully updated or fully kept as published. It is computed in memory from the catalog, detail page, key information, performance, holdings (official or SEC) and Yahoo history; if any of these sources fails (HTTP error, timeout, malformed answer) the fund's files and index row stay byte-for-byte as published and the run prints `kept`. The workflow commits after a partial run, which is safe because no fund is ever half-updated. A new fund whose source fails is not published until a later run. An honest empty answer from a source that responded is a `null`, not a reason to keep an old value, and returns travel with their own `performanceAsOf` and `returnsBasis` (an old Yahoo-derived block never stands in for the official table). Premium/discount is computed only when the NAV and price dates match, otherwise `null`. A SEC N-PORT filing replaces published holdings only when its report date is newer.

**Exit code:** non-zero when any fund fails, or when every examined fund was kept because a source failed. A run stops taking new funds after 25 minutes (the workflow limit is 30) and still writes the index; the remaining funds keep their published data and the cursor does not move.

**New funds:** tickers in the catalog that the previous index did not list are printed as `NEW FUNDS: A, B` and appended to the Actions step summary.

**Known limitations**

- **Physical trusts:** GLTR, PALL, PPLT, SGOL and SIVR do not expose a securities-holdings tab in the verified API. They remain in the catalog with facts/performance/history, but their securities portfolio is marked `not-applicable`; no synthetic bullion rows or invented tickers are generated. Physical bar lists are not converted into securities positions.
- **SEC live access:** this environment returned HTTP 403 for SEC lookup/submissions endpoints. The fallback is implemented and unit-tested, including wrong-series rejection, but live SEC retrieval has not been validated here. Official holdings supply all six securities ETFs in the initial snapshot; no third-party holdings scraper was needed. If every holdings source fails, the fund is kept as published (see fund-level consistency).
- **History/distributions:** a usable official daily NAV-history/dividend-series endpoint was not found during this implementation. Yahoo market-price history and distributions fill that role. Official cumulative growth charts and calendar-year returns are not misrepresented as daily NAV or trailing one-year returns.
- **Dates and inception:** a converted ETF can publish its predecessor fund's inception and historical NAV returns. These official dates are preserved rather than replaced by its first Yahoo trading day. NAV and market-price dates can differ; premium/discount is not computed across unmatched dates.
- **Network/CI:** provider schemas, throttling and CDN availability can change. Conservative request pacing applies, every request has a 45 s timeout covering headers and body, and it is retried per `MAX_RETRIES`. Tests are offline; a passing test suite does not imply every live provider is reachable.
- **Client dependencies:** like the sibling UI, the browser app is a static Parcel build (Tailwind v4 compiled at build time), so it needs no CDN except the Google Fonts stylesheet. No server backend is required for the app.

### Update controls

Precedence: `scripts/update-data.config.json` defaults < Actions `advanced` JSON < nonblank individual inputs < protected Actions variable or environment. The same `resolveControls` runs locally and in Actions. Locally, environment variables override the file and `ABERDEEN_<NAME>` overrides the unprefixed name. The legacy aliases `ABERDEEN_LIMIT` (`MAX_FETCHES`) and `HISTORICAL_PAGE_SIZE` / `ABERDEEN_HISTORICAL_PAGE_SIZE` (`HISTORY_PAGE_SIZE`) are resolved by the same resolver, so they work in the CLI and in Actions.

Actions exposes 24 individual inputs plus `advanced`, respecting GitHub's 25-input limit. `SEC_UA`, `VERBOSE`, `USE_SYSTEM_CA`, `STORE_RAW_DOWNLOADS` and `SKIP_ABERDEEN` are available through `advanced` and the config file. Unknown keys, invalid ranges, non-scalar values and newline injection are rejected before any request. No credentials belong in the config file.

`SEC_UA` can be supplied by the protected repository Actions variable `SEC_UA`; when nonblank it wins over every other layer and is never printed or exposed as an input. The config default is the owner's feed User-Agent.

Blank individual inputs mean **inherit**, not clear. To clear a file's ticker restriction in Actions, use `{"TICKERS":""}` in `advanced`.

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size; positive resumes cursor, 0 refreshes the selected universe and resets cursor. |
| `REQUEST_SLEEP` | `1` | Seconds between request starts including retries, paced per worker lane (no shared gate). |
| `CONCURRENCY` | `2` | Parallel fund workers, each with its own request lane; throughput scales about N times. |
| `AUM` | `:` | Net assets min:max in USD; K/M/B/T or nano/micro/small/mid/large preset. |
| `TER` | `:` | Net expense ratio percent min:max (the single published figure when there is no separate net). |
| `DIVIDEND_YIELD` | `:` | Trailing 12-month dividend yield percent min:max; funds without one (null) are excluded. |
| `SEC_YIELD` | `:` | 30-day SEC yield percent min:max. |
| `TICKERS` | empty (all) | Ticker allowlist separated by spaces, commas or semicolons; empty means all. A ticker that is not in the catalog is an error. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows per holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows per market-price history JSON page. |
| `MAX_RETRIES` | `2` | Retries after the first request; at least 1. |
| `HISTORY_RANGE` | `max` | Yahoo daily history range: max or Ny (e.g. 5y). Ny sends an explicit `period1` N years back, so the request really shrinks; prior history is merged, not dropped. |
| `STORE_RAW_DOWNLOADS` | `false` | Save source JSON under api/aberdeen/raw. |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent (redacted in config logs); the protected `SEC_UA` variable or env overrides it. |
| `SKIP_YAHOO` | `false` | Skip Yahoo history and dividends; retain published data. |
| `SKIP_ABERDEEN` | `false` | Use published catalog/details; only fallback providers are called. |
| `EDGAR_FALLBACK` | `true` | Enable SEC N-PORT holdings fallback; never use an unrelated series. |
| `VERBOSE` | `false` | Print per-request failures and fallback diagnostics. |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
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

`TICKERS` combines with all other filters. Excluded and failed funds keep their previous published files and index entries, so a filtered run never shrinks the feed. A bounded batch (`MAX_FETCHES=N`) counts only funds that pass the filters: it keeps taking funds in cursor order, wrapping around, until N of them were updated, and does not advance its cursor if the batch has failures. A successful full pass removes the cursor. A `TICKERS` run never reads, moves or deletes the cursor.

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

The browser app is built by Parcel: `src/index.html` carries the markup and bootstrap, `src/main.tsx` is the TypeScript source, `src/index.css` holds Tailwind v4 and the component styles, and `dist/` is the build output deployed by `.github/workflows/github-pages.yml` (Pages source: GitHub Actions). No `tsconfig.json` is needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` (`scripts/update-data.test.ts`) also covers the config file, `--help`, README controls and workflow checks. These do **not** perform semantic TypeScript checking. Do not add `tsc`, a TypeScript dependency or a `tsconfig.json`.

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
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
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
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
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
