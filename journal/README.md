# The Druk.help journal

Plain HTML, no build step, no dependencies. Every entry is a real static page,
so it loads fast and search engines see the whole article. Everything reaches
the site through **pull requests on GitHub**.

```
journal/
  index.html          Journal & Stories: featured entry, entry cards, stories panel
  entries.js          the list of entries — this drives everything
  sync-core.js        shared formatting, used by the scripts and the share endpoint
  journal.css         styling for the journal, stories and share pages
  journal.js          the listing pages, the share form, related entries, mobile menu
  _template.html      the entry page shape (edit here to restyle entries)
  new-entry.mjs       writes a new entry page from a terminal
  sync.mjs            rebuilds everything derived (run after any hand edit)
  images/             cover art and photos
  <slug>.html         one file per entry
```

Three places show entries, all driven by `entries.js` (and stories by
`../content/stories.js`):

- `/journal/` — **Journal & Stories**: the newest entry featured, the rest as
  cards, the latest stories alongside. "Read more" opens the entry's own page.
- `/` — the three newest, in the **From the journal** section (section 09)
- `sitemap.xml` — one entry per URL

## Adding an entry

**From the site.** Anyone can send one from `/stories/share.html` ("A journal
entry"). It arrives as a pull request with one Markdown file in
`../content/journal/`; merging it publishes it. See
`../content/journal/README.md`.

**As the team, with a pull request.** Either add a Markdown file to
`../content/journal/` (same format as a shared one), or use the terminal:

```bash
node journal/new-entry.mjs "A day in Trashigang" \
  --excerpt "Notes from the eastern districts." \
  --tags "Bhutan, Healthcare" \
  --body notes.md
```

`--body` takes a Markdown file. Without it you get a page with sample text to
edit by hand. Other options: `--author`, `--date 2026-10-02`,
`--slug custom-slug`, `--image images/my-entry.svg`, `--force`. Commit the
result on a branch and open a pull request.

Formatting is Markdown basics:

```
## A section heading
### A smaller heading
**bold**   *italic*   `code`
- a bullet list
> a pull quote
[link text](https://example.com)
---   (a divider)
```

In the team's own entries, a line that starts with `<` is passed through as raw
HTML, so you can drop in a callout or a figure. Shared entries and stories are
rendered in safe mode, where it is not.

## After editing or deleting an entry by hand

```bash
node journal/sync.mjs
```

It builds pages for shared entries and stories in `../content/`, and rebuilds
`sitemap.xml` and the landing page's generated blocks (only what sits between
the `START` / `END` markers). Nothing else in the landing page is touched. The
GitHub Action runs it after every merge.

## Cover images

An entry with an `image` in `entries.js` shows that cover on the journal index
and in the landing page cards. Entries without one still render fine.

Files live in `journal/images/`, referenced relative to `journal/`:

```js
"image": "images/my-entry.svg"
```

Covers are drawn at 3:2. The existing ones are 600×400 SVGs in the site palette
(`#8E2B1F`, `#D9A62E`, `#4E7A46`, `#3F6E9D`, `#22170F` on `#EFE7D8`); JPG and
PNG work too. Always write real alt text.

## Topic tags

Tags are free text, so keep them consistent — `Healthcare`, not `healthcare`
in one entry and `Health` in another.

## Mobile

Every journal page carries a burger menu under 1024px, matching the landing
page. New entries copied from `_template.html` get it automatically.

## Previewing locally

Every internal link and asset path is relative, so the site works either way:
double-click `index.html` to open it from disk, or serve the folder:

```bash
npx serve .          # from the druk/ folder, then visit /journal/
```

Keep new links relative (`journal/entry.html`, `../index.html#care`) — a
root-absolute `/journal/…` resolves to `C:/journal/…` when the file is opened
from disk and breaks.

## Reading time

Calculated from the entry text at page load — nothing to maintain.
