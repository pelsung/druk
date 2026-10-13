/* ==========================================================================
   Druk.help — editorial dashboard API (part of the druk-studio Worker)

   Everything under /admin/api/ is for the editor's dashboard (/admin/). It is
   kept apart from the public POST /submit endpoint in worker.js, and every
   request here is checked on its own:

     1. Cloudflare Access must have signed the request (Cf-Access-Jwt-Assertion).
        The signature, issuer, audience and expiry are verified here — the
        email header is never trusted — and the email must be on the editor list.
     2. Changes (anything but GET) must come from the dashboard itself: a custom
        header and a same-origin request, which a page on another site cannot send.
     3. The browser never names a file. It names a kind ("journal" | "story") and
        a file name; the path is built here and can only be inside
        content/journal/ or content/stories/.

   Writes go straight to the live branch through the Git data API, as ONE commit
   per action (so a delete never half-happens), and are refused with 409 when the
   file changed since the editor opened it. The existing GitHub Action then
   rebuilds the pages; /deploy reports whether that and the site deploy finished.

   Config (wrangler.toml and secrets — see studio-api/README.md):
     GITHUB_TOKEN        secret; contents + pull requests (+ actions) on this repo
     ACCESS_TEAM_DOMAIN  e.g. myteam.cloudflareaccess.com
     ACCESS_AUD          the Access application's Audience (AUD) tag
     EDITOR_EMAILS       comma-separated emails allowed to manage content
     ADMIN_EMAILS        optional; when set, only these may delete permanently
     ADMIN_ORIGIN        optional extra allowed Origin (the site's own is always allowed)
     SITE_ORIGIN         the public site, for checking what is live (default https://druk.help)
     AUDIT               optional KV namespace for the activity log
     HIDE_EDITOR_EMAIL   "1" to record a short code instead of the email in commits
   ========================================================================== */

import '../journal/sync-core.js';

const core = globalThis.DrukJournal;

const WORKFLOW = 'publish-stories.yml';
const MAX_JSON = 1024 * 1024;
const MAX_TEXT = 100000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;

const KINDS = {
  journal: {
    label: 'journal entry', dir: 'content/journal', pages: 'journal', list: 'journal/entries.js',
    parseList: (s) => core.parseEntriesFile(s), writeList: (items) => core.entriesFile(items),
  },
  story: {
    label: 'story', dir: 'content/stories', pages: 'stories', list: 'content/stories.js',
    parseList: (s) => core.parseEntriesFile(s), writeList: (items) => core.storiesFile(items),
  },
};

/* ---------- entry point ---------- */

export async function handleAdmin(request, env) {
  try {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/admin\/api/, '').replace(/\/+$/, '') || '/';
    const method = request.method;

    /* 1. who is this? (fails closed: unconfigured or unsigned means no) */
    const who = await authenticate(request, env);

    /* 2. a change must come from the dashboard, not from another website */
    if (method !== 'GET') guardAgainstCrossSite(request, env);
    if (method !== 'GET' && method !== 'POST' && method !== 'PUT') throw fail(405, 'Method not allowed');

    const gh = github(env);
    const ctx = { env, gh, who, url, request };

    if (route === '/me' && method === 'GET') return reply(200, { email: who.email, canDelete: canDelete(who.email, env) });
    if (route === '/content' && method === 'GET') return reply(200, await listContent(ctx));
    if (route === '/item' && method === 'GET') return reply(200, await readItem(ctx));
    if (route === '/item' && method === 'PUT') return reply(200, await saveItem(ctx, await readJson(request)));
    if (route === '/item/status' && method === 'POST') return reply(200, await setStatus(ctx, await readJson(request)));
    if (route === '/item/delete' && method === 'POST') return reply(200, await deleteItem(ctx, await readJson(request)));
    if (route === '/pending' && method === 'GET') return reply(200, await readPending(ctx));
    if (route === '/pending/merge' && method === 'POST') return reply(200, await mergePending(ctx, await readJson(request)));
    if (route === '/pending/close' && method === 'POST') return reply(200, await closePending(ctx, await readJson(request)));
    if (route === '/deploy' && method === 'GET') return reply(200, await deployStatus(ctx));
    if (route === '/audit' && method === 'GET') return reply(200, await readAudit(ctx));
    throw fail(404, 'Not found');
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.log('admin error', status, String(error.detail || error.message).slice(0, 300));
    return reply(status, { error: status >= 500 && !error.expose ? 'Something went wrong on the server. Nothing was changed.' : error.message, code: error.code, errors: error.errors });
  }
}

/* ---------- authentication and authorisation ---------- */

const keyCache = { at: 0, keys: [] };

/* for tests, which swap the signing key between runs */
export function resetAccessKeys() { keyCache.at = 0; keyCache.keys = []; }

