# Share endpoint

A small Cloudflare Worker behind **Share your journal or story**
(`/stories/share.html`). It holds the site's GitHub token, so no token ever
reaches a browser, and it does one thing: turn each submission into a
**pull request** with one Markdown file in `content/journal/` or
`content/stories/` (plus its photo, if any).

It never writes to the live branch. Nothing is published until someone on the
team merges the pull request — see `content/stories/README.md` for reviewing.

## Trying it without GitHub

```bash
node studio-api/local.mjs        # from the druk/ folder
```

Runs the site and this endpoint on `http://localhost:8080`, answering the
GitHub calls itself: each submission becomes a local pull request, listed at
`/_review` with **Merge & publish** / **Close**. It uses this same `worker.js`,
so what you see is what the hosted version does. Local pull requests are kept
in `.local-review/` (ignored by git).

## Set it up once

```bash
cd studio-api
npx wrangler login
npx wrangler secret put GITHUB_TOKEN --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

Always pass `--config wrangler.toml` here. The `druk/` folder has its own
`wrangler.jsonc` (a static-site worker named `druk`), and Wrangler picks a
`wrangler.jsonc` in a parent folder before the `wrangler.toml` next to it, so
without the flag a command meant for this endpoint goes to that other worker.

The endpoint is deployed at **https://druk-studio.studio-api.workers.dev**.

`deploy` prints the worker's address, e.g.
`https://druk-studio.<your-account>.workers.dev`. Put it in
`stories/share.html`:

```html
<meta name="studio-api" content="https://druk-studio.<your-account>.workers.dev">
```

Then set `ALLOWED_ORIGIN` in `wrangler.toml` to the site's address and deploy
again.

### The token

A fine-grained personal access token, limited to this one repository, with:

- **Contents: read and write** (to put the submission on its own branch)
- **Pull requests: read and write** (to open the pull request)

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
tokens.

### Keeping bots off the form (recommended)

The form already has a hidden trap field that catches simple bots. For real
protection, add Cloudflare Turnstile (free):

1. Cloudflare dashboard → Turnstile → add the site's domain.
2. Put the **site key** in `stories/share.html`:
   `<div class="cf-turnstile" data-sitekey="YOUR-SITE-KEY" hidden></div>`
3. `npx wrangler secret put TURNSTILE_SECRET --config wrangler.toml` with the
   **secret key**, then `npx wrangler deploy --config wrangler.toml`.

### Publishing what was merged

`.github/workflows/publish-stories.yml` runs `node journal/sync.mjs` whenever a
merge adds or changes a file in `content/journal/` or `content/stories/`, and
commits the new page. In the repository's **Settings → Actions → General**,
make sure "Workflow permissions" allows **Read and write**.

## Changing things later

- New token: `npx wrangler secret put GITHUB_TOKEN --config wrangler.toml`.
  Revoke the old one on GitHub.
- Errors from GitHub are logged, not shown on the page:
  `npx wrangler tail --config wrangler.toml`.
- If a studio password was set up earlier, it is no longer used:
  `npx wrangler secret delete STUDIO_PASSWORD --config wrangler.toml`.
