# Заголовок и подсказка счётчика: точная поправка к планам

Уже применено в `.plans/00-generic.txt` и `.plans/02-aberdeen.txt`.
Для остальных планов найдите пункт 8 в **THE #1 RULE**, затем выполните замену ниже.
Явное исключение имеет приоритет над старым запретом любых иных UI-изменений.

## Найти

```text
  8. The SEC EDGAR Trust name / CIK / provider name baked into user-facing
     copy (point 5's "<Trust name>, CIK <number>").
```

## Заменить на

```text
  8. The SEC EDGAR Trust name / CIK / provider name baked into user-facing
     copy (point 5's "<Trust name>, CIK <number>").

MANDATORY SHARED HEADER RULE — explicit user-approved exception to the
copy-verbatim restrictions below; apply this identically to every ETF brand:
- Keep the brand title and the existing count badge next to the theme button.
- Move the entire former detailed subtitle (instructions/context, update time,
  ETF/holdings/history counts, Data/API link, provider links and fallback/source
  attribution) into a hidden rich panel attached to that count badge. Preserve
  the real links and all per-view messages; do not flatten them into title text.
- Show the panel on mouse hover and keyboard focus. Allow pointer movement into
  it and link interaction; provide touch/click access, Escape dismissal and
  viewport-safe positioning in light/dark themes. No always-visible detail line.
- With no selection, the visible subtitle is empty (no "0 selected" or help).
  Otherwise show ONLY "N selected: TICKER1, TICKER2", sorted alphabetically,
  with clickable bold ticker links and the active ticker highlighted. Apply
  this even when all ETFs are selected. Clicks must not deselect the fund.
- Preserve existing renderer/context and selection/tab/search/export/blacklist
  behavior. Handle every path: zero/some/all, clear/deselect/blacklist, restored
  selection, per-fund progress and uploaded-file mode where supported.
- Record exact UI parity substitutions in the active manifest or its canonical
  .worklog.txt archive. Add regression tests and browser checks for selection,
  retained source links, hover-to-panel, keyboard/Escape, touch and narrow screens.
- This is a header-presentation exception only: do not alter financial data,
  updater behavior, table layout or unrelated interactions.
```
