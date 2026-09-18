/* ==========================================================================
   Druk.help — blog sync

   Rebuilds everything that is derived from blog/posts.js:
     · /sitemap.xml            — one entry per post
     · /index.html             — the three cards in the "From the blog" section,
                                 between the BLOG:START / BLOG:END markers

   Run it after editing or deleting a post by hand:

       node blog/sync.mjs

   new-post.mjs calls the same functions, so scaffolding a post keeps the
   landing page and sitemap current without a second step.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLOG_DIR = dirname(fileURLToPath(import.meta.url));
export const SITE_DIR = join(BLOG_DIR, '..');
export const SITE_ORIGIN = 'https://druk.help';
export const HOME_CARDS = 3;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function humanDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fail(message) {
  console.error('\n  ' + message + '\n');
  process.exit(1);
}

/* ---------- posts.js ---------- */

const POSTS_PATH = join(BLOG_DIR, 'posts.js');

export function readPosts() {
  const raw = readFileSync(POSTS_PATH, 'utf8');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) fail('Could not find the post array in blog/posts.js.');
  let posts;
  try {
    posts = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    fail('blog/posts.js is not valid JSON inside the array: ' + error.message);
  }
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { header: raw.slice(0, start), posts };
}

export function writePosts(header, posts) {
  const body = posts
    .map((post) => '  ' + JSON.stringify(post, null, 2).split('\n').join('\n  '))
    .join(',\n');
  writeFileSync(POSTS_PATH, `${header}[\n${body}\n];\n`, 'utf8');
}

/* ---------- sitemap.xml ---------- */

export function writeSitemap(posts) {
  const sitemapPath = join(SITE_DIR, 'sitemap.xml');
  let homeLastmod = today();
  if (existsSync(sitemapPath)) {
    const current = readFileSync(sitemapPath, 'utf8');
    const match = current.match(/<loc>https:\/\/druk\.help\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/);
    if (match) homeLastmod = match[1];
  }

  const newest = posts.length ? posts[0].date : homeLastmod;
  const entries = [
    { loc: `${SITE_ORIGIN}/`, lastmod: homeLastmod, changefreq: 'monthly', priority: '1.0' },
    { loc: `${SITE_ORIGIN}/blog/`, lastmod: newest, changefreq: 'weekly', priority: '0.8' },
    ...posts.map((post) => ({
      loc: `${SITE_ORIGIN}/blog/${post.slug}.html`,
      lastmod: post.date,
      changefreq: 'yearly',
      priority: '0.7',
    })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => [
      '  <url>',
      `    <loc>${entry.loc}</loc>`,
      `    <lastmod>${entry.lastmod}</lastmod>`,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
    '',
  ].join('\n');

  writeFileSync(sitemapPath, xml, 'utf8');
  return entries.length;
}

/* ---------- the "From the blog" cards on the landing page ---------- */

const META_STYLE = "font-family: 'Geist Mono', monospace; font-size: 12.5px; letter-spacing: 0.06em; color: #8C816F; margin: 0";
const TITLE_STYLE = "font-family: 'Bodoni Moda', serif; font-size: 22px; font-weight: 500; line-height: 1.2; margin: 12px 0 0";
const EXCERPT_STYLE = 'font-size: 15.5px; line-height: 1.65; color: #5E5648; margin: 10px 0 0; text-wrap: pretty';
const READ_STYLE = "font-family: 'Geist Mono', monospace; font-size: 12.5px; font-weight: 500; letter-spacing: 0.1em; color: var(--accent, #8E2B1F)";
const IMAGE_STYLE = 'display: block; width: 100%; height: auto; aspect-ratio: 3 / 2; object-fit: cover';

function card(post) {
  /* Links are relative so the site works from a file:// path as well as a server. */
  const href = `blog/${post.slug}.html`;
  const lines = ['        <article data-reveal="" style="border-top: 1px solid #DCD2C0; padding: 28px 0 32px">'];

  if (post.image) {
    lines.push(
      `          <a href="${href}" style="display: block; margin: 0 0 20px; border-radius: 10px; overflow: hidden; background: #EFE7D8" style-hover="opacity: 0.92"><img src="blog/${post.image}" alt="" loading="lazy" width="600" height="400" style="${IMAGE_STYLE}"></a>`,
    );
  }

  lines.push(
    `          <p style="${META_STYLE}">${humanDate(post.date)}</p>`,
    `          <h3 style="${TITLE_STYLE}"><a href="${href}" style="color: #231A12" style-hover="color: var(--accent, #8E2B1F)">${escapeHtml(post.title)}</a></h3>`,
    `          <p style="${EXCERPT_STYLE}">${escapeHtml(post.excerpt)}</p>`,
    `          <p style="margin: 16px 0 0"><a href="${href}" style="${READ_STYLE}" style-hover="color: #6E1F15">READ &rarr;</a></p>`,
    '        </article>',
  );

  return lines.join('\n');
}

export function writeHomeCards(posts) {
  const homePath = join(SITE_DIR, 'index.html');
  if (!existsSync(homePath)) return 0;

  const html = readFileSync(homePath, 'utf8');
  const startMarker = html.indexOf('<!-- BLOG:START');
  const endMarker = html.indexOf('<!-- BLOG:END -->');
  if (startMarker === -1 || endMarker === -1) {
    console.warn('  (skipped index.html — BLOG:START / BLOG:END markers not found)');
    return 0;
  }

  const startLineEnd = html.indexOf('\n', startMarker) + 1;
  const picks = posts.slice(0, HOME_CARDS);
  const block = [
    '      <div style="margin-top: 48px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 56px">',
    ...picks.map(card),
    '      </div>',
    '      ',
  ].join('\n');

  writeFileSync(homePath, html.slice(0, startLineEnd) + block + html.slice(endMarker), 'utf8');
  return picks.length;
}

/* ---------- run directly ---------- */

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { posts } = readPosts();
  const urls = writeSitemap(posts);
  const cards = writeHomeCards(posts);
  console.log(`
  Synced from blog/posts.js (${posts.length} posts)
    sitemap.xml   ${urls} URLs
    index.html    ${cards} cards in the "From the blog" section
`);
}