async function authenticate(request, env) {
  /* only for the offline demo (studio-api/admin-dev.mjs), never in production */
  const host = new URL(request.url).hostname;
  if (env.LOCAL_DEV === '1' && (host === 'localhost' || host === '127.0.0.1') && env.DEV_AUTH_EMAIL) {
    return { email: String(env.DEV_AUTH_EMAIL).toLowerCase() };
  }

  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const editors = emailList(env.EDITOR_EMAILS);
  if (!team || !env.ACCESS_AUD || !editors.length) {
    throw fail(503, 'The dashboard has not been set up yet. See studio-api/README.md.', 'not_configured');
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw fail(401, 'Please sign in.', 'unauthenticated');
  let claims;
  try { claims = await verifyJwt(token, team, env.ACCESS_AUD); } catch { throw fail(401, 'Your sign-in could not be verified. Please sign in again.', 'unauthenticated'); }
  const email = String(claims.email || '').toLowerCase();
  if (!email || !editors.concat(emailList(env.ADMIN_EMAILS)).includes(email)) {
    throw fail(403, 'This account is not allowed to manage the site.', 'forbidden');
  }
  return { email };
}

async function verifyJwt(token, team, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('shape');
  const header = JSON.parse(utf8(b64urlBytes(parts[0])));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('alg');

  let jwk = (await accessKeys(team, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('kid');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!good) throw new Error('signature');

  const claims = JSON.parse(utf8(b64urlBytes(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  const audience = [].concat(claims.aud || []);
  if (claims.iss !== 'https://' + team) throw new Error('iss');
  if (!audience.includes(aud)) throw new Error('aud');
  if (!claims.exp || claims.exp < now - 30) throw new Error('exp');
  if (claims.nbf && claims.nbf > now + 30) throw new Error('nbf');
  return claims;
}

async function accessKeys(team, force) {
  if (!force && keyCache.keys.length && Date.now() - keyCache.at < 3600000) return keyCache.keys;
  if (force && Date.now() - keyCache.at < 60000 && keyCache.keys.length) return keyCache.keys;   /* don't hammer */
  const response = await fetch('https://' + team + '/cdn-cgi/access/certs');
  if (!response.ok) throw new Error('certs');
  keyCache.keys = (await response.json()).keys || [];
  keyCache.at = Date.now();
  return keyCache.keys;
}

function canDelete(email, env) {
  const admins = emailList(env.ADMIN_EMAILS);
  return !admins.length || admins.includes(email);
}

function guardAgainstCrossSite(request, env) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') throw fail(403, 'Request refused.', 'cross_site');
  if (request.headers.get('X-Druk-Admin') !== '1') throw fail(403, 'Request refused.', 'cross_site');
  const origin = request.headers.get('Origin');
  if (origin) {
    const allowed = [new URL(request.url).origin].concat(emailList(env.ADMIN_ORIGIN).map((o) => o.replace(/\/+$/, '')));
    if (!allowed.includes(origin)) throw fail(403, 'Request refused.', 'cross_site');
  }
}

/* ---------- reading ---------- */

async function listContent(ctx) {
  const { gh } = ctx;
  const head = await headSha(gh);
  const data = await gh.graphql(
    `query($owner:String!,$name:String!,$j:String!,$s:String!,$jl:String!,$sl:String!){repository(owner:$owner,name:$name){
      j:object(expression:$j){...on Tree{entries{name oid object{...on Blob{text}}}}}
      s:object(expression:$s){...on Tree{entries{name oid object{...on Blob{text}}}}}
      jl:object(expression:$jl){...on Blob{text}}
      sl:object(expression:$sl){...on Blob{text}}}}`,
    { owner: gh.owner, name: gh.repoName, j: head + ':' + KINDS.journal.dir, s: head + ':' + KINDS.story.dir,
      jl: head + ':' + KINDS.journal.list, sl: head + ':' + KINDS.story.list });
  const repo = data.repository || {};
  const trees = { journal: repo.j, story: repo.s };
  const lists = { journal: repo.jl, story: repo.sl };

  const items = [];
  for (const kind of Object.keys(KINDS)) {
    const seen = new Set();
    for (const entry of (trees[kind] && trees[kind].entries) || []) {
      const id = markdownId(entry.name);
      if (!id || !entry.object || typeof entry.object.text !== 'string') continue;
      let parsed;
      try { parsed = core.parseStoryMarkdown(entry.object.text); } catch { continue; }
      const { meta } = parsed;
      const slug = core.slugify(id);
      seen.add(slug);
      items.push({
        kind, id, slug, sha: entry.oid,
        title: meta.title || id, author: meta.author || '', date: meta.date || '',
        category: meta.category || '',
        status: String(meta.status || '').toLowerCase() === 'draft' ? 'draft' : 'published',
        url: KINDS[kind].pages + '/' + slug + '.html',
      });
    }
    /* pages made by hand have a line in the list but no Markdown file: they
       can be seen here, not edited */
    let listed = [];
    try { listed = lists[kind] && lists[kind].text ? KINDS[kind].parseList(lists[kind].text) : []; } catch { listed = []; }
    for (const entry of listed) {
      if (!entry.slug || seen.has(entry.slug)) continue;
      items.push({
        kind, id: null, slug: entry.slug, sha: null, legacy: true,
        title: entry.title || entry.slug, author: entry.author || '', date: entry.date || '',
        category: entry.category || '', status: 'published',
        url: KINDS[kind].pages + '/' + entry.slug + '.html',
      });
    }
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title));

  const pending = await listPending(gh);
  const count = (kind, status) => items.filter((i) => i.kind === kind && i.status === status).length;
  return {
    items, pending,
    stats: {
      publishedStories: count('story', 'published'), publishedJournals: count('journal', 'published'),
      pending: pending.length, drafts: items.filter((i) => i.status === 'draft').length,
    },
    head,
  };
}

async function readItem(ctx) {
  const { gh, url } = ctx;
  const target = target_(url.searchParams.get('kind'), url.searchParams.get('id'));
  const file = await gh.read(target.path, await headSha(gh));
  if (!file) throw fail(404, 'That ' + target.conf.label + ' was not found. It may have been deleted.', 'missing');
  const parsed = core.parseStoryMarkdown(file.text);
  return {
    kind: target.kind, id: target.id, slug: core.slugify(target.id), sha: file.sha,
    status: String(parsed.meta.status || '').toLowerCase() === 'draft' ? 'draft' : 'published',
    meta: pick(parsed.meta, ['title', 'author', 'date', 'category', 'excerpt', 'image', 'imageAlt', 'caption']),
    body: parsed.body,
  };
}

/* ---------- editing ---------- */

const EDITABLE = {
  journal: ['title', 'author', 'date', 'excerpt', 'caption'],
  story: ['title', 'author', 'date', 'category', 'excerpt', 'imageAlt'],
};

async function saveItem(ctx, input) {
  const target = target_(input.kind, input.id);
  const incoming = checkFields(target.kind, input.meta, input.body);
  if (!input.sha) throw fail(400, 'Missing version of the file.');
  const wantsPublic = input.publish === true;
  let title = incoming.meta.title;

  const result = await run(ctx, 'edited', target, title, 'Dashboard: ' + (wantsPublic ? 'saved and published' : 'saved') + ' "' + title + '"', async (read, set) => {
    const file = await read(target.path);
    if (!file) throw fail(404, 'That ' + target.conf.label + ' was not found. It may have been deleted.', 'missing');
    if (file.sha !== input.sha) throw conflict();
    set.sha = file.sha;
    const next = applyEdit(file.text, incoming.meta, incoming.body, wantsPublic ? 'published' : undefined);
    if (next === file.text) return [];
    return [{ path: target.path, content: next }];
  });
  return {
    ...result, title,
    expect: result.unchanged || (!wantsPublic && isDraft(result.after)) ? 'none' : 'updated',
    kind: target.kind, slug: core.slugify(target.id),
  };
}

async function setStatus(ctx, input) {
  const target = target_(input.kind, input.id);
  if (input.status !== 'published' && input.status !== 'draft') throw fail(400, 'Choose published or unpublished.');
  if (!input.sha) throw fail(400, 'Missing version of the file.');
  let title = '';
  const verb = input.status === 'draft' ? 'unpublished' : 'published';
  const result = await run(ctx, verb, target, '', null, async (read, set) => {
    const file = await read(target.path);
    if (!file) throw fail(404, 'That ' + target.conf.label + ' was not found. It may have been deleted.', 'missing');
    if (file.sha !== input.sha) throw conflict();
    set.sha = file.sha;
    title = core.parseStoryMarkdown(file.text).meta.title || target.id;
    set.message = 'Dashboard: ' + verb + ' "' + title + '"';
    const next = applyEdit(file.text, {}, null, input.status);
    if (next === file.text) return [];
    return [{ path: target.path, content: next }];
  });
  return { ...result, title, expect: result.unchanged ? 'none' : input.status === 'draft' ? 'absent' : 'live', kind: target.kind, slug: core.slugify(target.id) };
}

async function deleteItem(ctx, input) {
  const { env, who } = ctx;
  if (!canDelete(who.email, env)) throw fail(403, 'Only an administrator can delete permanently. You can unpublish instead.', 'forbidden');
  const target = target_(input.kind, input.id);
  if (!input.sha) throw fail(400, 'Missing version of the file.');
  const slug = core.slugify(target.id);
  let title = '';
  let removed = [];
  const result = await run(ctx, 'deleted', target, '', null, async (read, set) => {
    const file = await read(target.path);
    if (!file) throw fail(404, 'That ' + target.conf.label + ' was already deleted.', 'missing');
    if (file.sha !== input.sha) throw conflict();
    const meta = core.parseStoryMarkdown(file.text).meta;
    title = meta.title || target.id;
    /* the editor must have read and confirmed this very title */
    if (String(input.confirmTitle || '').trim() !== title.trim()) throw fail(400, 'The confirmation did not match the title. Nothing was deleted.', 'confirm');
    set.message = 'Dashboard: deleted "' + title + '"';

    const changes = [{ path: target.path, delete: true }];
    const page = target.conf.pages + '/' + slug + '.html';
    if (await read(page)) changes.push({ path: page, delete: true });

    const list = await read(target.conf.list);
    if (list) {
      let items = [];
      try { items = target.conf.parseList(list.text); } catch { items = null; }
      if (items && items.some((i) => i.slug === slug)) {
        changes.push({ path: target.conf.list, content: target.conf.writeList(items.filter((i) => i.slug !== slug)) });
      }
    }

    /* its photo goes too, unless another piece still uses it */
    const image = String(meta.image || '').replace(new RegExp('^/?' + target.conf.pages + '/'), '');
    if (/^images\/[A-Za-z0-9._-]+$/.test(image)) {
      const imagePath = target.conf.pages + '/' + image;
      if (await read(imagePath) && !(await imageStillUsed(read, target, image))) changes.push({ path: imagePath, delete: true });
    }
    removed = changes.map((c) => c.path);
    return changes;
  });
  return { ...result, title, removed, expect: 'absent', kind: target.kind, slug };
}

async function imageStillUsed(read, target, image) {
  const others = await read.list(target.conf.dir);
  for (const name of others) {
    if (name === target.id + '.md' || !markdownId(name)) continue;
    const file = await read(target.conf.dir + '/' + name);
    if (file && file.text.includes(image)) return true;
  }
  return false;
}

/* ---------- one commit per action ---------- */

async function run(ctx, action, target, title, message, plan) {
  const { gh, env, who } = ctx;
  const set = { message };
  let committed;
  try {
    committed = await commitChanges(gh, set, (read) => plan(read, set), () => editorLabel(who.email, env));
  } catch (error) {
    await audit(ctx, { action, kind: target.kind, slug: core.slugify(target.id), title, ok: false, detail: error.code || String(error.message).slice(0, 120) });
    throw error;
  }
  const after = committed.files.find((f) => f.path === target.path);
  await audit(ctx, {
    action: committed.unchanged ? action + ' (no change)' : action,
    kind: target.kind, slug: core.slugify(target.id), title, ok: true, commit: committed.unchanged ? undefined : committed.sha,
  });
  return {
    ok: true, unchanged: !!committed.unchanged, commit: committed.unchanged ? null : committed.sha,
    sha: committed.unchanged ? set.sha : after && !after.delete ? after.blobSha : undefined, after: after && after.content,
  };
}

async function commitChanges(gh, set, plan, editor) {
  for (let attempt = 0; ; attempt++) {
    const head = await headSha(gh);
    const headCommit = await gh('/git/commits/' + head);
    const read = gh.reader(head);
    const files = await plan(read);
    if (!files.length) return { unchanged: true, sha: head, files: [] };
    const tree = await gh('/git/trees', {
      method: 'POST',
      body: {
        base_tree: headCommit.tree.sha,
        tree: files.map((f) => f.delete
          ? { path: f.path, mode: '100644', type: 'blob', sha: null }
          : { path: f.path, mode: '100644', type: 'blob', content: f.content }),
      },
    });
    const message = (set.message || 'Dashboard change') + '\n\nEdited-by: ' + await editor() + '\nVia: Druk.help dashboard';
    const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [head] } });
    try {
      await gh('/git/refs/heads/' + encodeURIComponent(gh.branch), { method: 'PATCH', body: { sha: commit.sha, force: false } });
    } catch (error) {
      /* someone (usually the publish bot) moved the branch meanwhile: look again;
         if the file itself changed, plan() will now say so with a 409 */
      if (error.status === 422 && attempt < 2) continue;
      throw error;
    }
    const blobs = new Map();
    for (const e of tree.tree || []) blobs.set(e.path, e.sha);
    return { sha: commit.sha, files: files.map((f) => ({ ...f, blobSha: blobs.get(f.path) })) };
  }
}

