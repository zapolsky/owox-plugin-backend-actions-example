# Agent instructions

This is an example OWOX Data Marts plugin with backend actions: Metric Watch. A member picks a
Data Mart metric, such as ROAS as the sum of revenue divided by the sum of cost, and the columns
that explain it, such as channel, campaign and country. The page starts `check-metric`; the Worker
reads daily sums through HTTP Data, compares the last full week with the eight weeks before,
splits the change between the values of each column and saves one check per week to the `checks`
collection. A check started before the plugin closed is there when it reopens. One Cloudflare
Worker serves the page from `dist/` and runs the action at `/owox`.

- `src/`: the plugin page (Vite and React) on the authoring guide's UI foundation in
  `styles.css`, with Lucide icons. It saves watches through `ctx.collections`, starts checks
  through `ctx.actions` and keeps a running check in the plugin route.
- `worker/index.ts`: the action, built with `createBackend` from `@owox/plugin-sdk/server`.
- `worker/watch.ts`: the usual range, the split of a change and the check text;
  `worker/watch.test.ts` tests them.
- `plugin.json`: the manifest. OWOX reads it from the release commit. Within a compatibility line a
  release may add actions but must not remove one.
- `public/_headers`: sends `Access-Control-Allow-Origin: *`, without which the page's module
  script does not load in the plugin frame. Keep it.
- `vendor/`: the SDK and API client packed from an OWOX Data Marts branch. Replace them with the
  published `@owox/plugin-sdk` once it ships backend actions.

Commands: `npm run build`, `npm run lint`, `npm test`, then `npx wrangler deploy`.

Rules:

- Follow the [plugin authoring guide](https://github.com/OWOX/owox-data-marts/blob/main/docs/plugins/authoring-guide.md).
- Never commit credentials, `.env` files or Cloudflare tokens. Never log the
  `x-owox-execution-token` header.
- Release with a tag `vMAJOR.MINOR.PATCH`, not a prerelease, after the Worker is deployed.
