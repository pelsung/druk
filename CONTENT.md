# Adding things to druk.help

Everything reaches the site through **pull requests on GitHub**. A pull request
is where a change is read, lightly edited if needed, and then merged (published)
or closed (declined). Once something is merged, a GitHub Action rebuilds every
page that shows it.

| | What it is | How it arrives | Lives in | Shows up on |
| --- | --- | --- | --- | --- |
| **Journal entry** | A short field note from a meeting or a visit, following the journal template (see below) | From `/stories/share.html`, or a team pull request | `content/journal/<slug>.md` → `journal/entries.js` | `/journal/`, the **From the journal** cards on the front page, its own page |
| **Story** | A lived experience, told from beginning to end, under a topic its writer chooses | From `/stories/share.html`, or a team pull request | `content/stories/<slug>.md` → `content/stories.js` | `/stories/`, the **Stories** section on the front page, the Stories panel on `/journal/`, its own page |
| **Tagline** | The short lines that run across the site | A team pull request | `content/site.js` | The dark band near the foot of the front page, and the footer |

## The pages

- **`/journal/` — Journal & Stories.** The newest entry large, the next ones as
  cards, and a side panel with the latest stories and a way to share one.
- **`/stories/` — Stories.** Every story as a card, filtered by the topics
  writers have used, with counts.
- **`/stories/share.html` — Share your journal or story.** The public form; the
  visitor picks a journal entry or a story. `?type=journal` preselects the
  first. Both end with a **Review** step that shows the piece exactly as it
  will appear, then **Publish**.
  - **A journal entry** follows the journal template: date, photo, photo
    caption, what happened (from a witness viewpoint), and a personal
    reflection — *Why did we come for the meeting? What happened? What's
    next?* — within **1000 words**. It is published under Druk.help.
  - **A story** is in the writer's own words, under a topic they type
    themselves (common ones are suggested), with their name.

"Read more", "Read story" and every card open the article's own page, with a
link back to the journal or to all stories at the bottom.

## Sent from the site

A journal entry or story sent from `/stories/share.html` becomes a pull request
with one Markdown file (and its photo, if any). Nothing is on the site until the
team merges it. How to review one: `content/stories/README.md` and
`content/journal/README.md`. The small endpoint that opens the pull request
lives in `studio-api/` (setup in its README).

## Written by the team

Open a pull request like any other change:

- **A journal entry or story:** add a Markdown file to `content/journal/` or
  `content/stories/` (the format is in the README in each folder), or for a
  journal entry run `node journal/new-entry.mjs "Title" --body notes.md`.
- **The tagline or footer line:** edit `content/site.js`.

Merge it, and the GitHub Action builds the pages. To preview before merging,
run `node journal/sync.mjs` locally and open the pages.

## Trying it out before it is hosted

```bash
node studio-api/local.mjs        # from the druk/ folder
```

Opens the site at `http://localhost:8080`, with the share form working and
its pull requests kept on this computer. `http://localhost:8080/_review` shows
them with **Merge & publish** and **Close** — merging runs the same build the
GitHub Action runs, so the story appears on the front page and the Stories
page. Anything merged there can be taken off again with **Remove from the
site**. Nothing reaches GitHub.

## Why it is built this way

**GitHub is the review queue.** Writing from the public needs a human to read it
before it goes live. A pull request already gives that — reading, light edits,
approve or decline — with no admin panel, accounts or database to build.

**One list per content type, and the pages are generated from it.** Nothing is
written in two places, so a title can never disagree with itself between the
card and the page it links to.

**Generated blocks sit between markers.** The front page has
`JOURNAL:START … JOURNAL:END`, `STORIES:START … STORIES:END` (the newest story
featured, the next two beside it and the topics they cover — or a quiet
"first stories are on their way" panel while there are none; styles live in
the page's own `<style>` block under `.dh-st`), `TAGLINE:START … TAGLINE:END`
and `FOOTERLINE:START … FOOTERLINE:END`. Everything inside is rewritten by the
sync; everything outside is untouched.

**One set of formatting rules, in `journal/sync-core.js`.** The command-line
script, the sync and the share endpoint all call the same functions.

**Static pages, not a database.** Each entry and story is a real HTML file, so
it loads instantly and is fully visible to search engines. Publishing is a
commit — which is also the backup, the history and the audit trail.

## The command line

```bash
node journal/new-entry.mjs "A day in Trashigang" --tags "Bhutan, Healthcare" --body notes.md
node journal/sync.mjs        # after editing or deleting anything by hand
```

`sync.mjs` builds pages for Markdown entries and stories, and rebuilds
`sitemap.xml`, the front page's journal cards, its Stories section, the tagline
and the footer line.

## Files

```
content/
  site.js           tagline + footer line
  stories.js        the list of stories
  journal/*.md      journal entries sent in or added by pull request
  stories/*.md      stories sent in or added by pull request
journal/
  index.html        Journal & Stories
  entries.js        the list of journal entries
  sync-core.js      shared formatting — the single source of truth
  sync.mjs          regenerates everything derived
  new-entry.mjs     command-line entry writer
  journal.css       styling for journal, stories and the share page
  journal.js        the listing pages, the share form, mobile menu
  _template.html    the shape of a journal entry page
stories/
  index.html        Stories
  share.html        Share your journal or story
  _template.html    the shape of a story page
studio-api/         the endpoint behind Share your journal or story
.github/workflows/  publish-stories.yml — builds what was merged
```