/* ---------- Markdown files: change only what the editor changed ---------- */

/* Rewrites the changed header lines and the body of a content file, leaving
   every other line (and the order of the header) exactly as it was. */
export function applyEdit(source, changes, body, status) {
  const match = String(source).match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!match) throw fail(422, 'That file does not have the usual header, so it cannot be edited here.', 'format');
  const eol = match[1].includes('\r\n') ? '\r\n' : '\n';
  const current = core.parseStoryMarkdown(source);
  let lines = match[2].split(/\r?\n/);

  const set = (key, value) => {
    const index = lines.findIndex((l) => new RegExp('^' + key + ':').test(l));
    const have = index === -1 ? undefined : current.meta[key];
    if (value === '' || value === undefined || value === null) {
      if (index !== -1) lines.splice(index, 1);
      return;
    }
    if (have === value) return;
    const line = key + ': ' + JSON.stringify(String(value));
    if (index === -1) lines.push(line); else lines[index] = line;
  };
  Object.keys(changes || {}).forEach((key) => set(key, changes[key]));
  if (status === 'draft') set('status', 'draft');
  if (status === 'published') set('status', '');

  let text = lines.join(eol);
  let rest = match[4];
  if (body !== null && body !== undefined) {
    const same = normaliseBody(body) === normaliseBody(current.body);
    if (!same) {
      const lead = rest.match(/^\s*/)[0];
      rest = (/\n/.test(lead) ? lead : eol + eol) + String(body).replace(/\r?\n/g, eol).trim() + eol;
    }
  }
  return match[1] + text + match[3] + (match[3].endsWith('\n') ? '' : eol) + rest;
}

