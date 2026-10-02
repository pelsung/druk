#!/usr/bin/env node
/* ==========================================================================
   Druk.help — local preview, with pull requests that never leave this computer

       node studio-api/local.mjs          (from the druk/ folder)
       → http://localhost:8080             the site
       → http://localhost:8080/_review     the pull requests, with Merge / Close

   The whole flow, without GitHub or hosting:

     1. "Share your journal or story" is sent to this server instead of the
        Cloudflare Worker. It runs the real worker code (worker.js), so the
        checks and the Markdown it writes are exactly what goes live — only
        the calls to GitHub are answered here, and each "pull request" is kept
        in .local-review/.
     2. /_review shows each one as GitHub would: title, description, files.
     3. Merge writes the files into the site and runs node journal/sync.mjs,
        exactly as the GitHub Action does after a real merge. Refresh the
        front page and the story is there.

   Anything merged here can be taken off again from /_review ("Remove"), so a
   demo leaves no trace. Nothing in this file is used by the hosted site.
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = join(ROOT, '.local-review');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const ENV = { GITHUB_TOKEN: 'local', REPO: 'local/druk', BRANCH: 'main' };

/* the worker logs every non-200 GitHub answer; here a 404 just means "that
   file name is free", so keep those lines out of the terminal */
const log = console.log;
console.log = (...args) => { if (!(args[0] === 'GitHub' && args[1] === 404)) log(...args); };

const worker = (await import('./worker.js')).default;
const core = globalThis.DrukJournal;

/* ---------- a stand-in for GitHub, for the worker's calls ---------- */

const realFetch = globalThis.fetch;
const git = { blobs: {}, trees: {}, commits: {}, next: 1, branch: '' };
const id = (prefix) => prefix + (git.next++);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function pendingPaths() {
  return listPending().flatMap((pr) => pr.files.map((f) => f.path));
}

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.github.com') return realFetch(url, options);
  const path = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;

  if (method === 'GET' && path.startsWith('/git/ref/heads/')) return json({ object: { sha: 'local-main' } });
  if (method === 'GET' && path.startsWith('/contents/')) {
    const file = decodeURIComponent(path.slice('/contents/'.length));
    return existsSync(join(ROOT, file)) || pendingPaths().includes(file) ? json({}) : json({ message: 'Not Found' }, 404);
  }
  if (method === 'GET' && path.startsWith('/git/commits/')) return json({ tree: { sha: 'base' } });
  if (method === 'POST' && path === '/git/blobs') { const k = id('blob'); git.blobs[k] = body; return json({ sha: k }, 201); }
  if (method === 'POST' && path === '/git/trees') { const k = id('tree'); git.trees[k] = body.tree; return json({ sha: k }, 201); }
  if (method === 'POST' && path === '/git/commits') { const k = id('commit'); git.commits[k] = body; return json({ sha: k }, 201); }
  if (method === 'POST' && path === '/git/refs') { git.branch = body.ref.replace('refs/heads/', ''); git.head = body.sha; return json({}, 201); }
  if (method === 'POST' && path === '/pulls') return json(openPullRequest(body), 201);
  return json({ message: 'not handled locally: ' + method + ' ' + path }, 500);
};

/* ---------- the local pull requests ---------- */

function listPending() {
  if (!existsSync(QUEUE)) return [];
  return readdirSync(QUEUE).filter((d) => /^\d+$/.test(d))
    .map((d) => JSON.parse(readFileSync(join(QUEUE, d, 'pr.json'), 'utf8')))
    .sort((a, b) => b.number - a.number);
}

