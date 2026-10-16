# Agent instructions

This is an example OWOX Data Marts plugin with backend actions: Metric Watch. A member picks a
Data Mart metric, such as ROAS as the sum of revenue divided by the sum of cost, and the columns
that explain it, such as channel, campaign and country, how its value reads and whether a rise is
good or bad. The page starts `check-metric`; the Worker
reads daily sums through HTTP Data, compares the last full week with the eight weeks before,
splits the change between the values of each column and saves one check per week to the `checks`
collection. A check started before the plugin closed is there when it reopens. With an optional
Google Service Account Credential, `export-check-to-doc` and `export-check-to-sheet` append a
check to a Google Doc or Sheet with a link back to its week; OWOX adds the access token, so the
key never reaches the Worker. The Doc also gets the week's chart: the Worker draws it as a PNG at a
signed link that Docs fetches while the export runs.
One Cloudflare Worker serves the page from `dist/`, runs the actions at `/owox` and draws charts
at `/chart.png`.

- `src/`: the plugin page (Vite and React) on the authoring guide's UI foundation in
  `styles.css`, with Lucide icons. It saves watches through `ctx.collections`, starts checks
  through `ctx.actions` and keeps a running check in the plugin route.
- `worker/index.ts`: the actions, built with `createBackend` from `@owox/plugin-sdk/server`.
- `worker/google.ts`: the export target of a Doc or Sheet link and what a check adds there;
  `worker/google.test.ts` tests the link.
- `worker/chart.ts`: the chart of a watch's weeks, drawn by the page and as an SVG for a Doc, and
  its signed link; `worker/chart.test.ts` tests them. `worker/png.ts` turns the SVG into a PNG
  with resvg and the Roboto fonts in `vendor/fonts` (SIL Open Font License, `vendor/fonts/OFL.txt`).
- `worker/watch.ts`: the usual range, the verdict of a week, the split of a change, the words that
  explain it and how a value reads; `worker/watch.test.ts` tests them.
- `plugin.json`: the manifest. OWOX reads it from the release commit. Within a compatibility line a
  release may add actions but must not remove one.
- `public/_headers`: sends `Access-Control-Allow-Origin: *`, without which the page's module
  script does not load in the plugin frame. Keep it.
- `vendor/`: the SDK and API client packed from an OWOX Data Marts branch. Replace them with the
  published `@owox/plugin-sdk` once it ships backend actions.

Commands: `npm run build`, `npm run lint`, `npm test`, then `npx wrangler deploy`. Charts need
the Worker secret `CHART_KEY` (`npx wrangler secret put CHART_KEY`, any random string); without it
a Doc gets the text and the link only.

Rules:

- Follow the [plugin authoring guide](https://github.com/OWOX/owox-data-marts/blob/main/docs/plugins/authoring-guide.md).
- Never commit credentials, `.env` files or Cloudflare tokens. Never log the
  `x-owox-execution-token` header.
- Release with a tag `vMAJOR.MINOR.PATCH`, not a prerelease, after the Worker is deployed.