function normaliseBody(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function isDraft(text) {
  return !!text && String(core.parseStoryMarkdown(text).meta.status || '').toLowerCase() === 'draft';
}

/* ---------- validation ---------- */

function checkFields(kind, meta, body) {
  const errors = {};
  meta = meta || {};
  const oneLine = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const clean = {};
  for (const key of EDITABLE[kind]) clean[key] = oneLine(meta[key], key === 'excerpt' ? 400 : 200);

  if (clean.title.length < 3) errors.title = 'Give it a title (at least 3 characters).';
  if (String(meta.title || '').length > 140) errors.title = 'The title is too long (140 characters at most).';
  if (!clean.author) errors.author = 'Add the author’s name.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.date) || Number.isNaN(Date.parse(clean.date + 'T00:00:00Z')) || new Date(clean.date + 'T00:00:00Z').toISOString().slice(0, 10) !== clean.date) {
    errors.date = 'Pick a valid date.';
  }
  if (kind === 'story') {
    clean.category = core.cleanTopic(clean.category);
    if (clean.category.length < 2) errors.category = 'Add the topic, in a word or two.';
  }
  const text = String(body === undefined || body === null ? '' : body).replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!text) errors.body = 'The text cannot be empty.';
  if (text.length > MAX_TEXT) errors.body = 'The text is too long.';
  if (Object.keys(errors).length) throw Object.assign(fail(422, 'Please fix the highlighted fields.', 'invalid'), { errors });
  return { meta: clean, body: text };
}

