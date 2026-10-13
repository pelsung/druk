# Editor dashboard (`/admin/`)

A private page where the editor can read, edit, preview, publish, unpublish and
delete the site's stories and journal entries — and approve or decline what
visitors send in — without opening GitHub.

```
 editor's browser                      Cloudflare                           GitHub
 ────────────────   https://druk.help/admin/   ┌───────────────┐
  /admin/ (this     ──────────────────────────▶│ Access login  │  only approved emails
  folder, static)                              └──────┬────────┘
        │ fetch /admin/api/…  (same address)          │ signed token
        ▼                                             ▼
                                         druk-studio Worker (studio-api/)
                                         · checks the token's signature itself
                                         · checks the email is on the list
                                         · builds the file path; never trusts one
                                         · holds GITHUB_TOKEN (a secret)
                                                      │ one commit per action
                                                      ▼
                                               pelsung/druk  (branch main)
                                                      │ push
                                                      ▼
                                      GitHub Action "Publish shared journal entries
                                      and stories" (journal/sync.mjs) → rebuilds pages
                                                      │ push
                                                      ▼
                                      Cloudflare builds and deploys the site
```

Visitors still submit through `/stories/share.html` → `POST /submit` → a pull
request. **Nothing about that changed.** A submission is only published when a
person presses **Approve and publish** (which merges that pull request) — never
automatically.

## What the editor can do

| Screen | |
| --- | --- |
| **Dashboard** | Real counts: published stories, published journal entries, waiting for review, unpublished. |
| **All stories / All journals / Published / Unpublished** | Search by title, author or topic; filter by type and status. |
| **Edit** | Title, author, date, topic, summary, photo caption/description and the text, in a visual editor (headings, bold, italic, lists, quotes, links). **Preview** shows the real page, built with the site's own template. **Save and Publish** commits it. |
| **Unpublish / Publish** | Sets `status: "draft"` in the Markdown file. The build then removes the page, the list entry, the home-page card and the sitemap line; the text stays in the repository. Publishing removes that line again. |
| **Delete…** | Confirmation naming the title; removes the Markdown file, its page, its list entry and its photo (unless another piece uses it), in one commit. Offers *Unpublish instead*. |
| **Waiting for review** | Reads what a visitor sent, shows the real page, then **Approve and publish** (merges the pull request) or **Decline** (closes it). |
| **Activity** | Who did what, when. |

After every change a card shows the real progress: **Saved → Rebuilding the
pages → Publishing to the website**. It only says *live* once the Worker has
fetched the public page from the site and found it matches (or, for removals,
found it gone). Build or hosting failures are shown with a link for an
administrator.

Edits change only what the editor changed: other header lines (and their order),
the file name and the page address stay exactly as they were. If someone else
changed the file after the editor opened it, saving is refused (409) instead of
overwriting.

## One-time setup

Nothing here has been done for you — it needs your Cloudflare and GitHub accounts.
Do the steps in this order so the dashboard is never reachable unprotected.

### 1. GitHub token — add two permissions

The existing fine-grained token (this repository only) needs, in addition to
**Contents** and **Pull requests** (read & write):

- **Actions: read** — to see whether the rebuild finished.
- **Checks: read** — to see whether Cloudflare's build of the site succeeded. (Optional;
  without it the Worker still checks the live site itself.)

GitHub → Settings → Developer settings → Fine-grained tokens → the token → edit.
The token value does not change, so nothing needs re-entering. The token's owner
must be allowed to push to `main` directly (the Action already does).

### 2. Cloudflare Access — who may sign in

Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
application** → **Self-hosted**.

- Application domain: `druk.help`, path `admin` — and add a second destination
  `druk.help`, path `admin/*`. (This covers the pages and `admin/api/`.)
- Policy: **Allow** → *Emails* → the editor's and your own addresses.
- Sign-in method: One-time PIN (an emailed code) needs no accounts.
- Save, then open the application and copy its **Audience (AUD) tag**. Your **team
  domain** is shown under Zero Trust → Settings → Custom pages (`xxxx.cloudflareaccess.com`).

### 3. The Worker

In `studio-api/wrangler.toml` fill in `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`
(neither is secret) and uncomment the `routes` line with your domain. Then, from
`studio-api/`:

