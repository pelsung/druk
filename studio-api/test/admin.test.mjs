import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../worker.js';
import { createFakeGitHub } from './fake-github.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PASSWORD = 'correct horse battery staple';
const ENV = { GITHUB_TOKEN: 'test-token-not-real', REPO: 'pelsung/druk', BRANCH: 'main', ADMIN_PASSWORD: PASSWORD };
const SITE = 'https://druk.help';

let fake;
beforeEach(() => { session = null; fake = createFakeGitHub({ root: ROOT }); fake.install(); });
afterEach(() => { fake.uninstall(); });

const post = { 'X-Druk-Admin': '1', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: SITE };

async function rawLogin(password, env = ENV) {
  return worker.fetch(new Request(SITE + '/admin/api/login', { method: 'POST', headers: post, body: JSON.stringify({ password }) }), env);
}
let session;
async function signedIn(env = ENV) {
  const res = await rawLogin(PASSWORD, env);
  return /druk_admin=[^;]+/.exec(res.headers.get('Set-Cookie'))[0];
}

async function api(method, path, { body, token, env = ENV, headers = {}, raw } = {}) {
  const cookie = token === undefined ? (session ||= await signedIn(env)) : token;
  const h = { ...(method === 'GET' ? {} : post), ...headers };
  if (cookie) h.Cookie = cookie;
  const response = await worker.fetch(new Request(SITE + '/admin/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await response.text();
  return { status: response.status, body: raw ? text : (text ? JSON.parse(text) : null) };
}

const firstJournal = async () => (await api('GET', '/content')).body.items.find((i) => i.kind === 'journal' && !i.legacy && i.status === 'published');
const openItem = async (item) => (await api('GET', `/item?kind=${item.kind}&id=${item.id}`)).body;

/* ---------- 2. who may call the API ---------- */

test('the right password signs in; a wrong one does not', async () => {
  const bad = await rawLogin('not the password');
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).code, 'bad_password');
  assert.equal(bad.headers.get('Set-Cookie'), null);
  assert.equal((await rawLogin('')).status, 401);

  const good = await rawLogin(PASSWORD);
  assert.equal(good.status, 200);
  const header = good.headers.get('Set-Cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Max-Age=43200/);
  assert.doesNotMatch(header, new RegExp(PASSWORD));
});

test('without a valid session cookie nothing is returned and GitHub is never touched', async () => {
  const good = await signedIn();
  const [name, value] = good.split('=');
  const [expires, mac] = value.split('.');
  const other = await (async () => { const r = await rawLogin('a completely different one', { ...ENV, ADMIN_PASSWORD: 'a completely different one' }); return /druk_admin=[^;]+/.exec(r.headers.get('Set-Cookie'))[0]; })();
  for (const [label, cookie] of [
    ['no cookie', null],
    ['garbage', 'druk_admin=abc'],
    ['empty', 'druk_admin='],
    ['expired', 'druk_admin=' + (Date.now() - 1000) + '.' + mac],
    ['extended expiry (forged)', 'druk_admin=' + (Number(expires) + 99999999) + '.' + mac],
    ['signed with another password', other],
  ]) {
    const res = await api('GET', '/content', { token: cookie });
    assert.equal(res.status, 401, label);
    assert.equal(res.body.items, undefined, label);
    assert.equal((await api('PUT', '/item', { token: cookie, body: { kind: 'journal', id: 'the-beginning' } })).status, 401, label);
  }
  assert.equal(fake.state.calls.length, 0);
});

test('the dashboard refuses to run without a strong password set', async () => {
  for (const env of [{ ...ENV, ADMIN_PASSWORD: '' }, { ...ENV, ADMIN_PASSWORD: 'short' }, { ...ENV, ADMIN_PASSWORD: undefined }]) {
    assert.equal((await rawLogin('short', env)).status, 503);
    assert.equal((await api('GET', '/content', { env, token: 'druk_admin=1.2' })).status, 503);
  }
});

test('signed in, the editor can open the dashboard; logging out clears the cookie', async () => {
  assert.equal((await api('GET', '/me')).status, 200);
  const out = await worker.fetch(new Request(SITE + '/admin/api/logout', { method: 'POST', headers: post }), ENV);
  assert.match(out.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('changes must come from the dashboard, not another site', async () => {
  const base = { kind: 'journal', id: 'the-beginning', sha: 'x' };
  assert.equal((await api('POST', '/item/status', { body: { ...base, status: 'draft' }, headers: { 'X-Druk-Admin': '' } })).status, 403);
  assert.equal((await api('POST', '/item/status', { body: { ...base, status: 'draft' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await api('POST', '/item/status', { body: { ...base, status: 'draft' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await worker.fetch(new Request(SITE + '/admin/api/login', { method: 'POST', headers: { ...post, Origin: 'https://evil.example' }, body: JSON.stringify({ password: PASSWORD }) }), ENV)).status, 403, 'login from another site');
  assert.equal(fake.state.calls.filter((c) => c.startsWith('POST') || c.startsWith('PATCH')).length, 0);
});

test('the public submission endpoint still answers as before', async () => {
  const preflight = await worker.fetch(new Request(SITE + '/submit', { method: 'OPTIONS' }), { ...ENV, ALLOWED_ORIGIN: '*' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  const bad = await worker.fetch(new Request(SITE + '/submit', { method: 'POST', body: JSON.stringify({ kind: 'story', title: '' }) }), ENV);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /title/i);
  assert.equal((await worker.fetch(new Request(SITE + '/elsewhere', { method: 'POST' }), ENV)).status, 404);
});

/* ---------- 3. listing, search data ---------- */

test('the dashboard lists the repository’s real stories and journals', async () => {
  const res = await api('GET', '/content');
  assert.equal(res.status, 200);
  const disk = fake.snapshot();
  const mdJournals = [...disk.keys()].filter((p) => /^content\/journal\/[^/]+\.md$/.test(p) && !/README/i.test(p));
  const mdStories = [...disk.keys()].filter((p) => /^content\/stories\/[^/]+\.md$/.test(p) && !/README/i.test(p));
  const journals = res.body.items.filter((i) => i.kind === 'journal' && !i.legacy);
  const stories = res.body.items.filter((i) => i.kind === 'story' && !i.legacy);
  assert.equal(journals.length, mdJournals.length);
  assert.equal(stories.length, mdStories.length);
  assert.equal(res.body.stats.publishedJournals + res.body.stats.publishedStories + res.body.stats.drafts,
    res.body.items.length);
  assert.ok(res.body.items.some((i) => i.legacy), 'hand-made pages are shown, flagged as not editable');
  const loneliness = stories.find((i) => i.id === 'loneliness');
  assert.equal(loneliness.title, 'Loneliness');
  assert.equal(loneliness.author, 'Sonam Rinchen');
  assert.equal(loneliness.status, 'published');
});

/* ---------- 5/6/7. editing ---------- */

test('editing keeps the file format, the URL and untouched fields, and reaches the live site', async () => {
  const item = (await api('GET', '/content')).body.items.find((i) => i.id === 'loneliness');
  const before = fake.text('content/stories/loneliness.md');
  const opened = await openItem(item);
  const res = await api('PUT', '/item', { body: {
    kind: 'story', id: 'loneliness', sha: opened.sha, publish: true,
    meta: { ...opened.meta, title: 'Loneliness, revisited' }, body: opened.body + '\n\nOne more paragraph.',
  } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.expect, 'updated');
  const after = fake.text('content/stories/loneliness.md', res.body.commit);

  /* only the title line changed in the header; every other header line is byte-identical */
  const head = (t) => t.split('\n---\n')[0].split('\n');
  const changed = head(after).filter((l, i) => l !== head(before)[i]);
  assert.deepEqual(changed, ['title: "Loneliness, revisited"']);
  assert.equal(head(after).length, head(before).length);
  assert.ok(after.includes('One more paragraph.'));
  assert.ok(after.includes('imageAlt: "patient home visit"'));
  assert.ok(fake.has('stories/loneliness.html'), 'same URL / file name');
  assert.ok(!fake.has('stories/loneliness-revisited.html'));
  assert.equal(fake.state.calls.filter((c) => c.startsWith('POST /git/commits')).length, 1, 'a single commit');

  /* the Action rebuilt it and the site now serves it */
  const state = (await api('GET', `/deploy?sha=${res.body.commit}&expect=updated&kind=story&slug=loneliness`)).body;
  assert.equal(state.state, 'live', JSON.stringify(state));
  assert.match(fake.text('stories/loneliness.html'), /Loneliness, revisited/);
  assert.match(fake.text('content/stories.js'), /Loneliness, revisited/);
});

test('saving without changes makes no commit', async () => {
  const item = await firstJournal();
  const opened = await openItem(item);
  const res = await api('PUT', '/item', { body: { kind: 'journal', id: item.id, sha: opened.sha, publish: true, meta: opened.meta, body: opened.body } });
  assert.equal(res.status, 200);
  assert.equal(res.body.unchanged, true);
  assert.equal(res.body.expect, 'none');
  assert.equal(res.body.sha, opened.sha);
  assert.equal(fake.state.calls.filter((c) => c.startsWith('POST /git/commits')).length, 0);
});

test('invalid fields are explained, and nothing is written', async () => {
  const item = await firstJournal();
  const opened = await openItem(item);
  const res = await api('PUT', '/item', { body: { kind: 'journal', id: item.id, sha: opened.sha, meta: { ...opened.meta, title: '', date: '2026-13-45', author: '' }, body: '  ' } });
  assert.equal(res.status, 422);
  assert.deepEqual(Object.keys(res.body.errors).sort(), ['author', 'body', 'date', 'title']);
  assert.equal(fake.state.calls.filter((c) => c.startsWith('POST')).length, 0);
});

test('a change made by someone else in the meantime is detected, not overwritten', async () => {
  const item = await firstJournal();
  const opened = await openItem(item);
  const path = 'content/journal/' + item.id + '.md';
  fake.commitFile(path, fake.text(path).replace(/^title: .*/m, 'title: "Edited by somebody else"'));
  const res = await api('PUT', '/item', { body: { kind: 'journal', id: item.id, sha: opened.sha, publish: true, meta: { ...opened.meta, title: 'Mine' }, body: opened.body } });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'conflict');
  assert.match(fake.text(path), /Edited by somebody else/);
});

test('an unrelated push while saving is merged in; a push to the same file is a conflict', async () => {
  const item = await firstJournal();
  const opened = await openItem(item);
  fake.state.branchMovedOnce = () => fake.commitFile('CONTENT.md', fake.text('CONTENT.md') + '\nNote.\n');
  const ok = await api('PUT', '/item', { body: { kind: 'journal', id: item.id, sha: opened.sha, publish: true, meta: { ...opened.meta, caption: 'A new caption' }, body: opened.body } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(fake.text('content/journal/' + item.id + '.md', ok.body.commit), /caption: "A new caption"/);
  assert.match(fake.text('CONTENT.md', ok.body.commit), /Note\./, 'the other change survived');

  const path = 'content/journal/' + item.id + '.md';
  const reopened = await openItem(item);
  fake.state.branchMovedOnce = () => fake.commitFile(path, fake.text(path).replace('A new caption', 'Theirs'));
  const clash = await api('PUT', '/item', { body: { kind: 'journal', id: item.id, sha: reopened.sha, publish: true, meta: { ...reopened.meta, caption: 'Mine again' }, body: reopened.body } });
  assert.equal(clash.status, 409);
  assert.match(fake.text(path), /Theirs/);
});

/* ---------- 8/9. unpublish and restore ---------- */

test('unpublishing removes the page from the site but keeps the Markdown; restoring brings it back', async () => {
  const item = (await api('GET', '/content')).body.items.find((i) => i.id === 'what-we-learned');
  const md = 'content/stories/what-we-learned.md';
  const original = fake.text(md);
  assert.ok(fake.has('stories/what-we-learned.html'));

  const off = await api('POST', '/item/status', { body: { kind: 'story', id: item.id, sha: item.sha, status: 'draft' } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.expect, 'absent');
  const done = (await api('GET', `/deploy?sha=${off.body.commit}&expect=absent&kind=story&slug=what-we-learned`)).body;
  assert.equal(done.state, 'live', JSON.stringify(done));
  assert.ok(!fake.has('stories/what-we-learned.html'), 'page is gone');
  assert.doesNotMatch(fake.text('content/stories.js'), /what-we-learned/);
  assert.doesNotMatch(fake.text('sitemap.xml'), /what-we-learned/);
  assert.doesNotMatch(fake.text('index.html'), /what-we-learned\.html/);
  assert.match(fake.text(md), /status: "draft"/, 'content is preserved');
  assert.equal(fake.text(md).replace('status: "draft"\n', ''), original);
  const live = await fetch(SITE + '/stories/what-we-learned.html');
  assert.equal(live.status, 404);

  const listed = (await api('GET', '/content')).body;
  assert.equal(listed.items.find((i) => i.id === 'what-we-learned').status, 'draft');
  assert.equal(listed.stats.drafts, 1);

  const draft = await openItem({ kind: 'story', id: 'what-we-learned' });
  assert.equal(draft.status, 'draft');
  const on = await api('POST', '/item/status', { body: { kind: 'story', id: item.id, sha: draft.sha, status: 'published' } });
  assert.equal(on.status, 200);
  const back = (await api('GET', `/deploy?sha=${on.body.commit}&expect=live&kind=story&slug=what-we-learned`)).body;
  assert.equal(back.state, 'live', JSON.stringify(back));
  assert.equal(fake.text(md), original, 'restored file is identical to the original');
  assert.ok(fake.has('stories/what-we-learned.html'));
  assert.match(fake.text('content/stories.js'), /what-we-learned/);
  assert.equal((await fetch(SITE + '/stories/what-we-learned.html')).status, 200);
});

test('publishing something already published makes no second commit', async () => {
  const item = await firstJournal();
  const res = await api('POST', '/item/status', { body: { kind: 'journal', id: item.id, sha: item.sha, status: 'published' } });
  assert.equal(res.body.unchanged, true);
  assert.equal(fake.state.calls.filter((c) => c.startsWith('POST /git/commits')).length, 0);
});

/* ---------- 10/11. deletion ---------- */

test('deleting needs the exact title, and removes only that item’s files', async () => {
  const item = (await api('GET', '/content')).body.items.find((i) => i.id === 'what-we-learned');
  const before = fake.snapshot();

  const wrong = await api('POST', '/item/delete', { body: { kind: 'story', id: item.id, sha: item.sha, confirmTitle: 'nope' } });
  assert.equal(wrong.status, 400);
  assert.ok(fake.has('content/stories/what-we-learned.md'));

  const res = await api('POST', '/item/delete', { body: { kind: 'story', id: item.id, sha: item.sha, confirmTitle: item.title } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.removed.sort(), ['content/stories.js', 'content/stories/what-we-learned.md', 'stories/images/what-we-learned.jpg', 'stories/what-we-learned.html'].sort());
  const done = (await api('GET', `/deploy?sha=${res.body.commit}&expect=absent&kind=story&slug=what-we-learned`)).body;
  assert.equal(done.state, 'live');

  /* every file in the repository that changed is explained by this deletion or by the rebuild */
  const after = fake.snapshot();
  const touched = [...new Set([...before.keys(), ...after.keys()])].filter((p) => !before.get(p) || !after.get(p) || !before.get(p).equals(after.get(p)));
  const allowed = ['content/stories/what-we-learned.md', 'stories/what-we-learned.html', 'stories/images/what-we-learned.jpg', 'content/stories.js', 'sitemap.xml', 'index.html'];
  assert.deepEqual(touched.filter((p) => !allowed.includes(p)), []);
  assert.ok(after.has('content/stories/loneliness.md'));
  assert.ok(after.has('stories/loneliness.html'));
  assert.ok(after.has('.github/workflows/publish-stories.yml'));

  const again = await api('POST', '/item/delete', { body: { kind: 'story', id: item.id, sha: item.sha, confirmTitle: item.title } });
  assert.equal(again.status, 404);
});

test('the browser cannot aim a request at any other file', async () => {
  const bad = [
    { kind: 'journal', id: '../../.github/workflows/publish-stories' },
    { kind: 'journal', id: '..%2F..%2Fstudio-api%2Fworker' },
    { kind: 'journal', id: 'a/b' },
    { kind: 'journal', id: 'README' },
    { kind: 'journal', id: '_template' },
    { kind: 'site', id: 'site' },
    { kind: 'story', id: '' },
    { kind: 'story', id: 123 },
  ];
  for (const target of bad) {
    for (const [route, method] of [['/item/delete', 'POST'], ['/item/status', 'POST'], ['/item', 'PUT']]) {
      const res = await api(method, route, { body: { ...target, sha: 'x', status: 'draft', confirmTitle: 'x', meta: {}, body: 'x' } });
      assert.equal(res.status, 400, `${method} ${route} ${JSON.stringify(target)}`);
    }
    if (typeof target.id === 'string') assert.equal((await api('GET', `/item?kind=${target.kind}&id=${encodeURIComponent(target.id)}`)).status, 400);
  }
  assert.equal(fake.state.calls.filter((c) => /^(POST|PATCH|PUT|DELETE)/.test(c)).length, 0);
});

/* ---------- 13. failures are reported as they are ---------- */

test('build and hosting failures are reported, never called "live"', async () => {
  fake.state.failBuild = true;
  const item = (await api('GET', '/content')).body.items.find((i) => i.id === 'loneliness');
  const opened = await openItem(item);
  const res = await api('PUT', '/item', { body: { kind: 'story', id: 'loneliness', sha: opened.sha, publish: true, meta: { ...opened.meta, title: 'Changed' }, body: opened.body } });
  assert.equal(res.status, 200, 'saved to GitHub');
  const failed = (await api('GET', `/deploy?sha=${res.body.commit}&expect=updated&kind=story&slug=loneliness`)).body;
  assert.equal(failed.state, 'build_failed');
  assert.ok(failed.detail);
  assert.match(failed.message, /not live/);

  fake.state.failBuild = false;
  fake.state.holdBuild = true;
  const second = await api('PUT', '/item', { body: { kind: 'story', id: 'loneliness', sha: res.body.sha, publish: true, meta: { ...opened.meta, title: 'Changed again' }, body: opened.body } });
  assert.equal((await api('GET', `/deploy?sha=${second.body.commit}&expect=updated&kind=story&slug=loneliness`)).body.state, 'building');
  fake.state.holdDeploy = true;
  fake.finishHeldBuild();
  assert.equal((await api('GET', `/deploy?sha=${second.body.commit}&expect=updated&kind=story&slug=loneliness`)).body.state, 'deploying');
  fake.state.holdDeploy = false; fake.state.failDeploy = true;
  assert.equal((await api('GET', `/deploy?sha=${second.body.commit}&expect=updated&kind=story&slug=loneliness`)).body.state, 'deploy_failed');
  fake.state.failDeploy = false; fake.deployNow();
  assert.equal((await api('GET', `/deploy?sha=${second.body.commit}&expect=updated&kind=story&slug=loneliness`)).body.state, 'live');
});

test('two quick saves: the first rebuild losing the race is not reported as a failure', async () => {
  fake.state.holdBuild = true;
  const first = await openItem({ kind: 'story', id: 'loneliness' });
  const a = await api('PUT', '/item', { body: { kind: 'story', id: 'loneliness', sha: first.sha, publish: true, meta: { ...first.meta, title: 'First save' }, body: first.body } });
  const b = await api('PUT', '/item', { body: { kind: 'story', id: 'loneliness', sha: a.body.sha, publish: true, meta: { ...first.meta, title: 'Second save' }, body: first.body } });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const waiting = (await api('GET', `/deploy?sha=${a.body.commit}&expect=updated&kind=story&slug=loneliness`)).body;
  assert.equal(waiting.state, 'building');
  fake.finishHeldBuild();
  assert.equal(fake.runs[0].conclusion, 'failure', 'the first run really did fail to push');
  const first_ = (await api('GET', `/deploy?sha=${a.body.commit}&expect=updated&kind=story&slug=loneliness`)).body;
  assert.equal(first_.state, 'live', JSON.stringify(first_));
  assert.match(fake.text('stories/loneliness.html'), /Second save/);
});

test('the old page is not mistaken for the new one while the site is still deploying', async () => {
  fake.state.holdDeploy = true;
  const opened = await openItem({ kind: 'story', id: 'loneliness' });
  const res = await api('PUT', '/item', { body: { kind: 'story', id: 'loneliness', sha: opened.sha, publish: true, meta: { ...opened.meta, title: 'Brand new title' }, body: opened.body } });
  const status = (await api('GET', `/deploy?sha=${res.body.commit}&expect=updated&kind=story&slug=loneliness`)).body;
  assert.notEqual(status.state, 'live');
});

test('GitHub being down gives a safe message and no details', async () => {
  fake.state.ghDown = true;
  const res = await api('GET', '/content');
  assert.equal(res.status, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /test-token|api\.github/);
});

/* ---------- submissions waiting for review ---------- */

test('submissions are listed, previewed, approved by a person, or declined', async () => {
  const md = '---\ntitle: "A visitor story"\nauthor: "Pema"\ncategory: "Caregiving"\ndate: "2026-10-10"\n---\n\nWords from a visitor.\n';
  const pr = fake.openSubmission('story', 'a-visitor-story', md);
  const other = fake.openSubmission('story', 'second', md.replace('A visitor story', 'Second'));

  const list = (await api('GET', '/content')).body;
  assert.equal(list.stats.pending, 2);
  const detail = (await api('GET', `/pending?number=${pr.number}`)).body;
  assert.equal(detail.meta.title, 'A visitor story');
  assert.match(detail.body, /Words from a visitor/);
  assert.ok(!fake.has('content/stories/a-visitor-story.md'), 'nothing is published by merely listing it');

  const closed = await api('POST', '/pending/close', { body: { number: other.number } });
  assert.equal(closed.status, 200);
  assert.equal(other.state, 'closed');

  const merged = await api('POST', '/pending/merge', { body: { number: pr.number } });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  const live = (await api('GET', `/deploy?sha=${merged.body.commit}&expect=live&kind=story&slug=a-visitor-story`)).body;
  assert.equal(live.state, 'live', JSON.stringify(live));
  assert.equal((await fetch(SITE + '/stories/a-visitor-story.html')).status, 200);
  assert.equal((await api('POST', '/pending/merge', { body: { number: pr.number } })).status, 409, 'cannot be approved twice');
});

test('a pull request that is not a site submission cannot be approved from the dashboard', async () => {
  const pr = fake.openSubmission('story', 'sneaky', '---\ntitle: "x"\n---\n\nx');
  pr.files.set('.github/workflows/publish-stories.yml', Buffer.from('evil'));
  const res = await api('POST', '/pending/merge', { body: { number: pr.number } });
  assert.equal(res.status, 409);
  assert.equal(pr.state, 'open');
  const foreign = fake.openSubmission('story', 'x', '---\ntitle: "x"\n---\n\nx');
  foreign.ref = 'dependabot/npm/foo';
  assert.equal((await api('POST', '/pending/merge', { body: { number: foreign.number } })).status, 404);
});

/* ---------- activity ---------- */

test('the activity list comes from commit history and names the editor', async () => {
  const item = (await api('GET', '/content')).body.items.find((i) => i.id === 'what-we-learned');
  await api('POST', '/item/status', { body: { kind: 'story', id: item.id, sha: item.sha, status: 'draft' } });
  const log = (await api('GET', '/audit')).body;
  assert.equal(log.source, 'history');
  assert.ok(log.records.some((r) => r.by === 'editor' && /unpublished/.test(r.action)));
  assert.doesNotMatch(JSON.stringify(log), /test-token/);
});

test('with an AUDIT store, successes and failures are both logged, without secrets', async () => {
  const store = new Map();
  const env = { ...ENV, AUDIT: { put: async (k, v) => store.set(k, v), get: async (k) => store.get(k), list: async () => ({ keys: [...store.keys()].sort().map((name) => ({ name })) }) } };
  await api('POST', '/item/delete', { env, body: { kind: 'story', id: 'what-we-learned', sha: 'stale', confirmTitle: 'x' } });
  const item = (await api('GET', '/content', { env })).body.items.find((i) => i.id === 'what-we-learned');
  await api('POST', '/item/status', { env, body: { kind: 'story', id: item.id, sha: 'stale-sha', status: 'draft' } });
  await api('POST', '/item/status', { env, body: { kind: 'story', id: item.id, sha: item.sha, status: 'draft' } });
  const log = (await api('GET', '/audit', { env })).body;
  assert.equal(log.source, 'log');
  assert.ok(log.records.some((r) => r.ok === false && r.action === 'unpublished'));
  assert.ok(log.records.some((r) => r.ok === true && r.action === 'unpublished'));
  assert.doesNotMatch(JSON.stringify(log), /test-token|Cf-Access/);
});
