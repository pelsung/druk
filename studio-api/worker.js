/* ==========================================================================
   Druk.help — Share your journal or story (Cloudflare Worker)

     POST /submit  a journal entry or story from /stories/share.html → { ok }

   It holds the GitHub token, so the page never sees it. It never touches the
   live branch: each submission becomes its own pull request holding
   content/{journal,stories}/<slug>.md (and its photo), and nothing is
   published until someone on the team merges it.

   Secrets / vars (see wrangler.toml and README.md):
     GITHUB_TOKEN     fine-grained token, this repo only,
                      Contents: read & write, Pull requests: read & write
     TURNSTILE_SECRET optional: Cloudflare Turnstile, to keep bots out
     REPO             owner/repo
     BRANCH           the branch pull requests are opened against
     ALLOWED_ORIGIN   the site's origin, e.g. https://druk.help
   ========================================================================== */

import '../journal/sync-core.js';

const core = globalThis.DrukJournal;

const MAX_BODY = 12 * 1024 * 1024;
const MAX_PHOTO = 3 * 1024 * 1024;
/* there is no word limit: this only turns away something absurdly long */
const MAX_TEXT = 100000;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (new URL(request.url).pathname !== '/submit') return reply(404, { error: 'Not found' });

    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) {
      return reply(413, { error: 'That is too large to send — try a smaller photo.' });
    }

    let input;
    try { input = await request.json(); } catch { return reply(400, { error: 'Bad request' }); }

    try {
      return reply(200, await submit(github(env), env, input, request.headers.get('CF-Connecting-IP')));
    } catch (error) {
      return reply(error.status || 500, { error: error.message || 'Your story could not be sent.' });
    }
  },
};


/* ---------- shared writing: one pull request per journal entry or story ---------- */

