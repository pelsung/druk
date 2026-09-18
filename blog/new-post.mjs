#!/usr/bin/env node
/* ==========================================================================
   Druk.help — new post scaffolder

   Usage:
     node blog/new-post.mjs "Your post title"
     node blog/new-post.mjs "Your post title" --tags "Bhutan, Healthcare" --date 2026-10-02
     node blog/new-post.mjs "Your post title" --excerpt "One sentence for the card."

   Options:
     --excerpt "…"   card text + meta description  (default: a placeholder)
     --tags "a, b"   comma separated topic labels   (default: none)
     --image "…"     cover art, e.g. images/my-post.svg  (default: none)
     --author "…"    byline                          (default: Druk.help)
     --date YYYY-MM-DD                               (default: today)
     --slug my-slug  override the generated file name
     --force         overwrite an existing post file

   It does four things:
     1. writes blog/<slug>.html from _template.html
     2. adds the post to blog/posts.js
     3. rebuilds /sitemap.xml
     4. refreshes the "From the blog" cards on the landing page
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BLOG_DIR, readPosts, writePosts, writeSitemap, writeHomeCards,
  humanDate, escapeHtml, today, fail,
} from './sync.mjs';

/* ---------- argv ---------- */

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

/* ---------- text helpers ---------- */

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* Straight quotes become curly, so the text is safe in HTML attributes,
   HTML text and the JSON-LD block alike — and reads better anyway. */
function curl(text) {
  return text
    .replace(/"([^"]*)"/g, '“$1”')
    .replace(/"/g, '”')
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/'/g, '’');
}

/* ---------- main ---------- */

const opts = parseArgs(process.argv.slice(2));
const title = curl((opts._.join(' ') || opts.title || '').trim());
if (!title) {
  fail('Give the post a title:  node blog/new-post.mjs "Your post title"');
}

const slug = slugify(opts.slug || title);
if (!slug) fail('That title does not produce a usable file name — pass --slug my-post.');

const date = (opts.date || today()).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must look like 2026-10-02.');

const author = curl((opts.author || 'Druk.help').trim());
const excerpt = curl((opts.excerpt || 'One or two sentences describing this post. Edit me in blog/posts.js and in the page itself.').trim());
const tags = (opts.tags || '')
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);

const postPath = join(BLOG_DIR, `${slug}.html`);
if (existsSync(postPath) && !opts.force) {
  fail(`blog/${slug}.html already exists. Pass --force to overwrite it.`);
}

const templatePath = join(BLOG_DIR, '_template.html');
if (!existsSync(templatePath)) fail('blog/_template.html is missing.');

const tagsHtml = tags.length
  ? tags.map((tag) => `<span class="card-tag">${escapeHtml(tag)}</span>`).join(' ')
  : '';

const html = readFileSync(templatePath, 'utf8')
  /* drop the instructions comment from the generated file */
  .replace(/<!--\s*=+\s*\n[\s\S]*?Druk\.help — post template[\s\S]*?-->\n/, '')
  .replaceAll('{{TITLE}}', escapeHtml(title))
  .replaceAll('{{DESCRIPTION}}', escapeHtml(excerpt))
  .replaceAll('{{SLUG}}', slug)
  .replaceAll('{{DATE_ISO}}', date)
  .replaceAll('{{DATE_HUMAN}}', humanDate(date))
  .replaceAll('{{AUTHOR}}', escapeHtml(author))
  .replaceAll('{{TAGS_HTML}}', tagsHtml);

writeFileSync(postPath, html, 'utf8');

const { header, posts } = readPosts();
const entry = { slug, title, date, author, excerpt };
if (opts.image) entry.image = opts.image.replace(/^\/?blog\//, '');
if (tags.length) entry.tags = tags;
const next = [entry, ...posts.filter((post) => post.slug !== slug)]
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

writePosts(header, next);
writeSitemap(next);
const cards = writeHomeCards(next);

console.log(`
  Created  blog/${slug}.html
  Listed   blog/posts.js        (${next.length} posts)
  Updated  sitemap.xml
  Updated  index.html           ("From the blog" — ${cards} newest posts)

  Next: open blog/${slug}.html and write the post inside <div class="post-body">.
  Preview: npx serve .   then visit  http://localhost:3000/blog/
`);
