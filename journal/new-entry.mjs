#!/usr/bin/env node
/* ==========================================================================
   Druk.help — new journal entry (command line)

   Writes a journal entry page and updates the lists, the front page and the
   sitemap in one go. Commit the result on a branch and open a pull request,
   like any other change to the site.

   Usage:
     node journal/new-entry.mjs "Your entry title"
     node journal/new-entry.mjs "Your entry title" --tags "Bhutan, Healthcare"
     node journal/new-entry.mjs "Your entry title" --body notes.md

   Options:
     --excerpt "…"   card text + meta description
     --body FILE     a Markdown file to use as the entry text
     --tags "a, b"   comma separated topic labels
     --author "…"    byline                       (default: Druk.help)
     --date YYYY-MM-DD                            (default: today)
     --image "…"     cover art, e.g. images/my-entry.svg
     --slug my-slug  override the generated file name
     --force         overwrite an existing entry file
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  JOURNAL_DIR, core, fail,
  readEntries, writeEntries, writeSitemap, writeHomeCards,
} from './sync.mjs';

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') { opts.force = true; continue; }
    if (arg.startsWith('--')) { opts[arg.slice(2)] = argv[++i] ?? ''; continue; }
    opts._.push(arg);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

const title = core.curl((opts._.join(' ') || opts.title || '').trim());
if (!title) fail('Give the entry a title:  node journal/new-entry.mjs "Your entry title"');

const slug = core.slugify(opts.slug || title);
if (!slug) fail('That title does not produce a usable file name — pass --slug my-entry.');

const date = (opts.date || core.today()).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must look like 2026-10-02.');

const entryPath = join(JOURNAL_DIR, `${slug}.html`);
if (existsSync(entryPath) && !opts.force) {
  fail(`journal/${slug}.html already exists. Pass --force to overwrite it.`);
}

const templatePath = join(JOURNAL_DIR, '_template.html');
if (!existsSync(templatePath)) fail('journal/_template.html is missing.');

const entry = {
  slug,
  title,
  date,
  author: core.curl((opts.author || 'Druk.help').trim()),
  excerpt: core.curl((opts.excerpt
    || 'One or two sentences describing this entry. Edit me in journal/entries.js and in the page itself.').trim()),
};
if (opts.image) entry.image = opts.image.replace(/^\/?journal\//, '');
const tags = (opts.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
if (tags.length) entry.tags = tags;

/* body: a Markdown file if given, otherwise the template's sample article */
let bodyHtml = null;
if (opts.body) {
  if (!existsSync(opts.body)) fail(`--body file not found: ${opts.body}`);
  bodyHtml = core.renderBody(readFileSync(opts.body, 'utf8'));
}

const template = readFileSync(templatePath, 'utf8');
const page = bodyHtml === null
  ? template
    .replace(/^(<!DOCTYPE html>\s*)<!--[\s\S]*?-->\s*/i, '$1')
    .split('{{TITLE}}').join(core.escapeHtml(entry.title))
    .split('{{DESCRIPTION}}').join(core.escapeHtml(entry.excerpt))
    .split('{{SLUG}}').join(entry.slug)
    .split('{{DATE_ISO}}').join(entry.date)
    .split('{{DATE_HUMAN}}').join(core.humanDate(entry.date))
    .split('{{AUTHOR}}').join(core.escapeHtml(entry.author))
    .split('{{TAGS_HTML}}').join(tags.map((t) => `<span class="card-tag">${core.escapeHtml(t)}</span>`).join(' '))
    .split('{{HERO}}').join(core.heroHtml(entry, true))
  : core.entryPage(entry, bodyHtml, template);

writeFileSync(entryPath, page, 'utf8');

const next = [entry, ...readEntries().filter((e) => e.slug !== slug)];
writeEntries(next);
const sorted = core.sortEntries(next);
writeSitemap(sorted);
const cards = writeHomeCards(sorted);

console.log(`
  Created  journal/${slug}.html
  Listed   journal/entries.js     (${next.length} entries)
  Updated  sitemap.xml
  Updated  index.html             ("From the journal" — ${cards} newest)
${bodyHtml === null ? `
  Next: open journal/${slug}.html and write the entry inside <div class="post-body">.` : ''}
  Preview: open index.html, or npx serve . and visit /journal/
`);
