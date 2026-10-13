/* A small stand-in for GitHub, the publish Action and the live website, so the
   dashboard can be tested without touching the real repository.

   It keeps every commit as a snapshot of the whole site. When the branch moves
   it "runs the Action": the real journal/sync.mjs is executed on a copy of the
   new snapshot and its output becomes the bot's follow-up commit, exactly as
   .github/workflows/publish-stories.yml does. The "live site" is the snapshot
   that was last deployed. */

import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const TEXT = /\.(md|js|mjs|html|css|xml|json|jsonc|txt|yml|toml|svg|webmanifest)$/i;
const SKIP = new Set(['.git', '.wrangler', 'node_modules', '.local-review', '.gstack']);

export const REPO = 'pelsung/druk';

export function gitBlobSha(buffer) {
  return createHash('sha1').update('blob ' + buffer.length + '\0').update(buffer).digest('hex');
}

export function loadSnapshot(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      let data = readFileSync(full);
      if (TEXT.test(name)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
      files.set(relative(root, full).split('\\').join('/'), data);
    }
  };
  walk(root);
  return files;
}

export function createFakeGitHub({ root, publicKey } = {}) {
  const commits = new Map();     /* sha → { tree, parents, message, date } */
  const trees = new Map();       /* tree sha → snapshot */
  const runs = [];               /* workflow runs */
  const pulls = [];
  let counter = 0;
  const id = (label) => createHash('sha1').update(label + (++counter)).digest('hex');
  const state = {
    head: null, deployed: null, calls: [], failBuild: false, holdBuild: false, holdDeploy: false,
    failDeploy: false, branchMovedOnce: null, requests: 0, ghDown: false,
  };

  const addCommit = (snapshot, parents, message) => {
    const treeSha = id('tree');
    trees.set(treeSha, snapshot);
    const sha = id('commit');
    commits.set(sha, { tree: treeSha, parents, message, date: new Date().toISOString() });
    return sha;
  };
  const snapshotOf = (sha) => trees.get(commits.get(sha).tree);

  state.head = addCommit(loadSnapshot(root), [], 'initial');
  state.deployed = state.head;

  /* ---------- the Action: node journal/sync.mjs, then commit what changed ---------- */
  function runAction(sha) {
    const run = { id: runs.length + 1, head_sha: sha, status: 'in_progress', conclusion: null, html_url: 'https://github.example/run/' + (runs.length + 1), created_at: new Date(Date.now() + runs.length).toISOString() };
    runs.push(run);
    if (state.holdBuild) return;
    finishRun(run);
  }
  function finishRun(run) {
    if (state.failBuild) { run.status = 'completed'; run.conclusion = 'failure'; return; }
    const base = snapshotOf(run.head_sha);
    const dir = mkdtempSync(join(tmpdir(), 'druk-action-'));
    try {
      for (const [path, data] of base) {
        const full = join(dir, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, data);
      }
      const result = spawnSync(process.execPath, ['journal/sync.mjs'], { cwd: dir, encoding: 'utf8' });
      if (result.status !== 0) { run.status = 'completed'; run.conclusion = 'failure'; run.log = result.stderr; return; }
      const after = loadSnapshot(dir);
      let changed = false;
      for (const [path, data] of after) if (!base.has(path) || !base.get(path).equals(data)) changed = true;
      for (const path of base.keys()) if (!after.has(path)) changed = true;
      run.status = 'completed'; run.conclusion = 'success';
      /* the bot pushes only if the branch is still where the run started */
      if (changed && state.head === run.head_sha) {
        state.head = addCommit(after, [run.head_sha], 'Publish shared journal entries and stories');
      } else if (changed) {
        run.conclusion = 'failure';   /* the bot's push is rejected: the branch moved on */
      }
      if (!state.holdDeploy) state.deployed = state.head;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const touchesContent = (before, after) => {
    const paths = new Set([...before.keys(), ...after.keys()]);
    for (const p of paths) {
      const a = before.get(p), b = after.get(p);
      if (a && b && a.equals(b)) continue;
      if (/^content\/(journal|stories)\//.test(p) || /^(journal|stories)\/_template\.html$/.test(p)) return true;
    }
    return false;
  };
  const moveBranch = (sha) => {
    const before = snapshotOf(state.head);
    state.head = sha;
    if (touchesContent(before, snapshotOf(sha))) runAction(sha);
    else if (!state.holdDeploy) state.deployed = sha;
  };

  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  const fileInfo = (path, data) => ({ type: 'file', name: path.split('/').pop(), path, sha: gitBlobSha(data), size: data.length, content: data.toString('base64').replace(/(.{60})/g, '$1\n') });

  async function gh(method, path, query, body) {
    let m;
    if (state.ghDown) return json(500, { message: 'down' });
    if (method === 'GET' && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) return json(200, { object: { sha: state.head } });
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const c = commits.get(m[1]);
      return c ? json(200, { sha: m[1], tree: { sha: c.tree }, committer: { date: c.date } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && path === '/git/trees') {
      const base = new Map(trees.get(body.base_tree));
      const out = [];
      for (const e of body.tree) {
        if (e.sha === null) { base.delete(e.path); continue; }
        const data = Buffer.from(e.content);
        base.set(e.path, data);
        out.push({ path: e.path, sha: gitBlobSha(data) });
      }
      const sha = id('tree');
      trees.set(sha, base);
      return json(201, { sha, tree: out });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = id('commit');
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message, date: new Date().toISOString() });
      return json(201, { sha });
    }
    if (method === 'PATCH' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      if (state.branchMovedOnce) { const fn = state.branchMovedOnce; state.branchMovedOnce = null; fn(); }
      if (body.force || commits.get(body.sha).parents[0] !== state.head) return json(422, { message: 'Update is not a fast forward' });
      moveBranch(body.sha);
      return json(200, { object: { sha: body.sha } });
    }
    if (method === 'GET' && (m = path.match(/^\/contents\/(.+)$/))) {
      const p = decodeURIComponent(m[1]);
      const snap = snapshotOf(query.get('ref'));
      if (snap.has(p)) return json(200, fileInfo(p, snap.get(p)));
      const prefix = p.replace(/\/$/, '') + '/';
      const names = new Set();
      for (const k of snap.keys()) if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) names.add(k.slice(prefix.length));
      return names.size ? json(200, [...names].map((n) => ({ type: 'file', name: n, path: prefix + n }))) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && path === '/pulls') {
      return json(200, pulls.filter((p) => p.state === 'open').map(prJson));
    }
    if ((m = path.match(/^\/pulls\/(\d+)(\/files|\/merge)?$/))) {
      const pr = pulls.find((p) => p.number === Number(m[1]));
      if (!pr) return json(404, { message: 'Not Found' });
      if (method === 'GET' && !m[2]) return json(200, prJson(pr));
      if (method === 'GET' && m[2] === '/files') return json(200, [...pr.files.keys()].map((f) => ({ filename: f, status: 'added' })));
      if (method === 'PATCH') { pr.state = body.state; return json(200, prJson(pr)); }
      if (method === 'PUT' && m[2] === '/merge') {
        if (pr.state !== 'open' || body.sha !== pr.head.sha) return json(409, { message: 'Head branch was modified' });
        const snap = new Map(snapshotOf(state.head));
        for (const [p, d] of pr.files) snap.set(p, d);
        const sha = addCommit(snap, [state.head, pr.head.sha], body.commit_title);
        pr.state = 'closed';
        moveBranch(sha);
        return json(200, { merged: true, sha });
      }
    }
    if (method === 'GET' && (m = path.match(/^\/actions\/workflows\/[^/]+\/runs$/))) {
      const found = (query.get('head_sha') ? runs.filter((r) => r.head_sha === query.get('head_sha')) : runs.slice().reverse());
      return json(200, { total_count: found.length, workflow_runs: found });
    }
    if (method === 'GET' && (m = path.match(/^\/commits\/([0-9a-f]+)\/check-runs$/))) {
      const done = state.deployed === m[1] || state.deployed !== state.head;
      const checks = [];
      if (state.holdDeploy || state.failDeploy) checks.push({ name: 'Workers Builds: druk', status: state.holdDeploy ? 'in_progress' : 'completed', conclusion: state.failDeploy ? 'failure' : null, html_url: 'https://dash.example/build' });
      return json(200, { check_runs: checks });
    }
    if (method === 'GET' && path === '/commits') {
      const list = [];
      let sha = state.head;
      while (sha && list.length < 50) { const c = commits.get(sha); list.push({ sha, commit: { message: c.message, committer: { date: c.date } } }); sha = c.parents[0]; }
      return json(200, list);
    }
    return json(404, { message: 'Not Found ' + method + ' ' + path });
  }

  function prJson(pr) {
    return { number: pr.number, state: pr.state, title: pr.title, created_at: pr.created_at, head: { ref: pr.ref, sha: pr.head.sha, repo: { full_name: REPO } }, base: { ref: 'main' } };
  }

  async function graphql(body) {
    const v = body.variables;
    const at = (expr) => {
      const [sha, ...rest] = expr.split(':');
      const snap = snapshotOf(sha);
      const path = rest.join(':');
      if (snap.has(path)) return { text: snap.get(path).toString('utf8') };
      const prefix = path + '/';
      const names = [...snap.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'));
      if (!names.length) return null;
      return { entries: names.map((k) => ({ name: k.slice(prefix.length), oid: gitBlobSha(snap.get(k)), object: { text: snap.get(k).toString('utf8') } })) };
    };
    return json(200, { data: { repository: { j: at(v.j), s: at(v.s), jl: at(v.jl), sl: at(v.sl) } } });
  }

  /* ---------- Cloudflare Access: keys and signed tokens ---------- */
  const KID = 'test-key-' + createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 8);
  const { publicKey: pub, privateKey: priv } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...pub.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  const b64u = (x) => Buffer.from(x).toString('base64url');
  function signToken(claims, { kid = KID, key = priv } = {}) {
    const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const payload = b64u(JSON.stringify(claims));
    const sig = createSign('RSA-SHA256').update(head + '.' + payload).sign(key).toString('base64url');
    return head + '.' + payload + '.' + sig;
  }

  /* ---------- fetch: GitHub, Access keys, and the live website ---------- */
  async function fake(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    state.requests++;
    if (url.hostname === 'api.github.com') {
      if (url.pathname === '/graphql') return graphql(JSON.parse(init.body));
      const prefix = '/repos/' + REPO;
      if (!url.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
      state.calls.push(method + ' ' + url.pathname.slice(prefix.length));
      return gh(method, url.pathname.slice(prefix.length), url.searchParams, init.body ? JSON.parse(init.body) : undefined);
    }
    if (url.pathname === '/cdn-cgi/access/certs') return json(200, { keys: [jwk] });
    if (url.hostname === 'druk.help') {
      const snap = snapshotOf(state.deployed);
      const p = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
      return snap.has(p) ? new Response(snap.get(p), { status: 200 }) : new Response('not found', { status: 404 });
    }
    return new Response('unexpected ' + url, { status: 500 });
  }

  /* a visitor-sent submission: a pull request holding one Markdown file, like worker.js makes */
  function openSubmission(kind, slug, markdown, image) {
    const dir = kind === 'journal' ? 'content/journal/' : 'content/stories/';
    const files = new Map([[dir + slug + '.md', Buffer.from(markdown)]]);
    if (image) files.set((kind === 'journal' ? 'journal' : 'stories') + '/images/' + slug + '.jpg', image);
    const number = pulls.length + 1;
    const snap = new Map(snapshotOf(state.head));
    for (const [p, d] of files) snap.set(p, d);
    const pr = { number, state: 'open', title: (kind === 'journal' ? 'Journal: ' : 'Story: ') + slug, created_at: new Date().toISOString(), ref: kind + '/' + slug + '-abc', head: { sha: addCommit(snap, [state.head], 'submitted') }, files };
    pulls.push(pr);
    return pr;
  }

  return {
    state, fetch: fake, signToken, openSubmission, commits, runs, pulls,
    finishHeldBuild() { state.holdBuild = false; for (const r of runs) if (r.status !== 'completed') finishRun(r); },
    deployNow() { state.holdDeploy = false; state.deployed = state.head; },
    snapshot: (sha = state.head) => snapshotOf(sha),
    text: (path, sha = state.head) => (snapshotOf(sha).get(path) || Buffer.alloc(0)).toString('utf8'),
    has: (path, sha = state.head) => snapshotOf(sha).has(path),
    /* someone else commits to the branch (a different editor, or a merged PR) */
    commitFile(path, content, message = 'Someone else') {
      const snap = new Map(snapshotOf(state.head));
      if (content === null) snap.delete(path); else snap.set(path, Buffer.from(content));
      moveBranch(addCommit(snap, [state.head], message));
    },
    install() { this.original = globalThis.fetch; globalThis.fetch = fake; },
    uninstall() { globalThis.fetch = this.original; },
    jwk,
  };
}
