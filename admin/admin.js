/* ==========================================================================
   Druk.help — editor dashboard

   A single page. It never builds HTML from text it was given (titles and
   stories can come from the public), only DOM nodes and textContent.
   It talks only to /admin/api/, which checks who is asking on every request.
   ========================================================================== */

(function () {
  'use strict';

  var core = window.DrukJournal;
  var Ed = window.DrukEditor;
  /* the Worker's address: on the real site it is another address (see the page's meta tag);
     the local demo answers from the same address */
  var API = (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/admin/api'
    : ((document.querySelector('meta[name="admin-api"]') || {}).content || '/admin/api')).replace(/\/+$/, '');

  /* the sign-in token lasts 12 hours; the page keeps it only in this browser */
  var TOKEN_KEY = 'druk-admin-token';
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(token) {
    try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
  }
  var view = document.getElementById('view');
  var KIND_NAME = { journal: 'Journal entry', story: 'Story' };
  var PAGES = { journal: 'journal', story: 'stories' };

  var S = { me: null, items: [], pending: [], stats: null, edit: null, hash: '' };

  /* ---------- tiny DOM helper ---------- */

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === false || value === null || value === undefined) return;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    });
    [].concat(kids === undefined ? [] : kids).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    });
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function show(nodes) {
    clear(view);
    [].concat(nodes).forEach(function (n) { view.appendChild(n); });
  }

  function date(iso) { return iso ? core.humanDate(iso) : ''; }

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- talking to the Worker ---------- */

  function ApiError(status, message, code, errors) {
    this.status = status; this.message = message; this.code = code; this.errors = errors;
  }

  /* the password screen; after a good password the dashboard starts */
  function showLogin(message) {
    S.edit = null;
    document.body.classList.add('logged-out');
    var dlg = document.getElementById('modal');
    if (dlg.open) dlg.close();
    var input = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, placeholder: 'Enter your password' });
    var toggle = h('button', { class: 'pw-toggle', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false', onclick: function () {
      var shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      toggle.textContent = shown ? 'Show' : 'Hide';
      toggle.setAttribute('aria-pressed', String(!shown));
      toggle.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
      input.focus();
    } }, 'Show');
    var error = h('p', { class: 'error', role: 'alert', hidden: !message, text: message || '' });
    var go = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
    var form = h('form', { class: 'card login', onsubmit: function (e) {
      e.preventDefault();
      go.disabled = true; error.hidden = true;
      api('POST', '/login', { password: input.value }).then(function (res) {
        setToken(res.token);
        document.body.classList.remove('logged-out');
        start();
      }).catch(function (err) {
        go.disabled = false;
        if (err.code === 'unauthenticated') return;
        error.textContent = err.message; error.hidden = false; input.select();
      });
    } }, [
      h('p', { class: 'eyebrow', text: 'Editor dashboard' }),
      h('h1', { text: 'Sign in' }),
      h('p', { text: 'Enter the editor password. You stay signed in for about 12 hours.' }),
      h('div', { class: 'field' }, [h('label', { for: 'pw', text: 'Password' }), h('div', { class: 'pw-wrap' }, [input, toggle]), error]),
      go,
    ]);
    show(form);
    input.focus();
  }

  function api(method, path, body) {
    var headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-Druk-Admin'] = '1';
    if (getToken()) headers.Authorization = 'Bearer ' + getToken();
    return fetch(API + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).then(function (res) {
      if (res.type === 'opaqueredirect' || res.status === 0) { showLogin(); throw new ApiError(0, 'Signed out', 'unauthenticated'); }
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (res.status === 401 && !(data && data.code === 'bad_password')) { setToken(''); showLogin(path === '/me' || path === '/login' ? '' : 'Your session ended. Please sign in again.'); throw new ApiError(401, 'Signed out', 'unauthenticated'); }
        if (!res.ok || data === null) {
          throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.', data && data.code, data && data.errors);
        }
        return data;
      });
    }, function () {
      throw new ApiError(0, 'The connection was lost. Check your internet and try again.', 'network');
    });
  }

  /* ---------- messages ---------- */

  function flash(kind, text, extra) {
    var old = document.getElementById('flash');
    if (old) old.remove();
    var box = h('div', { id: 'flash', class: 'notice notice-' + kind, role: kind === 'bad' ? 'alert' : 'status' }, [text].concat(extra || []));
    view.insertBefore(box, view.firstChild);
    box.scrollIntoView({ block: 'nearest' });
    return box;
  }

  function oops(error, fallback) {
    if (error && error.status === 0 && error.code === 'unauthenticated') return;
    flash('bad', (error && error.message) || fallback || 'Something went wrong.');
  }

  /* ---------- the content list ---------- */

  function load() {
    return api('GET', '/content').then(function (data) {
      S.items = data.items; S.pending = data.pending; S.stats = data.stats;
      var badge = document.getElementById('pending-badge');
      badge.textContent = String(data.pending.length);
      badge.hidden = !data.pending.length;
      return data;
    });
  }

  function find(kind, id) {
    return S.items.filter(function (i) { return i.kind === kind && i.id === id; })[0];
  }

  /* ---------- pieces used by several views ---------- */

  function statusPill(item) {
    return h('span', { class: 'pill pill-' + item.status, text: item.status === 'draft' ? 'Unpublished' : 'Published' });
  }

  function row(item) {
    var title = item.legacy
      ? h('a', { class: 'row-title', href: '../' + item.url, target: '_blank', rel: 'noopener', text: item.title })
      : h('a', { class: 'row-title', href: '#/edit/' + item.kind + '/' + item.id, text: item.title });
    var actions = [];
    if (!item.legacy) {
      actions.push(h('a', { class: 'btn btn-small', href: '#/edit/' + item.kind + '/' + item.id }, 'Edit'));
    }
    if (item.status === 'published') {
      actions.push(h('a', { class: 'btn btn-small', href: '../' + item.url, target: '_blank', rel: 'noopener' }, 'View on website'));
    }
    if (!item.legacy) {
      actions.push(item.status === 'published'
        ? h('button', { class: 'btn btn-small', type: 'button', onclick: function () { unpublish(item); } }, 'Unpublish')
        : h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: function () { publish(item); } }, 'Publish'));
      if (S.me && S.me.canDelete) {
        actions.push(h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: function () { remove(item); } }, 'Delete…'));
      }
    }
    return h('div', { class: 'row' }, [
      h('div', {}, [
        h('div', {}, [title]),
        h('div', { class: 'row-meta' }, [
          h('span', { class: 'pill pill-kind', text: KIND_NAME[item.kind] }),
          statusPill(item),
          item.author ? h('span', { text: 'by ' + item.author }) : null,
          item.date ? h('span', { text: date(item.date) }) : null,
          item.category ? h('span', { text: item.category }) : null,
          item.legacy ? h('span', { text: 'Made by hand — view only here' }) : null,
        ]),
      ]),
      h('div', { class: 'row-actions' }, actions),
    ]);
  }

  /* ---------- views ---------- */

  function viewHome() {
    var s = S.stats;
    var recent = S.items.slice(0, 5);
    show([
      h('div', { class: 'page-head' }, [h('div', {}, [
        h('p', { class: 'eyebrow', text: 'Editor dashboard' }),
        h('h1', { text: 'Welcome back' }),
        h('p', { text: 'Everything on the website, in one place. Open a story or journal to change it, unpublish it, or review what visitors have sent in.' }),
      ])]),
      h('div', { class: 'stats' }, [
        stat(s.publishedStories, 'Published stories', '#/published?kind=story'),
        stat(s.publishedJournals, 'Published journal entries', '#/published?kind=journal'),
        stat(s.pending, 'Waiting for review', '#/pending', s.pending > 0),
        stat(s.drafts, 'Unpublished', '#/drafts'),
      ]),
      s.pending ? h('div', { class: 'notice notice-info' }, [
        s.pending === 1 ? 'A visitor has sent in something new that nobody has reviewed yet. ' : s.pending + ' things sent in by visitors have not been reviewed yet. ',
        h('a', { href: '#/pending' }, 'Review them →'),
      ]) : null,
      h('h2', { text: 'Most recent' }),
      h('p', { class: 'count', text: 'By date.' }),
      recent.length ? h('div', { class: 'list' }, recent.map(row)) : h('div', { class: 'list' }, [h('div', { class: 'empty', text: 'Nothing has been published yet.' })]),
    ]);
  }

  function stat(n, label, href, alert) {
    return h('a', { class: 'stat' + (alert ? ' stat-alert' : ''), href: href }, [
      h('span', { class: 'stat-n', text: String(n) }), h('span', { class: 'stat-l', text: label }),
    ]);
  }

  var TITLES = {
    stories: ['All stories', 'Stories shared by visitors and written by the team.', { kind: 'story' }],
    journals: ['All journal entries', 'Field notes from meetings and visits.', { kind: 'journal' }],
    published: ['Published', 'Everything visitors can read on the website right now.', { status: 'published' }],
    drafts: ['Unpublished', 'Hidden from the website. The text is kept, and you can publish it again.', { status: 'draft' }],
  };

  function viewList(name, query) {
    var meta = TITLES[name];
    var preset = Object.assign({ kind: query.kind || '', status: query.status || '' }, meta[2]);
    var q = h('input', { type: 'search', id: 'q', placeholder: 'Search by title, author or topic', 'aria-label': 'Search' });
    var kind = h('select', { id: 'kind', 'aria-label': 'Type' }, [
      h('option', { value: '', text: 'All types' }), h('option', { value: 'story', text: 'Stories' }), h('option', { value: 'journal', text: 'Journal entries' }),
    ]);
    var status = h('select', { id: 'status', 'aria-label': 'Status' }, [
      h('option', { value: '', text: 'Any status' }), h('option', { value: 'published', text: 'Published' }), h('option', { value: 'draft', text: 'Unpublished' }),
    ]);
    kind.value = preset.kind; status.value = preset.status;
    var count = h('p', { class: 'count', 'aria-live': 'polite' });
    var list = h('div', { class: 'list' });

    function draw() {
      var text = q.value.trim().toLowerCase();
      var shown = S.items.filter(function (i) {
        if (kind.value && i.kind !== kind.value) return false;
        if (status.value && i.status !== status.value) return false;
        if (!text) return true;
        return [i.title, i.author, i.category, i.slug, KIND_NAME[i.kind]].join(' ').toLowerCase().indexOf(text) !== -1;
      });
      count.textContent = shown.length + (shown.length === 1 ? ' item' : ' items');
      clear(list);
      if (!shown.length) list.appendChild(h('div', { class: 'empty', text: S.items.length ? 'Nothing matches. Try different words or filters.' : 'Nothing here yet.' }));
      shown.forEach(function (i) { list.appendChild(row(i)); });
    }
    [q, kind, status].forEach(function (el) { el.addEventListener('input', draw); });
    draw();

    show([
      h('div', { class: 'page-head' }, [h('div', {}, [h('h1', { text: meta[0] }), h('p', { text: meta[1] })])]),
      h('div', { class: 'toolbar' }, [q, kind, status]),
      count, list,
    ]);
  }

  /* ---------- waiting for review ---------- */

  function viewPending() {
    var items = S.pending;
    show([
      h('div', { class: 'page-head' }, [h('div', {}, [
        h('h1', { text: 'Waiting for review' }),
        h('p', { text: 'Journals and stories visitors have sent in. They are not on the website until someone approves them.' }),
      ])]),
      h('div', { class: 'list' }, items.length ? items.map(function (p) {
        return h('div', { class: 'row' }, [
          h('div', {}, [
            h('div', {}, [h('a', { class: 'row-title', href: '#/pending/' + p.number, text: p.title })]),
            h('div', { class: 'row-meta' }, [
              h('span', { class: 'pill pill-kind', text: KIND_NAME[p.kind] }),
              h('span', { class: 'pill pill-pending', text: 'Waiting' }),
              h('span', { text: 'Sent ' + when(p.submittedAt) }),
            ]),
          ]),
          h('div', { class: 'row-actions' }, [h('a', { class: 'btn btn-small btn-primary', href: '#/pending/' + p.number }, 'Read and decide')]),
        ]);
      }) : [h('div', { class: 'empty', text: 'Nothing is waiting. 🎉' })]),
    ]);
  }

  function viewPendingOne(number) {
    show(h('p', { class: 'loading', text: 'Loading…' }));
    api('GET', '/pending?number=' + encodeURIComponent(number)).then(function (p) {
      var frame = h('iframe', { class: 'preview-frame', title: 'How it will look', sandbox: 'allow-scripts allow-same-origin' });
      var busy = false;
      function decide(path, ok, text) {
        if (busy) return;
        busy = true;
        api('POST', path, { number: p.number }).then(function (res) {
          return load().then(function () { ok(res); });
        }).catch(function (e) { busy = false; oops(e); });
      }
      show([
        h('div', { class: 'page-head' }, [h('div', {}, [
          h('p', { class: 'eyebrow', text: 'Sent in by a visitor · ' + KIND_NAME[p.kind] }),
          h('h1', { text: p.meta.title || 'Untitled' }),
          h('p', { text: 'by ' + (p.meta.author || 'unknown') + ' · sent ' + when(p.submittedAt) }),
        ])]),
        h('p', { class: 'notice notice-info', text: 'This is how it will look on the website. Nothing is published until you approve it. After approving, you can still edit it.' }),
        frame,
        h('div', { class: 'actionbar' }, [
          h('a', { class: 'btn', href: '#/pending' }, 'Back'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', type: 'button', onclick: function () {
            confirmDialog({ title: 'Decline this submission?', body: 'It will not be published. The visitor is not told.', quote: p.meta.title, ok: 'Decline it', danger: true }).then(function (yes) {
              if (yes) decide('/pending/close', function () { location.hash = '#/pending'; }); });
          } }, 'Decline'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
            confirmDialog({ title: 'Approve and publish?', body: 'This puts it on the website for everyone to read.', quote: p.meta.title, ok: 'Approve and publish' }).then(function (yes) {
              if (yes) decide('/pending/merge', function (res) {
                track({ title: res.title, what: 'Approved', commit: res.commit, expect: res.expect, kind: res.kind, slug: res.slug });
                location.hash = '#/pending';
              });
            });
          } }, 'Approve and publish'),
        ]),
      ]);
      previewInto(frame, p.kind, p.id, p.meta, p.body, p.photo);
    }).catch(function (e) { show([h('a', { href: '#/pending' }, '← Back'), h('p', {}), h('div', { class: 'notice notice-bad', text: e.message })]); });
  }

  /* ---------- activity ---------- */

  function viewActivity() {
    show(h('p', { class: 'loading', text: 'Loading…' }));
    api('GET', '/audit').then(function (log) {
      show([
        h('div', { class: 'page-head' }, [h('div', {}, [h('h1', { text: 'Activity' }), h('p', { text: 'Who changed what, and when.' })])]),
        log.source === 'history' ? h('p', { class: 'notice notice-info', text: 'This list comes from the site’s history, so it shows saved changes only. Failed attempts are recorded once an administrator turns on the activity log.' }) : null,
        h('div', { class: 'card table-wrap' }, [
          log.records.length ? h('table', { class: 'log' }, [
            h('thead', {}, [h('tr', {}, ['When', 'Who', 'What', 'Result'].map(function (t) { return h('th', { text: t }); }))]),
            h('tbody', {}, log.records.map(function (r) {
              var what = r.title ? r.action + ' — ' + r.title : r.action;
              return h('tr', {}, [h('td', { text: when(r.at) }), h('td', { text: r.by || '' }), h('td', { text: what }), h('td', { text: r.ok ? 'Done' : 'Failed' + (r.detail ? ' (' + r.detail + ')' : '') })]);
            })),
          ]) : h('div', { class: 'empty', text: 'No activity yet.' }),
        ]),
      ]);
    }).catch(function (e) { oops(e); });
  }

  /* ---------- the editor ---------- */

  var templates = {};
  function template(kind) {
    var url = '../' + PAGES[kind] + '/_template.html';
    if (!templates[kind]) {
      templates[kind] = fetch(url, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('template');
        return r.text();
      });
    }
    return templates[kind];
  }

  /* Builds the real page — same template, same renderer as the site's own build —
     so the preview is the page as it will be published. */
  function previewHtml(kind, id, meta, body, tpl, photo) {
    var topic = core.cleanTopic(meta.category || '');
    var item = {
      slug: core.slugify(id), title: core.curl(meta.title || 'Untitled'),
      date: /^\d{4}-\d{2}-\d{2}$/.test(meta.date || '') ? meta.date : core.today(),
      author: core.curl(meta.author || (kind === 'journal' ? 'Druk.help' : '')),
      excerpt: core.curl(meta.excerpt || core.excerptFrom(body)),
    };
    var folder = PAGES[kind];
    if (meta.image) item.image = String(meta.image).replace(new RegExp('^/?' + folder + '/'), '');
    if (kind === 'story') item.category = topic || 'Other';
    var entry = Object.assign({}, item, {
      imageAlt: meta.imageAlt || '', caption: meta.caption || '',
      tags: kind === 'story' ? [item.category] : (topic ? [topic] : []),
    });
    var page = core.entryPage(entry, core.renderBody(body || '', undefined, { safe: true }), tpl);
    if (photo && item.image) page = page.split(item.image).join(photo);
    var ribbon = '<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#8E2B1F;color:#fff;font:600 14px/1 system-ui,sans-serif;text-align:center;padding:9px 8px">Preview — this is how it will look. It is not published yet.</div>';
    return page
      .replace(/<head>/i, '<head><base href="../' + folder + '/">')
      .replace(/(<body[^>]*>)/i, '$1' + ribbon + '<style>body{padding-top:34px}</style>');
  }

  function previewInto(frame, kind, id, meta, body, photo) {
    template(kind).then(function (tpl) {
      frame.srcdoc = previewHtml(kind, id, meta, body, tpl, photo);
    }).catch(function () {
      frame.replaceWith(h('div', { class: 'notice notice-bad', text: 'The preview could not be built right now.' }));
    });
  }

  function viewEdit(kind, id) {
    show(h('p', { class: 'loading', text: 'Opening…' }));
    api('GET', '/item?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id)).then(function (item) {
      buildEditor(item);
    }).catch(function (e) {
      show([h('a', { href: '#/' }, '← Back'), h('p'), h('div', { class: 'notice notice-bad', text: e.message })]);
    });
  }

  function buildEditor(item) {
    var kind = item.kind;
    var isStory = kind === 'story';
    var orig = { meta: item.meta, body: item.body };
    var E = S.edit = { item: item, busy: false, mode: 'edit', dirty: function () { return false; } };

    function field(name, label, input, hint) {
      return h('div', { class: 'field', id: 'f-' + name }, [
        h('label', { for: 'in-' + name, text: label }), input, hint ? h('p', { class: 'hint', text: hint }) : null,
        h('p', { class: 'error', id: 'err-' + name, hidden: true }),
      ]);
    }
    var ins = {
      title: h('input', { type: 'text', id: 'in-title', maxlength: '140', autocomplete: 'off' }),
      author: h('input', { type: 'text', id: 'in-author', maxlength: '80', autocomplete: 'off' }),
      date: h('input', { type: 'date', id: 'in-date' }),
      category: h('input', { type: 'text', id: 'in-category', maxlength: '60', autocomplete: 'off', list: 'topics' }),
      excerpt: h('textarea', { id: 'in-excerpt', rows: '3', maxlength: '400' }),
      caption: h('input', { type: 'text', id: 'in-caption', maxlength: '200', autocomplete: 'off' }),
      imageAlt: h('input', { type: 'text', id: 'in-imageAlt', maxlength: '200', autocomplete: 'off' }),
    };
    var values = {
      title: item.meta.title || '', author: item.meta.author || '', date: item.meta.date || '',
      category: item.meta.category || '', excerpt: item.meta.excerpt || '', caption: item.meta.caption || '', imageAlt: item.meta.imageAlt || '',
    };
    Object.keys(ins).forEach(function (k) { ins[k].value = values[k]; });

    var topics = h('datalist', { id: 'topics' }, (core.SUGGESTED_TOPICS || []).map(function (t) { return h('option', { value: t }); }));

    /* the writing area */
    var rte = h('div', { class: 'rte', id: 'in-body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Text', 'data-placeholder': 'Write here…', spellcheck: 'true' });
    Array.prototype.forEach.call(Ed.parse(Ed.mdToHtml(item.body)).childNodes, function (n) { rte.appendChild(document.importNode(n, true)); });
    var startHtml = rte.innerHTML;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* older browsers */ }

    function bodyMarkdown() {
      return rte.innerHTML === startHtml ? orig.body : Ed.htmlToMd(rte);
    }
    function current() {
      var m = { title: ins.title.value.trim(), author: ins.author.value.trim(), date: ins.date.value, excerpt: ins.excerpt.value.trim() };
      if (isStory) { m.category = ins.category.value.trim(); m.imageAlt = ins.imageAlt.value.trim(); }
      else m.caption = ins.caption.value.trim();
      return m;
    }
    E.dirty = function () {
      var c = current();
      var o = { title: values.title, author: values.author, date: values.date, excerpt: values.excerpt };
      if (isStory) { o.category = values.category; o.imageAlt = values.imageAlt; } else o.caption = values.caption;
      return JSON.stringify(c) !== JSON.stringify(o) || rte.innerHTML !== startHtml;
    };

    /* toolbar */
    function cmd(name, arg) { rte.focus(); document.execCommand(name, false, arg || null); }
    function tool(label, title, run) {
      return h('button', { type: 'button', title: title, 'aria-label': title, onmousedown: function (e) { e.preventDefault(); }, onclick: run }, label);
    }
    var bar = h('div', { class: 'rte-bar', role: 'toolbar', 'aria-label': 'Formatting' }, [
      tool('Heading', 'Heading', function () { cmd('formatBlock', 'h2'); }),
      tool('Subheading', 'Smaller heading', function () { cmd('formatBlock', 'h3'); }),
      tool('Text', 'Normal paragraph', function () { cmd('formatBlock', 'p'); }),
      h('span', { class: 'sep' }),
      tool(h('b', { text: 'B' }), 'Bold', function () { cmd('bold'); }),
      tool(h('i', { text: 'I' }), 'Italic', function () { cmd('italic'); }),
      h('span', { class: 'sep' }),
      tool('• List', 'Bulleted list', function () { cmd('insertUnorderedList'); }),
      tool('1. List', 'Numbered list', function () { cmd('insertOrderedList'); }),
      tool('❝ Quote', 'Quotation', function () { cmd('formatBlock', 'blockquote'); }),
      h('span', { class: 'sep' }),
      tool('Link', 'Add a link', addLink),
      tool('Unlink', 'Remove link', function () { cmd('unlink'); }),
      h('span', { class: 'sep' }),
      tool('Undo', 'Undo', function () { cmd('undo'); }),
      tool('Redo', 'Redo', function () { cmd('redo'); }),
    ]);

    function addLink() {
      var sel = window.getSelection();
      var range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      if (!range || !rte.contains(range.commonAncestorContainer) || range.collapsed) {
        flash('warn', 'First select the words you want to turn into a link, then press Link.');
        return;
      }
      var url = h('input', { type: 'text', id: 'link-url', placeholder: 'https://…', inputmode: 'url', autocomplete: 'off' });
      var err = h('p', { class: 'error', hidden: true });
      askDialog({ title: 'Add a link', body: h('div', { class: 'field' }, [h('label', { for: 'link-url', text: 'Web address' }), url, err]), ok: 'Add link' }, function () {
        var href = url.value.trim();
        if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) href = 'mailto:' + href;
        else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) href = 'https://' + href;
        if (!Ed.safeHref(href)) { err.textContent = 'That doesn’t look like a web address. Try something like https://example.org'; err.hidden = false; return false; }
        return href;
      }).then(function (href) {
        if (!href) return;
        rte.focus();
        sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('createLink', false, href);
      });
    }

    /* pasted and dropped text arrives as plain text, never as someone else's markup */
    function insertPlain(text) {
      var parts = String(text).replace(/\r\n/g, '\n').split(/\n+/);
      parts.forEach(function (part, i) {
        if (i) document.execCommand('insertParagraph');
        if (part) document.execCommand('insertText', false, part);
      });
    }
    rte.addEventListener('paste', function (e) {
      e.preventDefault();
      insertPlain((e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    rte.addEventListener('drop', function (e) {
      e.preventDefault();
      var text = e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (text) insertPlain(text);
    });

    /* the two views of the same form */
    var editPane = h('div', { id: 'pane-edit' });
    var previewPane = h('div', { id: 'pane-preview', hidden: true });
    var frame = h('iframe', { class: 'preview-frame', title: 'How it will look on the website', sandbox: 'allow-scripts allow-same-origin' });
    previewPane.appendChild(h('p', { class: 'notice notice-info preview-note', text: 'This is how it will look on the website. Nothing has been published.' }));
    previewPane.appendChild(frame);

    var tabEdit = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', onclick: function () { setMode('edit'); } }, 'Edit');
    var tabPrev = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: function () { setMode('preview'); } }, 'Preview');
    function setMode(mode) {
      E.mode = mode;
      editPane.hidden = mode !== 'edit'; previewPane.hidden = mode !== 'preview';
      tabEdit.setAttribute('aria-selected', mode === 'edit'); tabPrev.setAttribute('aria-selected', mode === 'preview');
      if (mode === 'preview') {
        var meta = Object.assign({}, item.meta, current());
        previewInto(frame, kind, item.id, meta, bodyMarkdown());
        previewPane.scrollIntoView({ block: 'nearest' });
      }
    }

    var lossy = !Ed.survives(item.body);

    editPane.appendChild(field('title', 'Title', ins.title));
    editPane.appendChild(h('div', { class: 'grid-2' }, [field('author', 'Author', ins.author, isStory ? 'Shown with the story.' : 'Journal entries are usually “Druk.help”.'), field('date', 'Date', ins.date)]));
    if (isStory) editPane.appendChild(field('category', 'Topic', ins.category, 'What it is about, in a word or two. Stories with the same topic are grouped together.'));
    editPane.appendChild(h('div', { class: 'field', id: 'f-body' }, [
      h('span', { class: 'label', id: 'body-label', text: isStory ? 'The story' : 'The entry' }),
      lossy ? h('p', { class: 'notice notice-warn', text: 'This text uses formatting the visual editor cannot show exactly. If you change the text, those parts may be simplified — use Preview to check before publishing.' }) : null,
      h('div', { class: 'rte-wrap' }, [bar, rte]),
      h('p', { class: 'error', id: 'err-body', hidden: true }),
    ]));
    editPane.appendChild(field('excerpt', 'Short summary (optional)', ins.excerpt, 'Shown on cards and in search results. Leave it empty to use the first sentence.'));
    editPane.appendChild(isStory
      ? field('imageAlt', 'Photo description (optional)', ins.imageAlt, item.meta.image ? 'Describes the photo for people who cannot see it.' : 'This story has no photo.')
      : field('caption', 'Photo caption', ins.caption, item.meta.image ? 'Shown under the photo.' : 'This entry has no photo.'));

    var published = item.status === 'published';
    var stateLine = h('span', {});
    function drawState() {
      clear(stateLine);
      stateLine.appendChild(h('span', { class: 'pill pill-' + (item.status), text: item.status === 'draft' ? 'Unpublished' : 'Published' }));
    }
    drawState();

    var btnPublish = h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { save(true); } }, 'Save and Publish');
    var btnDraft = h('button', { class: 'btn', type: 'button', onclick: function () { save(false); } }, 'Save without publishing');
    var btnOff = h('button', { class: 'btn', type: 'button', onclick: function () { unpublish(findOrFake()); } }, 'Unpublish');
    var dirtyNote = h('span', { class: 'dirty', hidden: true, text: 'You have changes that are not saved.' });
    function findOrFake() { return { kind: kind, id: item.id, sha: item.sha, title: ins.title.value || item.meta.title, status: item.status, fromEditor: true }; }

    function drawButtons() {
      btnDraft.hidden = item.status === 'published';
      btnOff.hidden = item.status !== 'published';
    }
    drawButtons();
    ['input', 'change'].forEach(function (evt) {
      view.addEventListener(evt, function () { dirtyNote.hidden = !E.dirty(); });
    });

    var side = h('aside', { class: 'editor-side' }, [
      h('div', { class: 'card' }, [
        h('h3', { text: 'About this ' + (isStory ? 'story' : 'entry') }),
        h('p'),
        h('dl', { class: 'kv' }, [
          h('dt', { text: 'Status' }), h('dd', {}, [stateLine]),
          h('dt', { text: 'Page' }), h('dd', { text: PAGES[kind] + '/' + core.slugify(item.id) + '.html' }),
        ]),
        h('p', { class: 'hint', text: 'The page address stays the same even if you change the title, so links people have shared keep working.' }),
        item.status === 'published' ? h('p', {}, [h('a', { href: '../' + PAGES[kind] + '/' + core.slugify(item.id) + '.html', target: '_blank', rel: 'noopener' }, 'View on the website ↗')]) : null,
      ]),
    ]);

    var banner = h('div', { id: 'banner' });
    E.banner = banner;

    show([
      h('div', { class: 'page-head' }, [h('div', {}, [
        h('p', { class: 'eyebrow', text: KIND_NAME[kind] }),
        h('h1', { text: item.status === 'draft' ? 'Edit (unpublished)' : 'Edit' }),
      ])]),
      banner, topics,
      h('div', { class: 'editor-layout' }, [
        h('div', {}, [h('div', { class: 'tabs', role: 'tablist' }, [tabEdit, tabPrev]), editPane, previewPane]),
        side,
      ]),
      h('div', { class: 'actionbar' }, [
        btnPublish, btnDraft, btnOff,
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: function () { location.hash = '#/' + (isStory ? 'stories' : 'journals'); } }, 'Cancel'),
        h('span', { class: 'spacer' }), dirtyNote,
      ]),
    ]);
    ins.title.focus();

    function validate() {
      var m = current(); var body = bodyMarkdown(); var errs = {};
      if (m.title.length < 3) errs.title = 'Give it a title (at least 3 characters).';
      if (!m.author) errs.author = 'Add the author’s name.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) errs.date = 'Pick a date.';
      if (isStory && core.cleanTopic(m.category || '').length < 2) errs.category = 'Add the topic, in a word or two.';
      if (!body.trim()) errs.body = 'The text cannot be empty.';
      return errs;
    }
    function showErrors(errs) {
      ['title', 'author', 'date', 'category', 'body'].forEach(function (k) {
        var p = document.getElementById('err-' + k); var f = document.getElementById('f-' + k);
        if (!p) return;
        p.hidden = !errs[k]; p.textContent = errs[k] || '';
        if (f) f.classList.toggle('has-error', !!errs[k]);
      });
      var first = Object.keys(errs)[0];
      if (first) {
        var el = document.getElementById(first === 'body' ? 'in-body' : 'in-' + first);
        if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
      }
    }

    function save(publishNow) {
      if (E.busy) return;
      var errs = validate();
      showErrors(errs);
      if (Object.keys(errs).length) { flash('bad', 'Please fix the highlighted fields, then try again.'); return; }
      E.busy = true;
      [btnPublish, btnDraft, btnOff].forEach(function (b) { b.disabled = true; });
      var m = current(); var body = bodyMarkdown();
      api('PUT', '/item', { kind: kind, id: item.id, sha: item.sha, publish: publishNow, meta: m, body: body }).then(function (res) {
        item.sha = res.sha || item.sha;
        if (publishNow) item.status = 'published';
        Object.keys(m).forEach(function (k) { values[k] = m[k]; });
        orig.body = body; startHtml = rte.innerHTML; item.meta = Object.assign({}, item.meta, m);
        dirtyNote.hidden = true; drawState(); drawButtons();
        clear(banner);
        if (res.unchanged) {
          flash('info', 'Nothing had changed, so there was nothing to save.');
        } else {
          flash('ok', publishNow ? 'Saved. The website is being updated — follow the progress at the bottom of the screen.' : 'Saved. It is still not on the website.');
          track({ title: res.title, what: publishNow ? 'Saved and published' : 'Saved', commit: res.commit, expect: res.expect, kind: res.kind, slug: res.slug });
        }
        return load();
      }).catch(function (e) {
        if (e.errors) { showErrors(e.errors); flash('bad', e.message); }
        else if (e.code === 'conflict') {
          clear(banner);
          banner.appendChild(h('div', { class: 'notice notice-bad', role: 'alert' }, [
            'Someone else changed this while you were editing it, so your changes were NOT saved (nothing was overwritten). ',
            h('button', { class: 'btn btn-small', type: 'button', onclick: function () { if (confirm('This will discard what you typed and open the newest version. Continue?')) { S.edit = null; viewEdit(kind, item.id); } } }, 'Open the newest version'),
          ]));
          banner.scrollIntoView({ block: 'center' });
        } else oops(e);
      }).then(function () {
        E.busy = false;
        [btnPublish, btnDraft, btnOff].forEach(function (b) { b.disabled = false; });
      });
    }
  }

  /* ---------- actions on an item ---------- */

  function publish(item) {
    api('POST', '/item/status', { kind: item.kind, id: item.id, sha: item.sha, status: 'published' }).then(function (res) {
      done(res, 'Published');
    }).catch(failed);
  }

  function unpublish(item) {
    confirmDialog({
      title: 'Unpublish this ' + KIND_NAME[item.kind].toLowerCase() + '?',
      body: 'It will be taken off the website within a few minutes. The text is kept safely and you can publish it again at any time.',
      quote: item.title, ok: 'Unpublish',
    }).then(function (yes) {
      if (!yes) return;
      return api('POST', '/item/status', { kind: item.kind, id: item.id, sha: item.sha, status: 'draft' }).then(function (res) {
        done(res, 'Unpublished');
        if (item.fromEditor && S.edit) { S.edit = null; location.hash = '#/drafts'; }
      });
    }).catch(failed);
  }

  function remove(item) {
    deleteDialog(item).then(function (choice) {
      if (choice === 'unpublish') return unpublish(item);
      if (choice !== 'delete') return;
      return api('POST', '/item/delete', { kind: item.kind, id: item.id, sha: item.sha, confirmTitle: item.title }).then(function (res) {
        done(res, 'Deleted');
      });
    }).catch(failed);
  }

  function done(res, what) {
    if (res.unchanged) flash('info', 'It was already like that — nothing changed.');
    else {
      flash('ok', what + '. The website is being updated — follow the progress at the bottom of the screen.');
      track({ title: res.title, what: what, commit: res.commit, expect: res.expect, kind: res.kind, slug: res.slug });
    }
    return load().then(route);
  }

  function failed(e) {
    if (!e) return;
    if (e.code === 'conflict') {
      flash('bad', 'Someone else changed this just now, so nothing was changed. The list has been refreshed — please try again.');
      return load().then(route);
    }
    oops(e);
  }

  /* ---------- dialogs ---------- */

  function openDialog(content) {
    var dlg = document.getElementById('modal');
    clear(dlg);
    dlg.appendChild(h('div', { class: 'modal-in' }, content));
    if (dlg.open) dlg.close();
    dlg.showModal();
    return dlg;
  }

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var dlg;
      var finish = function (v) { return function () { dlg.removeEventListener('close', onClose); dlg.close(); resolve(v); }; };
      var onClose = function () { resolve(false); };
      dlg = openDialog([
        h('h2', { text: o.title }), h('p', { text: o.body }), o.quote ? h('p', { class: 'quote', text: '“' + o.quote + '”' }) : null,
        h('div', { class: 'btns' }, [
          h('button', { class: 'btn', type: 'button', onclick: finish(false), autofocus: true }, 'Cancel'),
          h('button', { class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: finish(true) }, o.ok || 'OK'),
        ]),
      ]);
      dlg.addEventListener('close', onClose, { once: true });
    });
  }

  /* a dialog with its own content; validate() returns the value, or false to stay open */
  function askDialog(o, validate) {
    return new Promise(function (resolve) {
      var dlg;
      var onClose = function () { resolve(null); };
      dlg = openDialog([
        h('h2', { text: o.title }), o.body,
        h('div', { class: 'btns' }, [
          h('button', { class: 'btn', type: 'button', onclick: function () { dlg.close(); } }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
            var v = validate(); if (v === false) return;
            dlg.removeEventListener('close', onClose); dlg.close(); resolve(v);
          } }, o.ok),
        ]),
      ]);
      dlg.addEventListener('close', onClose, { once: true });
      var first = dlg.querySelector('input'); if (first) first.focus();
    });
  }

  function deleteDialog(item) {
    return new Promise(function (resolve) {
      var dlg;
      var finish = function (v) { return function () { dlg.removeEventListener('close', onClose); dlg.close(); resolve(v); }; };
      var onClose = function () { resolve(null); };
      dlg = openDialog([
        h('h2', { text: 'Delete permanently?' }),
        h('p', {}, ['Are you sure you want to permanently delete ', h('strong', { text: '“' + item.title + '”' }), '? This will remove it from the website and delete its files from the site’s storage.']),
        h('p', { class: 'hint', text: 'Good to know: older versions stay in the site’s history (that is how the storage works), so an administrator could still recover them. Nobody visiting the website will see it.' }),
        item.status === 'published' ? h('p', { class: 'notice notice-info', text: 'Not sure? “Unpublish instead” only hides it. You can bring it back later.' }) : null,
        h('div', { class: 'btns' }, [
          h('button', { class: 'btn', type: 'button', onclick: finish(null), autofocus: true }, 'Cancel'),
          item.status === 'published' ? h('button', { class: 'btn', type: 'button', onclick: finish('unpublish') }, 'Unpublish instead') : null,
          h('button', { class: 'btn btn-danger', type: 'button', onclick: finish('delete') }, 'Yes, delete permanently'),
        ]),
      ]);
      dlg.addEventListener('close', onClose, { once: true });
    });
  }

  /* ---------- did it reach the website? ---------- */

  var tracker = document.getElementById('tracker');
  var STEPS = ['Saved', 'Rebuilding the pages', 'Publishing to the website'];

  function track(op) {
    if (!op.commit) return;
    var steps = op.expect === 'none' ? ['Saved'] : STEPS;
    var list = h('ul', { class: 'steps' }, steps.map(function (t) { return h('li', { text: t }); }));
    var msg = h('p', { class: 'track-msg' });
    var admin = h('p', { class: 'track-admin', hidden: true });
    var card = h('div', { class: 'track', role: 'status' }, [
      h('div', { class: 'track-head' }, [
        h('p', { class: 'track-title', text: op.what + ': ' + (op.title || '') }),
        h('button', { class: 'track-x', type: 'button', 'aria-label': 'Dismiss', onclick: function () { stop(); card.remove(); tracker.hidden = !tracker.children.length; } }, '×'),
      ]),
      list, msg, admin,
    ]);
    tracker.appendChild(card); tracker.hidden = false;

    function paint(done, now, bad) {
      Array.prototype.forEach.call(list.children, function (li, i) {
        li.className = i < done ? 'done' : (i === now ? (bad ? 'bad' : 'now') : '');
      });
    }
    paint(1, steps.length > 1 ? 1 : -1);
    if (op.expect === 'none') { paint(1, -1); msg.textContent = 'Saved. It is not on the website, so there is nothing to publish.'; return; }

    var timer = null; var stopped = false; var started = Date.now(); var tries = 0;
    function stop() { stopped = true; clearTimeout(timer); }
    function poll() {
      if (stopped) return;
      tries++;
      api('GET', '/deploy?sha=' + op.commit + '&expect=' + op.expect + '&kind=' + op.kind + '&slug=' + encodeURIComponent(op.slug)).then(function (st) {
        msg.textContent = st.message || '';
        if (st.state === 'live') { paint(3, -1); load().then(function () { if (!S.edit) route(); }); return stop(); }
        if (st.state === 'build_failed' || st.state === 'build_missing') {
          paint(1, 1, true); admin.hidden = false; admin.textContent = 'For the administrator: ' + (st.detail || 'check the “Publish shared journal entries and stories” action in GitHub.') + (st.conclusion ? ' (' + st.conclusion + ')' : '');
          return stop();
        }
        if (st.state === 'deploy_failed') {
          paint(2, 2, true); admin.hidden = false; admin.textContent = 'For the administrator: ' + (st.detail || 'check the site’s Cloudflare build.');
          return stop();
        }
        paint(st.state === 'deploying' ? 2 : 1, st.state === 'deploying' ? 2 : 1);
        if (Date.now() - started > 15 * 60 * 1000) {
          msg.textContent = 'This is taking longer than usual. Your change is saved, but it is not confirmed live yet. If it still isn’t there in a little while, tell an administrator.';
          return stop();
        }
        timer = setTimeout(poll, tries < 5 ? 3000 : 6000);
      }).catch(function (e) {
        if (e && e.code === 'unauthenticated') return stop();
        msg.textContent = 'Checking… (' + (e && e.message ? e.message : 'no answer') + ')';
        timer = setTimeout(poll, 8000);
      });
    }
    timer = setTimeout(poll, 2500);
  }

  /* ---------- routing ---------- */

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('?');
    var query = {};
    (parts[1] || '').split('&').forEach(function (kv) { if (kv) { var p = kv.split('='); query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } });
    return { path: parts[0].split('/').map(decodeURIComponent), query: query };
  }

  function route() {
    /* nothing can be drawn before the data has loaded: try loading it again */
    if (!S.stats) { start(); return; }
    var r = parseHash();
    var first = r.path[0] || 'home';
    var nav = first === 'edit' ? (r.path[1] === 'story' ? 'stories' : 'journals') : first;
    Array.prototype.forEach.call(document.querySelectorAll('#nav a[data-route]'), function (a) {
      if (a.getAttribute('data-route') === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.getElementById('nav').classList.remove('open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
    document.title = 'Editor dashboard — Druk.help';
    if (first !== 'edit') S.edit = null;

    if (first === 'home') viewHome();
    else if (TITLES[first]) viewList(first, r.query);
    else if (first === 'pending') r.path[1] ? viewPendingOne(r.path[1]) : viewPending();
    else if (first === 'activity') viewActivity();
    else if (first === 'edit' && PAGES[r.path[1]] && r.path[2]) viewEdit(r.path[1], r.path[2]);
    else { location.hash = '#/'; return; }
    S.hash = location.hash;
  }

  var reverting = false;
  window.addEventListener('hashchange', function () {
    if (reverting) { reverting = false; return; }
    if (S.edit && S.edit.dirty() && location.hash !== S.hash) {
      if (!confirm('You have changes that are not saved. Leave without saving them?')) {
        reverting = true; location.hash = S.hash; return;
      }
      S.edit = null;
    }
    route();
    document.getElementById('main').focus({ preventScroll: true });
  });
  window.addEventListener('beforeunload', function (e) {
    if (S.edit && S.edit.dirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  document.getElementById('menu-btn').addEventListener('click', function () {
    var nav = document.getElementById('nav');
    var open = nav.classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
  });

  /* ---------- start ---------- */

  function start() {
    show(h('p', { class: 'loading', text: 'Loading…' }));
    api('GET', '/me').then(function (me) {
      S.me = me;
      return load();
    }).then(route).catch(function (e) {
      if (e && e.code === 'unauthenticated') return;
      show([
        h('h1', { text: 'The dashboard could not open' }),
        h('p', { class: 'notice notice-bad', text: e && e.message ? e.message : 'Something went wrong.' }),
        h('button', { class: 'btn', type: 'button', onclick: function () { location.reload(); } }, 'Try again'),
      ]);
    });
  }

  document.getElementById('logout').addEventListener('click', function (e) {
    e.preventDefault();
    setToken('');
    showLogin('');
  });

  start();
})();
