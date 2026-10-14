# Agent instructions

This is an example OWOX Data Marts plugin with backend actions. One Cloudflare Worker serves the
page from `dist/` and runs the actions at `/owox`.

- `src/`: the plugin page (Vite and React). It calls the actions through `ctx.actions`.
- `worker/index.ts`: the actions, built with `createBackend` from `@owox/plugin-sdk/server`.
- `plugin.json`: the manifest. OWOX reads it from the release commit. Within a compatibility line a
  release may add actions but must not remove one.
- `public/_headers`: sends `Access-Control-Allow-Origin: *`, without which the page's module
  script does not load in the plugin frame. Keep it.
- `vendor/`: the SDK and API client packed from an OWOX Data Marts branch. Replace them with the
  published `@owox/plugin-sdk` once it ships backend actions.

Commands: `npm run build`, `npm run lint`, then `npx wrangler deploy`.

Rules:

- Follow the [plugin authoring guide](https://github.com/OWOX/owox-data-marts/blob/main/docs/plugins/authoring-guide.md).
- Never commit credentials, `.env` files or Cloudflare tokens. Never log the
  `x-owox-execution-token` header.
- Release with a tag `vMAJOR.MINOR.PATCH`, not a prerelease, after the Worker is deployed.
