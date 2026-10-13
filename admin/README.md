# Editor dashboard (`/admin/`)

A private page where the editor can read, edit, preview, publish, unpublish and
delete the site's stories and journal entries — and approve or decline what
visitors send in — without opening GitHub.

```
 editor's browser                                     Cloudflare / GitHub
 ────────────────                         ┌──────────────────────────────────────┐
  /admin/ (this folder, static)           │ druk-studio Worker (studio-api/)     │
        │  password → POST /admin/api/login│ · checks the password (a secret)     │
        │  ◀── signed token, 12 hours      │ · checks the token on every request │
        │  fetch /admin/api/…  (same site) │ · builds file paths itself           │
        └────────────────────────────────▶ │ · holds GITHUB_TOKEN (a secret)      │
                                           └──────────────┬───────────────────────┘
                                                          │ one commit per action
                                                          ▼
                              pelsung/druk (main) ─push▶ GitHub Action (journal/sync.mjs)
                                                          │ rebuilds pages, pushes
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

### 1. GitHub token — add one permission

The existing fine-grained token (this repository only) needs **Actions: Read-only**
in addition to **Contents** and **Pull requests** (read & write). GitHub → Settings →
Developer settings → Fine-grained tokens → the token → edit. The token value does
not change. Its owner must be allowed to push to `main` directly (the Action already does).

### 2. Choose the editor password

At least 12 characters; a few random words is good (`maple-river-lantern-42`). It is
the only thing protecting the dashboard, so don't reuse one from elsewhere.

### 3. The Worker

The dashboard page lives on `druk.help/admin/`; it talks to the Worker at its own address
(`https://druk-studio.studio-api.workers.dev/admin/api`, set in the `admin-api` meta tag of
`admin/index.html`). From `studio-api/`:

```bash
npx wrangler secret put ADMIN_PASSWORD --config wrangler.toml     # type the password when asked
npx wrangler deploy --config wrangler.toml
```

Always pass `--config wrangler.toml` (see `studio-api/README.md`). Never put the
password in a file or in chat. `SITE_ORIGIN` in `wrangler.toml` (`https://druk.help`) is the
only website a browser lets use the API.

Optional, recommended: an **activity log** that also records failed attempts:

```bash
npx wrangler kv namespace create AUDIT --config wrangler.toml
# paste the printed id into the commented [[kv_namespaces]] block, uncomment it, deploy again
```

Without it, *Activity* is built from the repository's commit history (successful changes only).

### 4. Publish the dashboard files

Merge this branch to `main`. `admin/` is static and goes out with the site.
`_config.yml` (GitHub Pages) and `.assetsignore` (Cloudflare) keep `content/**/*.md`
(unpublished text!), `studio-api/` and `.github/` from being served. Check once, after an
unpublish, that `https://druk.help/content/stories/<name>.md` gives a 404.

### 5. Check it

Open `https://druk.help/admin/`: you should see a password box, and nothing else.
Visiting `https://druk-studio.studio-api.workers.dev/admin/api/content` without signing in must answer `401`.
Then sign in, make a harmless edit and watch the progress card reach **Live**.

## How sign-in works

The Worker trades the password for a token: an expiry time signed with a key derived from
the password. The page keeps it in this browser, sends it as `Authorization: Bearer …`, and
the Worker checks it on **every** request. It lasts 12 hours (then the password box returns).
A wrong password is answered after a 1.5 s delay. **Changing the password signs everyone out.**
Browsers only let `SITE_ORIGIN` read the API's answers, and changes also need the dashboard's own
header. The Activity log shows "editor" — everyone shares one login.

## Changing the password or giving access

`npx wrangler secret put ADMIN_PASSWORD --config wrangler.toml` with the new one (no
redeploy needed). Anyone who has the password has full access, including deleting, so share it
only with people you trust, and change it when someone leaves.

## Trying it on your computer

```bash
node studio-api/admin-dev.mjs        # from the druk/ folder → http://localhost:8090/admin/
```

Runs the real dashboard and Worker code against a **pretend** GitHub that also runs
the real `journal/sync.mjs` as the Action. Nothing touches the real repository.
The demo password is `demo-password-123`.

## Tests

```bash
node --test studio-api/test/admin.test.mjs     # the Worker: sign-in, edits, conflicts, unpublish, delete…
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
