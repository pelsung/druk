/* ==========================================================================
   Druk.help — journal sync

   Rebuilds everything derived from journal/entries.js and content/stories.js:
     · /sitemap.xml        — one URL per entry and story
     · journal/<slug>.html,
       stories/<slug>.html — one page per shared entry or story in
                             content/journal/*.md and content/stories/*.md,
                             listed in journal/entries.js / content/stories.js
     · /index.html         — the "From the journal" cards, the Stories section,
                             the tagline and the footer line, each between
                             its START / END markers

   Run it after editing or deleting anything by hand:

       node journal/sync.mjs

   The GitHub Action runs it after every merged pull request. new-entry.mjs
   and the share endpoint (studio-api/) use the same logic, in sync-core.js.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './sync-core.js';

const core = globalThis.DrukJournal;

export const JOURNAL_DIR = dirname(fileURLToPath(import.meta.url));
export const SITE_DIR = join(JOURNAL_DIR, '..');
export const STORIES_DIR = join(SITE_DIR, 'stories');
export const CONTENT_DIR = join(SITE_DIR, 'content');
export { core };

export function fail(message) {
  console.error('\n  ' + message + '\n');
  process.exit(1);
}

/* ---------- entries.js ---------- */

const ENTRIES_PATH = join(JOURNAL_DIR, 'entries.js');

export function readEntries() {
  try {
    return core.sortEntries(core.parseEntriesFile(readFileSync(ENTRIES_PATH, 'utf8')));
  } catch (error) {
    fail('Could not read journal/entries.js: ' + error.message);
  }
}

export function writeEntries(entries) {
  writeFileSync(ENTRIES_PATH, core.entriesFile(entries), 'utf8');
}

/* ---------- stories and site copy ---------- */

function readGlobalFile(path, name, fallback) {
  if (!existsSync(path)) return fallback;
  const sandbox = {};
  const source = readFileSync(path, 'utf8');
  try {
    new Function('window', source)(sandbox);
  } catch (error) {
    fail('Could not read ' + path + ': ' + error.message);
  }
  return sandbox[name] ?? fallback;
}

export function readStories() {
  return core.sortEntries(readGlobalFile(join(CONTENT_DIR, 'stories.js'), 'DRUK_STORIES', []));
}

export function readSite() {
  return readGlobalFile(join(CONTENT_DIR, 'site.js'), 'DRUK_SITE', { tagline: [], footerLine: '' });
}

export function writeStories(stories) {
  writeFileSync(join(CONTENT_DIR, 'stories.js'), core.storiesFile(stories), 'utf8');
}

export function writeSite(site) {
  writeFileSync(join(CONTENT_DIR, 'site.js'), core.siteFile(site), 'utf8');
}

/* ---------- generated files ---------- */

export function writeSitemap(entries, stories = readStories()) {
  const sitemapPath = join(SITE_DIR, 'sitemap.xml');
  const current = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
  writeFileSync(sitemapPath, core.sitemapXml(entries, core.homeLastmodFrom(current), stories), 'utf8');
  return entries.length + stories.length + 2;
}

export function writeHomeCards(entries, site, stories = readStories()) {
  const homePath = join(SITE_DIR, 'index.html');
  if (!existsSync(homePath)) return 0;
  let next = core.withHomeCards(readFileSync(homePath, 'utf8'), entries);
  if (next !== null && site) next = core.withSiteCopy(next, site);
  if (next !== null) {
    const withStories = core.withHomeStories(next, stories);
    if (withStories === null) console.warn('  (index.html has no STORIES:START / STORIES:END markers — Stories section skipped)');
    else next = withStories;
  }
  if (next === null) {
    console.warn('  (skipped index.html — JOURNAL:START / JOURNAL:END markers not found)');
    return 0;
  }
  writeFileSync(homePath, next, 'utf8');
  return Math.min(entries.length, core.HOME_CARDS);
}

/* ---------- shared writing: content/{journal,stories}/*.md → pages ----------
   Journal entries and stories sent in from /stories/share.html arrive as pull
   requests with one Markdown file each. Once one is merged, this turns it into
   a page and a line in the matching list. A GitHub Action runs it on every
   push. */

const SHARED = {
  journal: { from: 'journal', pages: () => JOURNAL_DIR, folder: 'journal' },
  story: { from: 'stories', pages: () => STORIES_DIR, folder: 'stories' },
};

export function publishMarkdown(kind, items) {
  const conf = SHARED[kind];
  const sourceDir = join(CONTENT_DIR, conf.from);
  if (!existsSync(sourceDir)) return { items, count: 0 };
  const templatePath = join(conf.pages(), '_template.html');
  if (!existsSync(templatePath)) fail(conf.folder + '/_template.html is missing.');
  const template = readFileSync(templatePath, 'utf8');

  let list = items.slice();
  let count = 0;
  for (const file of readdirSync(sourceDir).sort()) {
    if (!file.endsWith('.md') || file.startsWith('_') || file.toLowerCase() === 'readme.md') continue;
    const where = `content/${conf.from}/${file}`;
    const slug = core.slugify(file.replace(/\.md$/, ''));
    let parsed;
    try {
      parsed = core.parseStoryMarkdown(readFileSync(join(sourceDir, file), 'utf8'));
    } catch (error) {
      console.warn(`  (skipped ${where} — ${error.message})`);
      continue;
    }
    const { meta, body } = parsed;
    if (!meta.title || !body) {
      console.warn(`  (skipped ${where} — it needs a title and some text)`);
      continue;
    }

    /* a story's topic is whatever its writer typed; a journal entry needs none */
    const topic = core.cleanTopic(meta.category);
    const item = {
      slug,
      title: core.curl(meta.title),
      date: /^\d{4}-\d{2}-\d{2}$/.test(meta.date || '') ? meta.date : core.today(),
      author: core.curl(meta.author || (kind === 'journal' ? 'Druk.help' : '')),
      excerpt: core.curl(meta.excerpt || core.excerptFrom(body)),
    };
    if (meta.image) item.image = meta.image.replace(new RegExp('^/?' + conf.folder + '/'), '');
    if (kind === 'story') item.category = topic || 'Other';
    else if (topic) item.tags = [topic];

    /* submitted text is rendered in safe mode: no raw HTML gets through */
    const page = core.entryPage(
      { ...item, imageAlt: meta.imageAlt || '', caption: meta.caption || '', tags: kind === 'story' ? [item.category] : (item.tags || []) },
      core.renderBody(body, undefined, { safe: true }), template);
    const pagePath = join(conf.pages(), slug + '.html');
    if (!existsSync(pagePath) || readFileSync(pagePath, 'utf8') !== page) writeFileSync(pagePath, page, 'utf8');

    list = [item, ...list.filter((s) => s.slug !== slug)];
    count++;
  }
  return { items: core.sortEntries(list), count };
}

/* ---------- run directly ---------- */

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const site = readSite();
  const sharedEntries = publishMarkdown('journal', readEntries());
  const sharedStories = publishMarkdown('story', readStories());
  const entries = sharedEntries.items;
  const stories = sharedStories.items;
  writeEntries(entries);
  writeStories(stories);

  const urls = writeSitemap(entries, stories);
  const cards = writeHomeCards(entries, site, stories);

  console.log(`
  Synced ${entries.length} journal entries, ${stories.length} stories, ${site.tagline.length}-part tagline
    shared         ${sharedEntries.count} from content/journal/*.md, ${sharedStories.count} from content/stories/*.md
    sitemap.xml    ${urls} URLs
    index.html     ${cards} journal cards, ${Math.min(stories.length, core.HOME_CARDS)} story cards, tagline and footer line
`);
}
