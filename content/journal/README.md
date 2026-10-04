# Journal entries

Each file here is one journal entry. Most arrive from **/stories/share.html**
("A journal entry") as a pull request; the team can also add one by pull
request directly. Review, merge or decline it the same way as a story — see
`../stories/README.md`.

## The journal template

Every entry follows the same shape, and the form asks for exactly this:

1. **Date** — of the meeting or visit
2. **Photo** — every entry has one
3. **Photo caption** — shown under the photo
4. **What happened** — described from a witness's viewpoint
5. **Personal reflection**
   - Why did we come for the meeting?
   - What happened?
   - What's next?
6. **Within 1000 words** — the description and the three answers together
7. **Review and publish** — the writer sees the entry as it will appear, then
   publishes; the team gives it a final read in the pull request

The form and the worker both enforce it: a missing photo, caption or answer,
or more than 100 words, is sent back to the writer with what to fix.

## The file

```markdown
---
title: "Meeting the palliative care team in Mongar"
author: "Druk.help"
date: "2026-09-29"
image: "images/meeting-the-palliative-care-team-in-mongar.jpg"
caption: "The district team showing us their patient register"
---

## What we saw

We sat with the palliative care focal person and two nurses at Mongar regional
hospital. They walked us through the paper register they keep for every
patient at home.

## Personal reflection

**Why did we come for the meeting?** To learn how home visits are planned today.

**What happened?** The nurses showed us where the register slows them down.

**What’s next?** We will sketch a simple digital register with them.
```

The two headings are part of the template: on the page they become the
points of the **In this article** list, with the three questions beneath
**Personal reflection**. The photo sits in `journal/images/`. Journal entries
carry no personal name; they are published under **Druk.help** like the rest
of the journal. When
editing one in a pull request, keep it within 100 words.

After a merge, the GitHub Action turns the file into `journal/<slug>.html`,
adds it to `journal/entries.js`, the Journal page, the front page's
**From the journal** cards and the sitemap, and commits that.

To take one down, delete its `.md` file here, its photo and its entry in
`journal/entries.js`, delete `journal/<slug>.html`, then run
`node journal/sync.mjs`.
