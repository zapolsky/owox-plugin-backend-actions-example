# Metric Watch: periods and scheduled export

## Goal

A watch checks its metric by day, week, month or quarter, not only by week. Its schedule follows
the period, and a schedule can add each new check to a Google Doc or Sheet.

## Decisions

- The period is a property of the watch. To see ROAS by day and by month, a member creates two
  watches. The watch page has no period switch.
- Periods: day, week, month, quarter. No year: its usual range would need eight earlier years.
- Every period is compared with the period before it, and its usual range comes from the eight
  periods before it. A day is compared with the day before, not with the same weekday.
- A schedule with an export target adds every check it makes, alert or not.
- The page's "Check now" never exports. Only a schedule does.

## Periods

`Watch.granularity` is `day | week | month | quarter`. A watch saved without it is a `week` watch.

A check runs for `asOf`, the first day after the checked period, so a second run within the same
period overwrites the same check:

| Period | Checked period | `asOf` of a run on 20 Oct 2026 | Label |
| --- | --- | --- | --- |
| day | yesterday | 2026-10-20 | `19 Oct 2026` |
| week | the seven days before `asOf`, as now | 2026-10-20 | `13–19 Oct 2026` |
| month | the last full calendar month | 2026-10-01 | `Sep 2026` |
| quarter | the last full calendar quarter | 2026-10-01 | `Q3 2026` |

A week keeps today's rolling definition so that existing checks keep their ids; a scheduled run on
Monday covers Monday to Sunday.

`periodAt(granularity, asOf, k)` replaces `weekAt(asOf, k)`: the `k`-th period before `asOf`,
`{ from, to }`. `shiftPeriod(granularity, asOf, n)` moves `asOf` by `n` periods and replaces
`shiftDay(asOf, -7 * n)` where a run checks several periods. The `asOf` of a month or quarter is
always the 1st, so moving it by calendar months is exact.

## Analysis and data

- The analysis does not change: the value, the change against the period before, the usual range
  (median ± robust deviations of the eight periods before, at least four with data), the verdict,
  the split by dimension and the words that explain it. Only the windows and the words change.
- Words come from the period: `the day before`, `the eight months before`, `No data this quarter.`,
  `Needs four earlier months with data to know the usual range.`
- `readSums` reads daily sums for a day or week watch, as now. For a month or quarter watch it asks
  the Data Mart for `dateTrunc: [{ column: dateColumn, unit: 'MONTH' | 'QUARTER' }]`, so a quarter
  reads tens of rows per combination of dimensions instead of about 820 days. Each row's `day` is
  then the period's first day, which `sumBySegment` already counts inside the period's window.
- The first check of a new or re-checked watch covers 14 days, 12 weeks, 12 months or 4 quarters.
  Older quarters rarely have data.

## Checks

- The id stays `<watchId>~<asOf>`.
- A check gains `granularity`, so a check reads on its own when its watch is gone, as in an export.
  A check without it is a week.
- The stored field `weeks` keeps its name and now holds the periods, oldest first. Renaming it
  would orphan every saved check.
- Changing a watch's period re-checks it, as changing its columns does now: the form's `analysis`
  key includes `granularity`.

## Action input and manifest

`check-metric` input:

```json
{
  "watchId": "string, required",
  "periods": "integer 1–14, how many periods back to check; 1 when unset",
  "weeks": "integer 1–12, the old name of periods, still accepted",
  "documentId": "string, a Doc to add the newest check to",
  "spreadsheetId": "string, a Sheet to add the newest check to"
}
```

- The Worker reads `periods ?? weeks ?? 1`. `weeks` stays in the manifest so that a page opened
  before the release still starts checks.
- `documentId` and `spreadsheetId` together fail with `INVALID_EXPORT`.
- The manifest description says the plugin watches a metric by day, week, month or quarter.

## Schedules

One schedule per watch, as now, at 09:00 in the member's time zone:

| Period | Cron | Name | Button |
| --- | --- | --- | --- |
| day | `0 9 * * *` | `Daily check of <watch>` | Daily |
| week | `0 9 * * 1` | `Weekly check of <watch>` | Weekly |
| month | `0 9 1 * *` | `Monthly check of <watch>` | Monthly |
| quarter | `0 9 1 1,4,7,10 *` | `Quarterly check of <watch>` | Quarterly |

