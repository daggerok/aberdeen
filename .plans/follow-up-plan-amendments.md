# Точные поправки для текущих и будущих ETF-планов

Эти изменения уже применены в `.plans/00-generic.txt` и `.plans/02-aberdeen.txt`.
Для других brand-specific планов примените те же четыре замены в общей части.
Номера строк после предыдущих вставок могут отличаться — используйте заголовки
разделов и приведённый точный старый текст. Исходные uploads не изменялись.

Bun-only ограничение сохранено: не добавлены tsc, TypeScript dependency или
новый tsconfig. Проверка типов не подменяется успешной Bun-транспиляцией.

## Раздел 5 — unit tests и type-safety review

Найти:

```text
Test the PURE functions (parsers, metric derivation, frequency/yield
calculations, page/manifest builders) with literal fixture input — do not
make real network calls in tests. Include at least one "matches figures
verified on the live site as of <date>" style assertion against a real,
manually-checked fund if you can, matching the pattern in
daggerok/Neos scripts/update-data.test.ts or daggerok/VanEck's (both of
these currently have one pre-existing, known, unrelated failing assertion
of exactly this kind — that's fine, it's a live-data-drifted assertion,
not a sign the pattern is wrong).
```

Заменить на:

```text
Test the PURE functions (parsers, metric derivation, frequency/yield
calculations, page/manifest builders) with literal fixture input — do not
make real network calls in unit tests. Record a baseline before changes.
Include dated, manually checked source fixtures where possible. Record any
pre-existing failure and compare it before/after; do not assume a sibling's
old failure still exists or change unrelated financial data to silence it.

Mandatory type-safety review (Bun build is NOT a semantic type checker):
- For indexed numeric assignments into a mixed-type object, restrict the key
  to numeric fields. Never return broad keyof Row when Row also contains
  string dates/names. For OfficialReturnRow whose only nonnumeric member is
  asOfDate, use Exclude<keyof OfficialReturnRow, 'asOfDate'> | null for the
  header-to-slot mapper. If the schema differs, derive an explicit numeric-key
  union for that schema; do not blindly assume excluding one field is enough.
- Test every mapped tenor, reordered headers, zero, negative, missing/null
  cells, unknown headers and preservation of string metadata. Do not use any,
  type assertions, index-signature widening or ts-ignore to hide TS2322.
- A generic Promise<T> cannot be stored as Promise<void> merely by adding
  catch(() => undefined). Normalize both outcomes with
  work.then(() => undefined, () => undefined), while returning original work
  to preserve its value/rejection for the caller. Test queue ordering/recovery.
- Review the actual types and available IDE diagnostics. Be explicit about
  checks performed: tests/transpilation do not prove absence of all TS errors.
  Keep the Bun-only policy: no tsc, tsconfig.json or TypeScript dependency.
- Run the separate real-network acceptance smoke in section 12. Offline mocks
  and fixture tests NEVER replace that mandatory scoped live run.
```

## Раздел 10 — README.md: заменить текст раздела

Найти:

```text
Copy the structure verbatim from any sibling (it's the literal same
template in all 14, only the brand-specific paragraphs differ): Using
Bun, Data sources (list every source you actually use + every fallback,
be exact, this is the one section that must be brand-true), Update
controls (one line per env var, matching the workflow_dispatch inputs and
the config header), Examples, TypeScript, Known limitations (if any),
Brands table (all 14 + this new one, alphabetical, same row format),
Sibling applications (same list, repo-name links only), trademark/
non-affiliation notice, License.
When you add a brand, you must also add its row to the Brands table AND
Sibling applications section in ALL OTHER 14 (+ any other brands already
added under .plans) sibling READMEs — that's the one piece of this task
that touches other repos, do it as one small doc-only PR per repo.

```

Заменить на:

```text
Pin one real sibling README as the reference before editing (default:
daggerok/JPMorgan on its current default branch). Record repo + commit SHA in
.worklog.txt. Copy the common text, title format "# <Brand>", heading hierarchy
and order, intro structure, Using Bun commands and TypeScript wording; do not
rewrite generic feature descriptions or invent a new presentation template.

Substitute only the brand/repository/API paths and truthful implementation-
specific facts: actual data sources and fallbacks, controls/defaults, examples,
source limitations and deployment status. Keep material caveats; place source-
specific detail inside the corresponding existing section, not in new generic
marketing sections. Never claim that Pages is already live when it is pending.

Expected common structure: Using Bun; Updating the static <Brand> data with
Data sources, Update controls and Examples; TypeScript; Brands table;
Sibling applications; trademark/non-affiliation notice; License.
Preserve optional source-specific subsections only when they serve actual facts.
Brands and siblings tables contain all existing brands plus this one, sorted
alphabetically and using the existing row/link formats. Do not shorten them.

Before publication, compare common headings/intro/commands against the pinned
README after permitted substitutions; ignore fenced code when parsing headings.
Add an offline regression guard for the common structure and record the diff.
Check that every documented control/example exists in the implementation.
When adding a new brand's row to other README tables, use separate doc-only PRs
and only within the user's explicit cross-repository authorization. This rule
does not grant permission to rewrite existing sibling READMEs.
```

## Раздел 11 — GitHub metadata: заменить текст раздела

