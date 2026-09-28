# Live verification — 2026-09-27

These are research fixtures, **not** a generated/published `api/aberdeen` feed.
No updater, UI, tests, CI, or idempotency verification is complete yet.

## Official source requests

Base: `https://www.aberdeeninvestments.com/api/gateway/funds/`

POST `overview` and `prices`, HTTP 200, with this body (set `tab` to the endpoint):

```json
{
  "countryInvestors": {"countryCode":"USA","investorType":"1,4","jurisdiction":"Live","literatureAuthorization":"1"},
  "language":"en-US",
  "site":"Investor",
  "searchQuery":{"id":"","name":""},
  "filters":[{"name":"fund_product_type","values":["Exchange Traded Fund"]}],
  "skip":0,
  "take":20,
  "tab":"prices"
}
```

Headers: `Content-Type: application/json`, `User-Agent: Mozilla/5.0`,
`Origin: https://www.aberdeeninvestments.com`, official catalogue Referer.
**Omitting `date` returns current published NAVs and their actual dates.**

Catalogue source:
https://www.aberdeeninvestments.com/en-us/investor/funds/view-all-funds?table=prices&fund_product_type=Exchange%20Traded%20Fund

Fund pages:
- https://www.aberdeeninvestments.com/en-us/investor/funds/view-all-funds/abrdn-emerging-markets-dividend-active-etf-us00384x3017
- https://www.aberdeeninvestments.com/en-us/investor/funds/view-all-funds/abrdn-physical-gold-shares-etf-us00326a1043

`*-fund-details.json` contains only the extracted
`__NEXT_DATA__.props.pageProps.pageData.fundDetailsData` object.
`*-key-information.json` is the raw `fundDetailsKeyInformation` response.

The per-fund POST body uses official catalogue/detail values for `shareClass`,
`fund`, `assetClassId`, `correlationFundRangeId`, `fundRangeName`, `fundName`,
`fundNameId`, `shareClassNameId`, plus `countryCode: USA`, `language: en-US`,
`site: Investor`, `literatureAuthorizations: ["1"]`,
`sfdrClassificationId: N/A`, and
`countryInvestors: {countryCode: USA, investorType: "1,4", jurisdiction: Live}`.

For `breakdown/dailyHoldings`, add
`{topHoldings: false, holdingType: 2, take: 2, skip: 0}`.
AGEM's fixture is **only two rows out of 95**, not a complete portfolio.
SGOL's same endpoint returned HTTP 200 with a zero-byte response;
its detail configuration has `holdingsTab.tab=false`. Do not parse the empty
body as a successful empty portfolio or invent a bullion position.

## SEC access blocker

All five direct requests returned HTTP 403 from this execution environment:

- https://www.sec.gov/files/company_tickers_mf.json
- https://www.sec.gov/files/company_tickers.json
- https://data.sec.gov/submissions/CIK0001597934.json
- https://data.sec.gov/submissions/CIK0001413594.json
- https://data.sec.gov/submissions/CIK0001450923.json

The request identified the project using
`User-Agent: daggerok ETF research (https://github.com/daggerok/aberdeen)`.
No fictional email address was used. No N-PORT XML was obtained or validated.
Do not claim that SEC fallback works based on these requests.

Public search results associate AGEM/AFSC with abrdn Funds in the CIK 1413594
archive [1](https://www.sec.gov/Archives/edgar/data/1413594/000110465924112193/tm2423635d8_485bpos.htm).
An abrdn Funds report in that archive also names ASCI/AMUN
[1](https://www.sec.gov/Archives/edgar/data/1413594/000110465926082281/tm2619092d1_ncsrs.htm).
These search results are **not** a substitute for validating per-series
N-PORT resolution. They do not validate every ticker's SEC series mapping.

## Continuation

Read `../../.plans/02-aberdeen.txt` completely and `../../plan.txt` before
resuming. The live-verification stage is incomplete. SEC live access and
per-series resolution are unresolved; history/distributions investigation
also remains. No implementation or live fallback success is implied.