- Saving a watch with a new period updates its schedule's cron and name through
  `ctx.schedules.update`. The schedule's pause, time zone and export target stay.
- The schedule popover says when it runs: `Every day at 09:00`, `Every Monday at 09:00`,
  `On the 1st of each month at 09:00`, `On the 1st of Jan, Apr, Jul and Oct at 09:00`, with the
  time zone.
- An installation holds at most 20 schedules; the host's error reaches the member as now.

## Scheduled export

- The schedule popover has a field "Also add each check to", which takes a Google Doc or Sheet link
  and parses it with `exportTarget`. Creating a schedule saves it in the parameters as
  `{ watchId, documentId }` or `{ watchId, spreadsheetId }`; on an existing schedule, Save updates
  the parameters and an emptied field removes the target.
- After saving its checks, `check-metric` adds the newest one to the target exactly as
  `export-check-to-doc` and `export-check-to-sheet` do: in a Doc its text, its chart and a link
  back, in a Sheet one row. Both actions and the schedule call one function per target.
- The hint under the field says to share the Doc or Sheet with the plugin's service account first.

## Errors

- A failed export does not undo the check: the check is saved first.
- An export that fails ends the run as failed. The message names what was saved and what was not:
  `Checked Sep 2026, but could not add it to the Doc: <reason>`, cut to the host's 1000 characters.
  The code is `GOOGLE_NOT_CONFIGURED` when the installation has no Google Service Account
  Credential and `EXPORT_FAILED` otherwise.
- The member sees the failure in the schedule popover (`Last run failed (EXPORT_FAILED)`) and in
  OWOX under Plugins → Schedules → Run History.
- A cancelled or timed-out run does not export.

## Page

- Watch form: a "Period" choice of Day, Week, Month and Quarter, with a line under it such as
  `Each month is compared with the month before and the eight months before it.` The submit
  button and its hint name the first check: `Create and check 12 months`.
- Watch page: `Last 12 months`, the chart and the strip labelled by period (`19 Oct`, `13 Oct`,
  `Sep`, `Q3`), `vs … the month before`, `Checking the last month.`, `by the monthly schedule`.
- Watch list: each card names its period next to its Data Mart (`Demo Store · Monthly`). The bar
  above the cards drops `Week of …`, which no longer holds for every card, and keeps the counts
  and when the last check ran.
- Routes: a period opens at `/watches/<id>/periods/<asOf>`. `/weeks/<asOf>`, which earlier exports
  link to, opens the same page.
- Empty state: `Pick a metric such as ROAS or revenue. Each day, week, month or quarter it is
  compared with the eight before, …`

## Rollout

The order in the plugin's AGENTS.md stays: deploy the Worker, then tag the release and publish it.
Between the two, the new page sends `periods` to a manifest that accepts only `weeks`, so a check
started from the page in those minutes fails with `INVALID_INPUT`. Schedules send only `watchId`
and keep working. On the dev stand this gap is acceptable; the release follows the deploy at once.

## Testing

- `worker/watch.test.ts`: `periodAt` and `shiftPeriod` for every period, across month ends,
  February, a leap year, a year end and quarters; labels; the words of each period; a month check
  from month-truncated rows; the input's `periods ?? weeks`.
- `worker/google.test.ts`: the period link, the old week link still parsed by the page's route,
  a Sheet row of a month check.
- A test of the cron and name of each period, and of `INVALID_EXPORT`.
- On the stand, with the fewest Data Mart runs: one day watch and one month watch on the demo Data
  Mart; a monthly schedule with export to the demo Doc and one with export to the demo Sheet, each
  run once by setting its cron to the next minute and back; one export to a Doc the service account
  cannot open, to see `EXPORT_FAILED`.

## Out of scope

- Several periods for one watch, and a period switch on its page.
- A year period.
- Exporting only alerts, or a whole history at once.
- A period starting on a chosen weekday or a fiscal quarter.

## Risks

- `dateTrunc` with an aggregation has not been tried through HTTP Data on the stand. The first
  implementation step reads one month-truncated sum from the demo Data Mart; if HTTP Data rejects
  it, a month or quarter watch reads daily sums like a week, and its first check shrinks to stay
  inside the action's 180 s.
- A quarter watch on a Data Mart with less than a year of data shows `Too little history` for its
  first quarters. This is correct: its usual range needs four earlier quarters with data.