Найти:

```text
Set via `gh repo edit daggerok/<Repo> --description "..." --add-topic ...`.
Standard topic set every sibling carries (add these, plus the brand name
lowercase and "<brand>-etfs"):
  css csv dark-mode edgar etf finance github-pages holdings html json
  nport single-file static-api tailwindcss txt typescript watchlist
  yahoo-finance
Description pattern (see daggerok/JPMorgan or daggerok/ProShares for the
exact wording style): "<Brand> ETF holdings to Watchlist. A single-file
client-side tool reading the generated ./api/<brand> static feed (<list
of real sources>) into a searchable ETF/asset-class catalog with per-fund
tabs, watchlist, CSV/TXT export. TailwindCSS, dark mode, Bun updater"

```

Заменить на:

```text
Read the current About description/homepage/topics of the same pinned sibling
family before editing. Use this exact shared description pattern; substitute
only the brand, actual API directory and truthful source list:
"<Brand> ETF. A single-file client-side tool reading ./api/<brand> (<actual
sources and fallbacks>) into a searchable ETF/asset-class catalog with per-fund
tabs, watchlist, CSV/TXT export. TailwindCSS, dark mode, Bun updater."
Do NOT use the obsolete "ETF holdings to Watchlist" introduction or invent a
different generic sentence. Respect GitHub's description length limit.

Set homepage to https://daggerok.github.io/<Repo>/ using the repository's exact
case. This sets a URL, not a successful deployment: verify Pages separately and
report pending deployment honestly. Standard shared topics:
  css csv dark-mode edgar etf finance github-pages holdings html json
  nport single-file static-api tailwindcss txt typescript watchlist
  yahoo-finance
Use these plus the two consistent brand topics (<brand> and <brand>-etfs).
Preserve an already-correct brand alias rather than inventing extra tags.

Apply through gh repo edit or the GitHub REST API, then GET the repository to
verify description, homepage and topics exactly. Record before/after values in
.worklog.txt. Change metadata only in repositories explicitly authorized.
GitHub's language indicator is computed from default-branch contents, not an
About field. Do not fake it with Linguist overrides, change the default branch,
or merge an otherwise unapproved PR just to make the badge appear.
```

## Раздел 12 — ORDER OF WORK: заменить пункты 2–5

Найти:

```text
 2. Write scripts/update-data.ts against a small TICKERS= subset first
    (do NOT run a full unbounded pass while developing).
 3. Write scripts/update-data.test.ts alongside it.
 4. `bun test`, `bun build --target=bun scripts/update-data.ts
    --outfile=/dev/null` (sanity bundling check), then a real scoped dry
    run (`TICKERS="..." REQUEST_SLEEP=0 bun scripts/update-data.ts`).
 5. Run it TWICE in a row on the same tickers and diff the output —
    confirm byte-identical files (proves section 4E/D idempotency is
    correct) before moving on.
```

Заменить на:

```text
 2. Implement against an explicit small TICKERS subset first, never a full
    unbounded discovery run. Pick at least THREE valid tickers representing
    different supported paths (e.g. equity, fixed income, physical trust).
    If the brand has fewer than three funds, test all and record that fact.
 3. Write offline parser/metrics/filter/pagination tests alongside the updater.
 4. Run `bun test` and `bun build --target=bun scripts/update-data.ts
    --outfile=/dev/null`; apply section 5's type-safety review. Transpilation
    success is NOT semantic TypeScript validation or live-provider validation.
 5. MANDATORY LIVE ACCEPTANCE, before claiming implementation complete:
    - Create an isolated working copy with the real updater/config and the
      published API seed. A real run writes files; it is NOT a dry-run mode.
    - Run the actual CLI, replacing these placeholders with chosen real funds:
      TICKERS="TICKER1 TICKER2 TICKER3" VERBOSE=1 bun scripts/update-data.ts
      Use the normal conservative REQUEST_SLEEP and retries. Do not set sleep
      to zero by default, mock fetch, or enable SKIP-provider flags for this
      acceptance run. Verify effective TICKERS/MAX_FETCHES/filter settings.
    - Record command, revision, effective config, timestamp, exit code, logs,
      processed/skipped/failed tickers and per-fund holdings/history counts in
      .worklog.txt plus tracked evidence. A command example is not execution.
    - Verify ALL requested tickers were actually selected and processed; no
      unrequested fund files/index entries were modified, and existing funds
      were not dropped from the catalog. Check manifests/page counts and the
      generated values/provenance for the selected funds.
    - Run the SAME command a second time. Compare before/after file hashes.
      Stable inputs must produce byte-identical output with no timestamp-only
      churn. Real upstream changes must be identified and documented, not
      hidden or forced back to old values to manufacture a clean diff.
    - Record provider warnings/fallbacks honestly. Exit 0 with retained cached
      data is not proof every provider was freshly fetched. If live access is
      blocked, record exactly what was/was not validated; do not label an
      offline fixture replay as a successful live run.
    - Keep smoke outputs isolated from production api/ unless publication of
      refreshed data is separately in scope. Test failure/retention and more
      edge cases offline; do not induce disruptive live failures.
    - Commit/push the evidence and .worklog.txt checkpoint before proceeding.
```

