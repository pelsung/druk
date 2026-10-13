# Shared stories

Each file here is one story sent in from **/stories/share.html**.

A story arrives as a **pull request** holding one Markdown file (and its photo,
if there is one, in `stories/images/`). Nothing is on the site until the pull
request is merged.

## Reviewing a story

1. Open the pull request on GitHub and read the file under **Files changed**.
2. If it needs a light edit — a typo, a phone number that should not be
   there — edit the file right in the pull request.
3. **Merge** to publish it. **Close** to decline it.

After a merge, the *Publish shared stories* GitHub Action turns the file into
`stories/<slug>.html`, adds it to `content/stories.js` and the sitemap, and
commits that. The site updates a minute or two later.

## The file

```markdown
---
title: "Finding strength in small steps"
author: "Pema, Thimphu"
category: "Caregiving"
date: "2026-09-28"
image: "images/finding-strength-in-small-steps.jpg"
imageAlt: "Prayer flags over a river bridge"
---

The story, in plain paragraphs. Leave a blank line between them.
```

`category` is the topic the writer typed, in their own words ("Caregiving",
"Deaf community", …). The Stories page builds its topic filters from whatever
topics are in use, and "caregiving" and "Caregiving" count as one. When
reviewing, you can tidy a topic so similar stories share it. `excerpt` can be
added to choose the card text; otherwise the first paragraph is used.

Submitted text is rendered in safe mode: basic formatting (`**bold**`, lists,
`> quotes`, `## headings`) works, but raw HTML and images inside the text do
not.

### Taking a story down

The easiest way is the editor dashboard (`/admin/`, see `../../admin/README.md`):
**Unpublish** hides it and keeps it, **Delete** removes it for good.

By hand: add `status: "draft"` to the header and run `node journal/sync.mjs` (or just
merge — the Action runs it). The story's page and its line in `content/stories.js`
are removed; the file stays here so it can be published again by deleting that line.
To delete it completely, remove its `.md` file, its photo, its line in
`content/stories.js` and `stories/<slug>.html`, then run `node journal/sync.mjs`.