async function submit(gh, env, input, ip) {
  /* a filled-in hidden field means a bot; say thanks and do nothing */
  if (input.website) return { ok: true };

  if (env.TURNSTILE_SECRET) {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', String(input.turnstile || ''));
    if (ip) form.append('remoteip', ip);
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const verdict = await check.json().catch(() => ({}));
    if (!verdict.success) throw fail(400, 'Please complete the check above the button and try again.');
  }

  const clean = (value, max) => String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
  const line = (value, max) => clean(value, max).replace(/\s+/g, ' ');
  const kind = input.kind === 'journal' ? 'journal' : 'story';
  const noun = kind === 'journal' ? 'journal entry' : 'story';
  const folder = kind === 'journal' ? 'journal' : 'stories';
  const title = line(input.title, 140);
  const photo = input.photo && input.photo.data ? input.photo : null;
  if (title.length < 3) throw fail(400, 'Give your ' + noun + ' a title.');

  let meta, body, details;
  if (kind === 'journal') {
    /* the journal template: date, photo, caption, what happened as a witness
       saw it, and a reflection on three questions */
    const parts = { description: clean(input.description, MAX_TEXT) };
    core.REFLECTION.forEach((r) => { parts[r.key] = clean(input[r.key], MAX_TEXT); });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : '';
    const latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);   /* today, in any time zone */
    if (!date || date > latest) throw fail(400, 'Pick the date of the meeting.');
    if (!photo) throw fail(400, 'Add a photo — every journal entry has one.');
    if (line(photo.caption, 200).length < 3) throw fail(400, 'Add a caption for the photo.');
    if (!parts.description) throw fail(400, 'Describe what happened, as you saw it.');
    for (const r of core.REFLECTION) {
      if (!core.countWords(parts[r.key])) throw fail(400, 'Answer “' + r.question + '” in your reflection.');
    }
    const words = core.journalWordCount(parts);
    meta = { title, author: 'Druk.help', date };
    body = core.journalBody(parts);
    details = ['- **Date:** ' + date, '- **Words:** ' + words, '- **Photo caption:** ' + line(photo.caption, 200)];
  } else {
    /* a story: its writer's own topic, their words, and their name */
    const name = line(input.name, 80);
    const topic = core.cleanTopic(input.topic);
    const story = clean(input.story, MAX_TEXT);
    if (name.length < 2) throw fail(400, 'Add your name — it is shown with your story.');
    if (topic.length < 2) throw fail(400, 'Write what your story is about, in a word or two.');
    if (!story) throw fail(400, 'Write your story.');
    meta = { title, author: name, category: topic, date: core.today() };
    body = story;
    details = ['- **Topic:** ' + topic, '- **Shown as:** ' + name, '- **Photo:** ' + (photo ? 'yes' : 'none')];
  }
  if (!input.consent) throw fail(400, 'Please tick the box to say the ' + noun + ' can be published.');

  /* never reuse a name already taken — by a shared file, or by a page such as
     journal/index.html or stories/share.html */
  const base = core.slugify(title) || kind;
  const branchHead = (await gh('/git/ref/heads/' + encodeURIComponent(gh.branch))).object.sha;
  const taken = (await exists(gh, 'content/' + folder + '/' + base + '.md', branchHead))
    || (await exists(gh, folder + '/' + base + '.html', branchHead));
  const slug = taken ? base + '-' + Date.now().toString(36).slice(-4) : base;

  const files = [];
  if (photo) {
    const ext = PHOTO_TYPES[photo.type];
    const data = String(photo.data);
    if (!ext) throw fail(400, 'The photo should be a JPG, PNG or WebP.');
    if (data.length * 0.75 > MAX_PHOTO) throw fail(413, 'The photo is too large — please use one under 3 MB.');
    meta.image = 'images/' + slug + '.' + ext;
    if (kind === 'journal') meta.caption = line(photo.caption, 200);
    else meta.imageAlt = line(photo.alt, 200);
    files.push({ path: folder + '/images/' + slug + '.' + ext, content: data, encoding: 'base64' });
  }
  files.unshift({ path: 'content/' + folder + '/' + slug + '.md', content: core.storyMarkdown(meta, body), encoding: 'utf-8' });


  /* its own branch, its own commit, its own pull request */
  const label = kind === 'journal' ? 'Journal' : 'Story';
  const branch = kind + '/' + slug + '-' + Date.now().toString(36);
  const entries = await Promise.all(files.map(async (f) => {
    const blob = await gh('/git/blobs', { method: 'POST', body: { content: f.content, encoding: f.encoding } });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  }));
  const parent = await gh('/git/commits/' + branchHead);
  const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } });
  const commitSha = (await gh('/git/commits', {
    method: 'POST',
    body: { message: label + ' submitted: ' + title, tree: tree.sha, parents: [branchHead] },
  })).sha;
  await gh('/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + branch, sha: commitSha } });
  await gh('/pulls', {
    method: 'POST',
    body: {
      title: label + ': ' + title,
      head: branch,
      base: gh.branch,
      body: [
        'A ' + noun + ' sent in from the Share page on the site.',
        '',
        ...details,
        '',
        'Read it in **Files changed**. Edit the Markdown here if it needs a light touch.',
        'Merge to publish it on the site; close to decline.',
      ].join('\n'),
    },
  });
  return { ok: true };
}

async function exists(gh, path, ref) {
  try { await gh('/contents/' + path + '?ref=' + ref); return true; } catch { return false; }
}

function github(env) {
  const api = 'https://api.github.com/repos/' + env.REPO;
  const call = async (path, options = {}) => {
    const response = await fetch(api + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'druk-share',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.ok) return response.json();
    /* keep GitHub's detail in the worker log, not in the browser */
    console.log('GitHub', response.status, path, (await response.text()).slice(0, 300));
    throw fail(response.status === 422 ? 422 : 502, 'The site could not be updated right now.');
  };
  call.branch = env.BRANCH || 'main';
  return call;
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}