/* ---------- submissions waiting for review (pull requests) ---------- */

const PR_FILES = [
  /^content\/(journal|stories)\/[A-Za-z0-9_-]+\.md$/,
  /^(journal|stories)\/images\/[A-Za-z0-9._-]+$/,
];

async function listPending(gh) {
  const pulls = await gh('/pulls?state=open&base=' + encodeURIComponent(gh.branch) + '&per_page=50');
  return pulls.filter((p) => /^(journal|story)\//.test(p.head.ref) && p.head.repo && p.head.repo.full_name === gh.full)
    .map((p) => ({
      number: p.number, kind: p.head.ref.startsWith('journal/') ? 'journal' : 'story',
      title: p.title.replace(/^(Journal|Story):\s*/, ''), submittedAt: p.created_at,
    }));
}

async function pendingPull(gh, number) {
  if (!Number.isInteger(number) || number < 1) throw fail(400, 'Bad request');
  const pr = await gh('/pulls/' + number);
  if (!/^(journal|story)\//.test(pr.head.ref) || !pr.head.repo || pr.head.repo.full_name !== gh.full || pr.base.ref !== gh.branch) {
    throw fail(404, 'That is not a submission from the site.', 'not_submission');
  }
  if (pr.state !== 'open') throw fail(409, 'That submission has already been dealt with.', 'already_done');
  const files = await gh('/pulls/' + number + '/files?per_page=100');
  if (!files.length || files.length > 5 || !files.every((f) => PR_FILES.some((re) => re.test(f.filename)) && f.status !== 'removed')) {
    throw fail(409, 'That submission changes files the dashboard does not handle. Review it on GitHub.', 'unexpected_files');
  }
  return { pr, files };
}

async function readPending(ctx) {
  const { gh, url } = ctx;
  const number = Number(url.searchParams.get('number'));
  const { pr, files } = await pendingPull(gh, number);
  const md = files.find((f) => f.filename.endsWith('.md'));
  if (!md) throw fail(409, 'That submission has no text file.', 'unexpected_files');
  const file = await gh.read(md.filename, pr.head.sha);
  if (!file) throw fail(404, 'Not found');
  const parsed = core.parseStoryMarkdown(file.text);
  let photo = null;
  const image = files.find((f) => !f.filename.endsWith('.md'));
  if (image) {
    const raw = await gh('/contents/' + image.filename + '?ref=' + pr.head.sha);
    const type = /\.png$/i.test(image.filename) ? 'image/png' : /\.webp$/i.test(image.filename) ? 'image/webp' : 'image/jpeg';
    if (raw && raw.content && raw.size < 3 * 1024 * 1024) photo = 'data:' + type + ';base64,' + raw.content.replace(/\s/g, '');
  }
  const kind = md.filename.startsWith('content/journal/') ? 'journal' : 'story';
  return {
    number, kind, id: markdownId(md.filename.split('/').pop()), submittedAt: pr.created_at,
    meta: pick(parsed.meta, ['title', 'author', 'date', 'category', 'excerpt', 'image', 'imageAlt', 'caption']),
    body: parsed.body, photo,
  };
}

async function mergePending(ctx, input) {
  const { gh } = ctx;
  const number = Number(input.number);
  const { pr, files } = await pendingPull(gh, number);
  const md = files.find((f) => f.filename.endsWith('.md'));
  const kind = md.filename.startsWith('content/journal/') ? 'journal' : 'story';
  const id = markdownId(md.filename.split('/').pop());
  const title = pr.title.replace(/^(Journal|Story):\s*/, '');
  let merged;
  try {
    merged = await gh('/pulls/' + number + '/merge', {
      method: 'PUT',
      body: { merge_method: 'merge', sha: pr.head.sha, commit_title: 'Approved in the dashboard: ' + title,
        commit_message: 'Approved-by: ' + await editorLabel(ctx.who.email, ctx.env) + '\nVia: Druk.help dashboard' },
    });
  } catch (error) {
    await audit(ctx, { action: 'approved', kind, slug: core.slugify(id), title, ok: false, detail: error.code || 'merge_failed' });
    if (error.status === 405 || error.status === 409 || error.status === 422) {
      throw fail(409, 'This submission could not be approved automatically (it may have changed or conflict with other changes). Review it on GitHub.', 'merge_failed');
    }
    throw error;
  }
  await audit(ctx, { action: 'approved', kind, slug: core.slugify(id), title, ok: true, commit: merged.sha });
  return { ok: true, commit: merged.sha, title, kind, slug: core.slugify(id), expect: 'live' };
}

async function closePending(ctx, input) {
  const { gh } = ctx;
  const number = Number(input.number);
  const { pr } = await pendingPull(gh, number);
  const title = pr.title.replace(/^(Journal|Story):\s*/, '');
  const kind = pr.head.ref.startsWith('journal/') ? 'journal' : 'story';
  try { await gh('/pulls/' + number, { method: 'PATCH', body: { state: 'closed' } }); } catch (error) {
    await audit(ctx, { action: 'declined', kind, title, ok: false, detail: error.code });
    throw error;
  }
  await audit(ctx, { action: 'declined', kind, title, ok: true });
  return { ok: true, title };
}

/* ---------- did it reach the live site? ---------- */

async function deployStatus(ctx) {
  const { gh, env, url } = ctx;
  const sha = url.searchParams.get('sha') || '';
  const expect = url.searchParams.get('expect') || 'none';
  const kind = url.searchParams.get('kind');
  const slug = url.searchParams.get('slug') || '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw fail(400, 'Bad request');
  if (!['live', 'absent', 'updated', 'none'].includes(expect)) throw fail(400, 'Bad request');
  const conf = KINDS[kind];
  if (expect !== 'none' && (!conf || !/^[a-z0-9-]{1,100}$/.test(slug))) throw fail(400, 'Bad request');

  /* 1. the publish workflow that rebuilds the pages for this commit */
  const runs = await gh('/actions/workflows/' + WORKFLOW + '/runs?head_sha=' + sha + '&per_page=5');
  const run = (runs.workflow_runs || [])[0];
  if (!run) {
    const age = Date.now() - Date.parse((await gh('/git/commits/' + sha)).committer.date);
    return age > 120000
      ? { state: 'build_missing', message: 'The saved change did not start a rebuild. An administrator should check GitHub Actions.' }
      : { state: 'building', message: 'Saved. Waiting for the site rebuild to start…' };
  }
  if (run.status !== 'completed') return { state: 'building', message: 'Saved. Rebuilding the site…', detail: run.html_url };
  if (run.conclusion !== 'success') {
    /* Two quick saves make the first rebuild's push lose the race to the second
       commit; the second rebuild then includes both. So a failed run only counts
       when no newer run took over. */
    const recent = await gh('/actions/workflows/' + WORKFLOW + '/runs?branch=' + encodeURIComponent(gh.branch) + '&per_page=10');
    const newer = (recent.workflow_runs || []).filter((r) => r.head_sha !== sha && Date.parse(r.created_at) > Date.parse(run.created_at));
    if (newer.some((r) => r.status !== 'completed')) return { state: 'building', message: 'Saved. Rebuilding the site (a newer change is being built too)…' };
    if (!newer.some((r) => r.conclusion === 'success')) {
      return { state: 'build_failed', message: 'The change was saved, but the site rebuild failed, so it is not live yet. Tell an administrator.', detail: run.html_url, conclusion: run.conclusion };
    }
  }

  /* 2. the hosting build for whatever is on the branch now (the bot's commit follows ours) */
  const head = await headSha(gh);
  const checks = await gh('/commits/' + head + '/check-runs?per_page=50').catch(() => ({ check_runs: [] }));
  const hosting = (checks.check_runs || []).filter((c) => /cloudflare|workers|pages|deploy/i.test(c.name + ' ' + ((c.app && c.app.slug) || '')));
  const waiting = hosting.find((c) => c.status !== 'completed');
  if (waiting) return { state: 'deploying', message: 'Rebuilt. Publishing to the website…' };
  const bad = hosting.find((c) => !['success', 'neutral', 'skipped'].includes(c.conclusion));
  if (bad) return { state: 'deploy_failed', message: 'The change was saved and rebuilt, but publishing to the website failed. Tell an administrator.', detail: bad.html_url || bad.details_url };

  /* 3. look at the real website */
  if (expect === 'none') return { state: 'live', message: 'Done.' };
  const origin = String(env.SITE_ORIGIN || core.SITE_ORIGIN).replace(/\/+$/, '');
  const pagePath = conf.pages + '/' + slug + '.html';
  const live = await fetch(origin + '/' + pagePath + '?check=' + Date.now(), { redirect: 'manual', cache: 'no-store' }).catch(() => null);
  if (!live) return { state: 'deploying', message: 'Checking the website…' };

  if (expect === 'absent') {
    return live.status === 404
      ? { state: 'live', message: 'It is no longer on the website.' }
      : { state: 'deploying', message: 'Waiting for the website to stop showing it…' };
  }
  if (live.status !== 200) return { state: 'deploying', message: 'Waiting for the website to show it…' };
  const expected = await gh.read(pagePath, head);
  if (!expected) return { state: 'deploying', message: 'Waiting for the page to be built…' };
  const same = (await live.text()).replace(/\r\n/g, '\n') === expected.text.replace(/\r\n/g, '\n');
  return same
    ? { state: 'live', message: 'It is live on the website.' }
    : { state: 'deploying', message: 'Published; waiting for the website to show the new version…' };
}

/* ---------- activity log ---------- */

async function audit(ctx, event) {
  const record = { at: new Date().toISOString(), by: ctx.who.email, ...event };
  console.log('audit', JSON.stringify(record));
  const kv = ctx.env.AUDIT;
  if (kv) {
    try {
      const key = 'audit:' + String(9999999999999 - Date.now()).padStart(13, '0') + ':' + crypto.randomUUID().slice(0, 8);
      await kv.put(key, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 });
    } catch (error) { console.log('audit write failed', String(error.message).slice(0, 100)); }
  }
}