```bash
npx wrangler secret put EDITOR_EMAILS --config wrangler.toml   # editor@example.org,you@example.org
npx wrangler secret put ADMIN_EMAILS  --config wrangler.toml   # optional — see below
npx wrangler deploy --config wrangler.toml
```

Always pass `--config wrangler.toml` (see `studio-api/README.md`). Emails are
secrets so they stay out of the repository.

- `EDITOR_EMAILS` — everyone allowed in. Required; with it empty the API refuses everything.
- `ADMIN_EMAILS` — optional. If set, **only** these people can permanently delete
  (everyone else can still unpublish). Leave it unset to let every editor delete.

Optional, recommended: an **activity log** that also records failed attempts:

```bash
npx wrangler kv namespace create AUDIT --config wrangler.toml
# paste the printed id into the commented [[kv_namespaces]] block, uncomment it, deploy again
```

Without it, *Activity* is built from the repository's commit history (successful
changes only). `HIDE_EDITOR_EMAIL = "1"` in `[vars]` records a short code instead of
the email in commit messages — use it if the repository is public.

### 4. Publish the dashboard files

Merge this branch to `main`. `admin/` is static and goes out with the site.
`.assetsignore` keeps `content/**/*.md` (unpublished text!), `studio-api/` and
`.github/` from being served.

### 5. Check it

Open `https://druk.help/admin/` in a private window: you should be asked to sign
in by Cloudflare, and a person not on the list should be refused. Then, as the
editor, make a harmless edit and watch the progress card reach **Live**.
Visiting `https://druk-studio.<account>.workers.dev/admin/api/content` directly
must answer `401` — the Worker rejects anything Cloudflare Access did not sign.

## Giving someone access

1. Zero Trust → Access → Applications → the dashboard → **Policies** → add their email.
2. `npx wrangler secret put EDITOR_EMAILS --config wrangler.toml` with the full new list; no redeploy needed.

To remove someone, remove them from both. (The Worker checks its own list on
every request, so removing them from `EDITOR_EMAILS` alone already locks them out.)

## Trying it on your computer

```bash
node studio-api/admin-dev.mjs        # from the druk/ folder → http://localhost:8090/admin/
```

Runs the real dashboard and Worker code against a **pretend** GitHub that also runs
the real `journal/sync.mjs` as the Action. Nothing touches the real repository.
Sign-in is skipped, in this local copy only (`LOCAL_DEV` is never set on Cloudflare).

## Tests

```bash
node --test studio-api/test/admin.test.mjs     # the Worker: sign-in, permissions, edits, conflicts, unpublish, delete…
node studio-api/test/editor-roundtrip.mjs      # the visual editor on every real content file (needs Edge or Chrome)
node journal/sync.mjs                          # the existing build; rerun after any change
```

## How the pieces behave (worth knowing)

- **One commit per action**, made with GitHub's Git data API, so a delete never
  half-happens. Commit messages end with `Edited-by: <email>`.
- **No change → no commit.** Saving unchanged text, or publishing something already
  published, does nothing.
- **Conflicts.** Every save carries the version of the file the editor opened; if the
  file has since changed, nothing is written. A push by the publish bot in the same
  moment is merged in automatically — unless it touched the same file.
- **Two saves in a row.** The first rebuild's push can lose the race to the second
  commit; the second rebuild includes both, and the progress card treats that as success.
- **Allowed files.** Requests carry only `kind` (journal/story) and a file name made of
  letters, digits, `-`, `_`. The path is built by the Worker from that. Deleting also
  removes the page, list entry and photo of *that item* and nothing else; a pull request
  that touches anything outside the content and photo folders cannot be approved here.

## Limits

- **Pages made by hand** (listed in `entries.js` but with no Markdown file) are shown
  as *Made by hand — view only*. They can't be edited or removed here.
- **Photos can't be replaced** from the dashboard (text and details only), and an
  unpublished item's photo file stays reachable at its direct address until the item is
  deleted. Delete the item if the photo itself must go.
- Deleting removes files from the branch, **not from Git history**; anyone with access
  to the repository can still read old versions.
- Two editors editing the same piece see a conflict message rather than a merge.
- Publishing is only as fast as the Action plus the Cloudflare build (usually 1–3 minutes).
- The hosting check looks for a check run named like *Cloudflare / Workers / deploy* on
  the latest commit; if your Cloudflare build reports differently, the live-page check
  still decides when it says *live*.