function readMerged() {
  const file = join(QUEUE, 'merged.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

function writeMerged(list) {
  mkdirSync(QUEUE, { recursive: true });
  writeFileSync(join(QUEUE, 'merged.json'), JSON.stringify(list, null, 2));
}

function openPullRequest(pr) {
  const commit = git.commits[git.head];
  const files = git.trees[commit.tree].map((entry) => ({ path: entry.path, ...git.blobs[entry.sha] }));
  const numbers = listPending().map((p) => p.number).concat(readMerged().map((m) => m.number || 0));
  const number = Math.max(0, ...numbers) + 1;
  mkdirSync(join(QUEUE, String(number)), { recursive: true });
  const record = { number, title: pr.title, body: pr.body, branch: git.branch, opened: new Date().toISOString(), files };
  writeFileSync(join(QUEUE, String(number), 'pr.json'), JSON.stringify(record, null, 2));
  console.log(`  pull request #${number} opened (locally): ${pr.title}  →  http://localhost:${PORT}/_review`);
  return { number };
}

function sync() {
  execFileSync(process.execPath, ['journal/sync.mjs'], { cwd: ROOT, stdio: 'ignore' });
}

/* what a merged Markdown file turns into, so it can be taken off again */
function describe(files) {
  const md = files.find((f) => /^content\/(journal|stories)\/[a-z0-9-]+\.md$/.test(f.path));
  if (!md) return null;
  const [, folder, slug] = md.path.match(/^content\/(journal|stories)\/([a-z0-9-]+)\.md$/);
  return { kind: folder === 'journal' ? 'journal' : 'story', slug, page: folder + '/' + slug + '.html' };
}

function merge(number) {
  const dir = join(QUEUE, String(number));
  const pr = JSON.parse(readFileSync(join(dir, 'pr.json'), 'utf8'));
  for (const f of pr.files) {
    const target = join(ROOT, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content);
  }
  sync();   /* what the GitHub Action does after a real merge */
  const what = describe(pr.files);
  writeMerged([{ number, title: pr.title, merged: new Date().toISOString(), files: pr.files.map((f) => f.path), ...what }, ...readMerged()]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`  merged #${number}: ${pr.title}`);
}

function close(number) {
  rmSync(join(QUEUE, String(number)), { recursive: true, force: true });
  console.log(`  closed #${number}`);
}

/* take a demo merge back off the site */
function unpublish(number) {
  const merged = readMerged();
  const item = merged.find((m) => m.number === number);
  if (!item) return;
  for (const p of [...item.files, item.page].filter(Boolean)) {
    const target = join(ROOT, p);
    if (existsSync(target)) unlinkSync(target);
  }
  const listFile = item.kind === 'journal' ? join(ROOT, 'journal/entries.js') : join(ROOT, 'content/stories.js');
  const items = core.parseEntriesFile(readFileSync(listFile, 'utf8')).filter((i) => i.slug !== item.slug);
  writeFileSync(listFile, item.kind === 'journal' ? core.entriesFile(items) : core.storiesFile(items));
  sync();
  writeMerged(merged.filter((m) => m.number !== number));
  console.log(`  removed #${number} from the site: ${item.title}`);
}

/* ---------- the review page ---------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function reviewPage() {
  const pending = listPending();
  const merged = readMerged();
  const pr = (p) => {
    const md = p.files.find((f) => f.path.endsWith('.md'));
    const photo = p.files.find((f) => f.encoding === 'base64');
    const type = photo && /\.png$/.test(photo.path) ? 'png' : photo && /\.webp$/.test(photo.path) ? 'webp' : 'jpeg';
    const description = esc(p.body).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').split('\n').join('<br>');
    return `
    <article class="pr">
      <header>
        <span class="state">Open</span>
        <h2>${esc(p.title)} <span class="num">#${p.number}</span></h2>
        <p class="sub">wants to merge <code>${esc(p.branch)}</code> into <code>main</code> · ${new Date(p.opened).toLocaleString()}</p>
      </header>
      <div class="desc">${description}</div>
      <p class="label">Files changed (${p.files.length})</p>
      ${p.files.map((f) => `<p class="file"><code>${esc(f.path)}</code></p>`).join('')}
      ${md ? `<pre>${esc(md.content)}</pre>` : ''}
      ${photo ? `<img src="data:image/${type};base64,${photo.content}" alt="">` : ''}
      <form method="post" class="actions">
        <button formaction="/_review/merge/${p.number}" class="merge">Merge &amp; publish</button>
        <button formaction="/_review/close/${p.number}" class="close">Close without publishing</button>
      </form>
    </article>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pull requests (local) — Druk.help</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@500&family=Albert+Sans:wght@400;600&display=swap">
<style>
  body { margin: 0; background: #F6F0E4; color: #231A12; font: 15px/1.6 "Albert Sans", system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font: 500 34px/1.1 "Bodoni Moda", serif; margin: 0; }
  .lede { color: #5E5648; margin: 10px 0 0; }
  .links { margin: 14px 0 32px; display: flex; gap: 16px; flex-wrap: wrap; }
  a { color: #8E2B1F; }
  .pr { background: #FBF7EF; border: 1px solid #E4DACA; border-radius: 14px; padding: 20px 22px; margin: 0 0 18px; }
  .pr h2 { font-size: 19px; margin: 8px 0 0; }
  .num { color: #8C816F; font-weight: 400; }
  .state { display: inline-block; background: #4E7A46; color: #fff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
  .sub { color: #8C816F; font-size: 13px; margin: 4px 0 0; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; background: #EFE7D8; padding: 1px 6px; border-radius: 5px; }
  .desc { margin: 14px 0; padding: 12px 14px; background: #fff; border: 1px solid #E4DACA; border-radius: 10px; font-size: 14px; }
  .label { font-weight: 600; margin: 14px 0 4px; }
  .file { margin: 2px 0; }
  pre { white-space: pre-wrap; background: #fff; border: 1px solid #E4DACA; border-radius: 10px; padding: 12px 14px; font-size: 13px; max-height: 320px; overflow: auto; }
  img { max-width: 260px; border-radius: 10px; margin-top: 8px; display: block; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
  button { font: 600 14px "Albert Sans", sans-serif; border-radius: 999px; padding: 10px 18px; cursor: pointer; border: 1px solid transparent; }
  .merge { background: #4E7A46; color: #fff; }
  .close { background: transparent; border-color: #C8BCA6; color: #5E5648; }
  .empty { color: #5E5648; background: #FBF7EF; border: 1px dashed #C8BCA6; border-radius: 14px; padding: 22px; }
  h3 { font: 500 22px "Bodoni Moda", serif; margin: 40px 0 10px; }
  .merged { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid #E4DACA; }
  .merged form button { padding: 6px 12px; font-size: 13px; }
</style></head><body><main>
  <h1>Pull requests</h1>
  <p class="lede">Local preview — these stand in for the pull requests GitHub will show. Merging here does what merging on GitHub does: the GitHub Action's build runs and the page goes live on the site.</p>
  <p class="links"><a href="/index.html#stories" target="_blank">Front page ↗</a><a href="/journal/index.html" target="_blank">Journal ↗</a><a href="/stories/index.html" target="_blank">Stories ↗</a><a href="/stories/share.html" target="_blank">Share form ↗</a></p>
  ${pending.length ? pending.map(pr).join('') : '<p class="empty">No open pull requests. Send something from the <a href="/stories/share.html" target="_blank">share form</a>, then reload this page.</p>'}
  ${merged.length ? `<h3>Merged during this preview</h3>${merged.map((m) => `
    <div class="merged"><span>#${m.number} ${esc(m.title)} — <a href="/${esc(m.page || '')}" target="_blank">view page ↗</a></span>
    <form method="post"><button formaction="/_review/unpublish/${m.number}" class="close">Remove from the site</button></form></div>`).join('')}` : ''}
</main></body></html>`;
}

/* ---------- the server ---------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

async function serveFile(res, urlPath) {
  let path = decodeURIComponent(urlPath);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT + sep) || file.includes(sep + '.local-review')) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) { res.writeHead(302, { Location: urlPath.replace(/\/?$/, '/') }).end(); return; }
    let body = await readFile(file);
    /* the share form posts to this server instead of the Cloudflare Worker */
    if (path === '/stories/share.html') {
      body = body.toString('utf8').replace(/(<meta name="studio-api" content=")[^"]*(")/, '$1$2');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/submit') {
      const answer = await worker.fetch(new Request('http://localhost/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await readBody(req),
      }), ENV);
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(await answer.text());
      return;
    }
    const action = req.method === 'POST' && url.pathname.match(/^\/_review\/(merge|close|unpublish)\/(\d+)$/);
    if (action) {
      await readBody(req);
      ({ merge, close, unpublish })[action[1]](Number(action[2]));
      res.writeHead(303, { Location: '/_review' }).end();
      return;
    }
    if (url.pathname === '/_review' || url.pathname === '/_review/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(reviewPage());
      return;
    }
    await serveFile(res, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Something went wrong: ' + error.message);
  }
}).listen(PORT, () => {
  console.log(`
  Druk.help — local preview
    the site           http://localhost:${PORT}/
    share form         http://localhost:${PORT}/stories/share.html
    pull requests      http://localhost:${PORT}/_review

  Nothing here reaches GitHub. Press Ctrl+C to stop.
`);
});