async function readAudit(ctx) {
  const { env, gh } = ctx;
  if (env.AUDIT) {
    const list = await env.AUDIT.list({ prefix: 'audit:', limit: 100 });
    const records = await Promise.all(list.keys.map(async (k) => { try { return JSON.parse(await env.AUDIT.get(k.name)); } catch { return null; } }));
    return { source: 'log', records: records.filter(Boolean) };
  }
  /* without the optional log, successful actions are still in the commit history */
  const commits = await gh('/commits?sha=' + encodeURIComponent(gh.branch) + '&per_page=100');
  return {
    source: 'history',
    records: commits.filter((c) => /^(Dashboard|Approved in the dashboard):/.test(c.commit.message)).map((c) => {
      const by = /^(?:Edited|Approved)-by: (.+)$/m.exec(c.commit.message);
      return { at: c.commit.committer.date, by: by ? by[1] : '', action: c.commit.message.split('\n')[0].replace(/^[^:]+:\s*/, ''), ok: true, commit: c.sha };
    }),
  };
}

async function editorLabel(email, env) {
  if (env.HIDE_EDITOR_EMAIL !== '1') return email;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return 'editor-' + Array.from(new Uint8Array(digest)).slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- GitHub ---------- */

function github(env) {
  if (!env.GITHUB_TOKEN || !env.REPO) throw fail(503, 'The dashboard has not been set up yet. See studio-api/README.md.', 'not_configured');
  const api = 'https://api.github.com/repos/' + env.REPO;
  const headers = (extra) => ({
    Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json', 'User-Agent': 'druk-admin', 'X-GitHub-Api-Version': '2022-11-28', ...extra,
  });

  const check = async (response, path) => {
    if (response.ok) return;
    const text = (await response.text()).slice(0, 300);
    console.log('GitHub', response.status, path.split('?')[0], text);   /* detail stays in the log */
    const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if (limited) throw Object.assign(fail(429, 'GitHub is busy right now. Wait a minute and try again.', 'rate_limited'), { expose: true });
    if (response.status === 404) throw Object.assign(fail(404, 'Not found.', 'github_404'), { expose: true });
    if (response.status === 401 || response.status === 403) throw Object.assign(fail(502, 'The site’s connection to GitHub was refused. An administrator needs to check the access token.', 'github_auth'), { expose: true });
    if (response.status === 409 || response.status === 422 || response.status === 405) throw Object.assign(fail(response.status === 405 ? 409 : response.status, 'GitHub did not accept the change.', 'github_conflict'), { expose: true, detail: text });
    throw Object.assign(fail(502, 'GitHub is not responding properly. Nothing was changed; try again.', 'github_error'), { expose: true });
  };

  const call = async (path, options = {}) => {
    const response = await fetch(api + path, {
      method: options.method || 'GET', headers: headers(),
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    await check(response, path);
    return response.json();
  };
  const [owner, name] = String(env.REPO).split('/');
  call.owner = owner; call.repoName = name; call.full = env.REPO;
  call.branch = env.BRANCH || 'main';

  call.graphql = async (query, variables) => {
    const response = await fetch('https://api.github.com/graphql', { method: 'POST', headers: headers(), body: JSON.stringify({ query, variables }) });
    await check(response, '/graphql');
    const data = await response.json();
    if (data.errors && !data.data) { console.log('GitHub graphql', JSON.stringify(data.errors).slice(0, 300)); throw fail(502, 'GitHub is not responding properly. Try again.', 'github_error'); }
    return data.data;
  };

  /* { sha, text } for a file at a commit, or null when there is none */
  call.read = async (path, ref) => {
    try {
      const file = await call('/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + ref);
      if (Array.isArray(file) || file.type !== 'file') return null;
      return { sha: file.sha, text: utf8(base64Bytes(file.content || '')) };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  };
  call.reader = (ref) => {
    const cache = new Map();
    const read = async (path) => {
      if (!cache.has(path)) cache.set(path, call.read(path, ref));
      return cache.get(path);
    };
    read.list = async (dir) => {
      const listing = await call('/contents/' + dir + '?ref=' + ref).catch((e) => { if (e.status === 404) return []; throw e; });
      return listing.filter((f) => f.type === 'file').map((f) => f.name);
    };
    return read;
  };
  return call;
}

async function headSha(gh) {
  return (await gh('/git/ref/heads/' + encodeURIComponent(gh.branch))).object.sha;
}

/* ---------- small helpers ---------- */

function target_(kind, id) {
  const conf = KINDS[kind];
  if (!conf) throw fail(400, 'Bad request');
  if (typeof id !== 'string' || !ID_RE.test(id)) throw fail(400, 'Bad request');
  if (id.toLowerCase() === 'readme' || id.startsWith('_')) throw fail(400, 'Bad request');
  return { kind, conf, id, path: conf.dir + '/' + id + '.md' };
}

function markdownId(filename) {
  if (!/\.md$/.test(filename)) return null;
  const id = filename.replace(/\.md$/, '');
  return ID_RE.test(id) && id.toLowerCase() !== 'readme' && !id.startsWith('_') ? id : null;
}

function pick(object, keys) {
  const out = {};
  keys.forEach((k) => { if (object[k] !== undefined) out[k] = object[k]; });
  return out;
}

function emailList(value) {
  return String(value || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

async function readJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_JSON) throw fail(413, 'That is too large.');
  if (!/application\/json/i.test(request.headers.get('Content-Type') || '')) throw fail(415, 'Bad request');
  let body;
  try { body = await request.json(); } catch { throw fail(400, 'Bad request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Bad request');
  return body;
}

function conflict() {
  return fail(409, 'Someone else changed this while you were editing it. Reload it to see their version before saving.', 'conflict');
}

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code, expose: status < 500 });
}

function base64Bytes(text) {
  const binary = atob(String(text).replace(/\s/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function b64urlBytes(text) {
  return base64Bytes(String(text).replace(/-/g, '+').replace(/_/g, '/'));
}

function utf8(bytes) {
  return new TextDecoder().decode(bytes);
}
