/* Try the editor dashboard on your own computer, without GitHub or Cloudflare.

       node studio-api/admin-dev.mjs          (from the druk/ folder)
       open  http://localhost:8090/admin/

   It serves a COPY of the site held in memory, and the real Worker code answers
   /admin/api/ against a pretend GitHub (studio-api/test/fake-github.mjs) that
   also runs the real journal/sync.mjs as the "Action". Nothing you do here
   touches the real repository or website; restart to start fresh.

   Saves are slowed on purpose (build after 4 s, publish after 8 s) so you can
   watch the progress steps. Signing in is skipped — only in this local copy. */

import { createServer } from 'node:http';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker.js';
import { createFakeGitHub } from './test/fake-github.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8090);
const fake = createFakeGitHub({ root });
fake.install();

const env = {
  LOCAL_DEV: '1', DEV_AUTH_EMAIL: process.env.DEV_EMAIL || 'editor@example.com',
  GITHUB_TOKEN: 'local-demo', REPO: 'pelsung/druk', BRANCH: 'main',
  ADMIN_EMAILS: process.env.DEV_ADMINS || '',
};

/* something a visitor "sent in", so Waiting for review has an example */
fake.openSubmission('story', 'a-day-at-the-clinic', [
  '---', 'title: "A day at the clinic"', 'author: "Pema Dorji, Thimphu"', 'category: "Caregiving"', 'date: "2026-10-10"', '---', '',
  'I went with my mother to the clinic on Tuesday.', '', 'The nurse remembered her name, and that small thing made the whole morning easier.', '',
].join('\n'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + port);
    if (url.pathname.startsWith('/admin/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const write = req.method !== 'GET';
      if (write) { fake.state.holdBuild = true; fake.state.holdDeploy = true; }
      const response = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
      if (write && response.status === 200) {
        setTimeout(() => { fake.state.holdBuild = false; fake.finishHeldBuild(); }, 4000);
        setTimeout(() => fake.deployNow(), 8000);
      } else if (write) { fake.state.holdBuild = false; fake.state.holdDeploy = false; }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (url.pathname === '/cdn-cgi/access/logout') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Logged out (local demo).'); return; }
    let path = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
    if (path.endsWith('/')) path += 'index.html';
    const live = fake.snapshot(fake.state.deployed);
    const file = live.get(path) || (live.has(path + '/index.html') ? live.get(path + '/index.html') : null);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(file);
  } catch (error) {
    console.error(error);
    res.writeHead(500); res.end('error');
  }
}).listen(port, () => console.log('\n  Editor dashboard (local demo):  http://localhost:' + port + '/admin/\n  Signed in as ' + env.DEV_AUTH_EMAIL + ' — nothing here touches the real site.\n'));
