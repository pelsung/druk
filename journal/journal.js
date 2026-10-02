/* ==========================================================================
   Druk.help — journal runtime
   Drives three things:
     1. the reveal-on-scroll motion used across the site,
     2. Journal & Stories, Stories and Share your story,
     3. an article page: reading time, side panel, progress bar, more cards.
   No build step, no dependencies.
   ========================================================================== */
(function () {
  'use strict';

  /* One runtime, two collections: a story page sets DRUK_ITEMS before
     loading this file; a journal page leaves it unset and uses DRUK_ENTRIES. */
  var POSTS = (window.DRUK_ITEMS || window.DRUK_ENTRIES || []).slice().sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date));
  });

  /* ---------- helpers ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function formatDate(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3) return iso || '';
    var months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    var month = months[parseInt(parts[1], 10) - 1];
    if (!month) return iso;
    return parseInt(parts[2], 10) + ' ' + month + ' ' + parts[0];
  }

  function postUrl(post) {
    return post.url || (post.slug + '.html');
  }

  /* ---------- 1. reveal on scroll ---------- */

  function initReveal() {
    var targets = document.querySelectorAll('[data-reveal]');
    if (!targets.length) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(targets, function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(targets, function (n) { io.observe(n); });
  }

  /* ---------- 2. Journal & Stories, Stories, Share your story ----------
     The two listing pages live one folder below the site root (journal/ and
     stories/), so every link to an entry, a story or an image starts at ../ */

  var ENTRIES = (window.DRUK_ENTRIES || []).slice().sort(byDate);
  var STORIES = (window.DRUK_STORIES || []).slice().sort(byDate);

  /* sync-core.js, loaded before this file on the listing and share pages */
  var core = globalThis.DrukJournal;

  /* a story's topic is whatever its writer typed; the usual ones have an icon */
  var TOPIC_ICONS = { 'health & wellbeing': 'heart', 'caregiving': 'hands', 'disability': 'person', 'palliative care': 'leaf' };

  function byDate(a, b) { return String(b.date).localeCompare(String(a.date)); }

  /* 28 Sep 2026 — for cards, where the full month name wraps */
  function shortDate(iso) {
    var long = formatDate(iso);
    return long.replace(/ ([A-Z][a-z]{2})[a-z]+ /, ' $1 ');
  }

  /* "Pema, Thimphu · 28 Sep 2026", or just the date when there is no name */
  function byline(item) {
    return (item.author ? item.author + ' · ' : '') + shortDate(item.date);
  }

  /* the most telling tag: every entry is about Bhutan, so skip that one */
  function entryTopic(entry) {
    var tags = entry.tags || [];
    return tags.filter(function (t) { return t !== 'Bhutan'; })[0] || tags[0] || '';
  }

  function topicOf(story) {
    var name = (core && core.cleanTopic(story.category)) || story.category || 'Other';
    return {
      name: name,
      color: core ? core.topicColor(name) : 'var(--topic-other)',
      icon: TOPIC_ICONS[name.toLowerCase()] || 'dots'
    };
  }

  /* the topics stories are filed under, most stories first */
  function topicsInUse() {
    return core ? core.topicGroups(STORIES).map(function (g) { return Object.assign(topicOf({ category: g.name }), { count: g.count }); }) : [];
  }

  function sameTopic(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  function pageUrl(kind, item) {
    return '../' + (kind === 'story' ? 'stories/' : 'journal/') + item.slug + '.html';
  }

  function imageUrl(kind, item) {
    return item.image ? '../' + (kind === 'story' ? 'stories/' : 'journal/') + item.image : '';
  }

  /* line icons, drawn with currentColor */
  var ICONS = {
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7h8M8 11h6"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.6 6-5.6s5.4 2 6 5.6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.1 4.4 1.9 5 5.1"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    notes: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    hands: '<path d="M4 14l4-4 3 3 5-5 4 4"/><path d="M4 18h16"/>',
    person: '<circle cx="12" cy="6" r="2.5"/><path d="M12 9v6M8 12h8M9 21l3-6 3 6"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l7-7"/>',
    dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7z"/><path d="M12 14c0-3-2.5-5.5-7-5.5 0 3 2.5 5.5 7 5.5z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.8"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  function icon(name, size) {
    var s = size || 18;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', s);
    svg.setAttribute('height', s);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  /* A story without a photo gets a quiet landscape in its topic's colour. */
  function landscape(color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 200');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.color = color;
    svg.innerHTML =
      '<rect width="320" height="200" fill="#EFE7D8"/>' +
      '<circle cx="238" cy="58" r="20" fill="currentColor" opacity=".18"/>' +
      '<path d="M0 150 L60 92 L104 128 L162 66 L222 124 L262 98 L320 140 V200 H0Z" fill="currentColor" opacity=".22"/>' +
      '<path d="M0 172 L70 128 L128 160 L196 112 L256 152 L320 130 V200 H0Z" fill="currentColor" opacity=".38"/>' +
      '<path d="M40 38 Q110 64 180 40" fill="none" stroke="#231A12" stroke-opacity=".18"/>' +
      '<g opacity=".55"><rect x="62" y="44" width="9" height="12" fill="#D9A62E"/><rect x="92" y="51" width="9" height="12" fill="#8E2B1F"/><rect x="122" y="52" width="9" height="12" fill="#4E7A46"/><rect x="152" y="46" width="9" height="12" fill="#3F6E9D"/></g>';
    return svg;
  }

  function media(kind, item, alt, color) {
    var url = imageUrl(kind, item);
    if (!url) return landscape(color || 'var(--topic-other)');
    return el('img', { src: url, alt: alt || '', loading: 'lazy' });
  }

  function fill(host, nodes) {
    if (!host) return;
    host.textContent = '';
    nodes.forEach(function (node) { host.appendChild(node); });
  }

  /* ---------- links to an article ----------
     "Read more" and every card go straight to the article's own page. Old
     links in the #read=journal/<slug> form are sent there too. */

  function forwardOldReadLinks() {
    var match = location.hash.match(/^#read=(journal|stories)\/([a-z0-9-]+)$/);
    if (match) location.replace(pageUrl(match[1] === 'stories' ? 'story' : 'journal', { slug: match[2] }));
  }

  /* ---------- Journal & Stories ---------- */

  function initHub() {
    var feature = document.getElementById('jx-feature');
    if (!feature) return;

    var lead = ENTRIES[0];
    if (!lead) {
      fill(feature, [el('p', { class: 'jx-empty-note', text: 'The first journal entry is on its way.' })]);
    } else {
      var mediaLink = el('a', { class: 'jx-feature-media', href: pageUrl('journal', lead), tabindex: '-1', 'aria-hidden': 'true' }, [media('journal', lead)]);
      var text = el('div', {}, [
        el('p', { class: 'jx-kind' }, [icon('notes', 16), document.createTextNode('Field notes')]),
        el('h2', {}, [el('a', { href: pageUrl('journal', lead), style: 'color: inherit', text: lead.title })]),
        el('p', { class: 'jx-excerpt', text: lead.excerpt || '' }),
        el('span', { class: 'dh-meta', text: formatDate(lead.date) + ' · ' + (lead.author || 'Druk.help') }),
        el('a', { class: 'jx-read', href: pageUrl('journal', lead) }, [document.createTextNode('Read more'), icon('arrow', 16)])
      ]);
      fill(feature, [mediaLink, text]);
    }

    /* the rest of the entries, four at a time */
    var rest = ENTRIES.slice(1);
    var row = document.getElementById('jx-entries');
    var all = document.getElementById('jx-all');
    var showing = 4;
    function renderRow() {
      fill(row, rest.slice(0, showing).map(function (entry) {
        var card = el('a', { class: 'jx-card', href: pageUrl('journal', entry) }, [
          el('span', { class: 'dh-meta', text: shortDate(entry.date) })
        ]);
        if (entryTopic(entry)) card.appendChild(el('span', { class: 'jx-topic', text: entryTopic(entry) }));
        card.appendChild(el('h3', { text: entry.title }));
        if (entry.excerpt) card.appendChild(el('p', { text: entry.excerpt }));
        if (entry.image) card.appendChild(el('span', { class: 'jx-card-media' }, [media('journal', entry)]));
        return el('li', {}, [card]);
      }));
      if (all) all.hidden = rest.length <= showing;
    }
    var section = document.getElementById('jx-entries-section');
    if (section) section.hidden = !rest.length;
    if (all) all.addEventListener('click', function () { showing = rest.length; renderRow(); });
    renderRow();

    /* stories in the side panel */
    var voices = document.getElementById('jx-stories');
    if (!voices) return;
    if (!STORIES.length) {
      fill(voices, [el('div', { class: 'jx-empty-note' }, [icon('sprout', 28), document.createTextNode('No stories yet. Yours could be the first to help someone else.')])]);
      return;
    }
    var top = STORIES[0];
    var nodes = [el('a', { class: 'jx-voice', href: pageUrl('story', top) }, [
      el('span', { class: 'jx-voice-media' }, [media('story', top, '', topicOf(top).color)]),
      el('span', {}, [
        el('blockquote', { text: top.excerpt || top.title }),
        el('span', { class: 'dh-meta', text: byline(top) })
      ])
    ])];
    var more = STORIES.slice(1, 4);
    if (more.length) {
      nodes.push(el('div', { class: 'jx-more-voices' }, [
        el('p', { text: 'More voices' }),
        el('ol', {}, more.map(function (story) {
          return el('li', {}, [el('a', { class: 'jx-mini', href: pageUrl('story', story) }, [
            media('story', story, '', topicOf(story).color),
            el('span', {}, [el('b', { text: story.title }), el('small', { text: story.author || shortDate(story.date) })])
          ])]);
        }))
      ]));
    }
    fill(voices, nodes);
  }

  /* ---------- Stories ---------- */

  function initStories() {
    var grid = document.getElementById('st-grid');
    if (!grid) return;

    var chips = document.getElementById('st-chips');
    var topics = document.getElementById('st-topics');
    var empty = document.getElementById('st-empty');
    var moreWrap = document.getElementById('st-more');
    var active = '';
    var showing = 6;

    function setTopic(name) {
      active = name;
      showing = 6;
      Array.prototype.forEach.call(document.querySelectorAll('[data-topic]'), function (button) {
        button.setAttribute('aria-pressed', sameTopic(button.getAttribute('data-topic'), name) ? 'true' : 'false');
      });
      render();
    }

    /* the chips are the topics writers have used, most stories first */
    var inUse = topicsInUse();
    var chipNodes = [el('button', { type: 'button', class: 'st-chip', 'data-topic': '', 'aria-pressed': 'true', text: 'All Stories' })]
      .concat(inUse.map(function (topic) {
        return el('button', { type: 'button', class: 'st-chip', 'data-topic': topic.name, 'aria-pressed': 'false', text: topic.name });
      }));
    chipNodes.forEach(function (chip) {
      chip.addEventListener('click', function () { setTopic(chip.getAttribute('data-topic')); });
    });
    fill(chips, chipNodes);

    fill(topics, !inUse.length ? [el('li', { class: 'st-topics-empty', text: 'Topics appear here as stories are shared.' })] : inUse.map(function (topic) {
      var count = topic.count;
      var iconWrap = el('span', { class: 'st-topic-icon' }, [icon(topic.icon, 16)]);
      var button = el('button', { type: 'button', 'data-topic': topic.name, 'aria-pressed': 'false', style: '--dot: ' + topic.color }, [
        iconWrap, el('span', { text: topic.name }), el('span', { class: 'st-count', text: String(count) })
      ]);
      button.addEventListener('click', function () { setTopic(sameTopic(active, topic.name) ? '' : topic.name); });
      return el('li', {}, [button]);
    }));

    function render() {
      var matches = STORIES.filter(function (s) { return !active || sameTopic(topicOf(s).name, active); });
      fill(grid, matches.slice(0, showing).map(function (story) {
        var topic = topicOf(story);
        return el('a', { class: 'st-card', href: pageUrl('story', story) }, [
          el('span', { class: 'st-card-media' }, [media('story', story, '', topic.color), el('span', { class: 'st-badge', text: topic.name })]),
          el('span', { class: 'st-card-body' }, [
            el('h3', { text: story.title }),
            el('p', { text: story.excerpt || '' }),
            el('span', { class: 'dh-meta', text: byline(story) }),
            el('span', { class: 'jx-read-label', text: 'Read story →' })
          ])
        ]);
      }));
      grid.hidden = !matches.length;
      if (empty) {
        empty.hidden = matches.length !== 0;
        var heading = empty.querySelector('h3');
        if (heading) heading.textContent = STORIES.length ? 'No ' + active + ' stories yet' : 'No stories yet';
      }
      if (moreWrap) moreWrap.hidden = matches.length <= showing;
    }

    if (moreWrap) {
      moreWrap.querySelector('button').addEventListener('click', function () { showing += 6; render(); });
    }

    /* the front page's topic links arrive as ?topic=Caregiving */
    var asked = new URLSearchParams(location.search).get('topic');
    var match = asked && inUse.filter(function (t) { return sameTopic(t.name, asked); })[0];
    if (match) setTopic(match.name);
    else render();
  }

  /* ---------- Share your journal or story ----------
     A journal entry follows the journal template (date, photo, caption, what
     happened as a witness saw it, a reflection on three questions, within 100
     words); a story is in its writer's own words, under a topic they choose.
     Both are reviewed on screen before they are published. The template's
     questions, the word limit and the formatting all come from sync-core.js,
     which the worker and the site build use too. */

  function initShare() {
    var form = document.getElementById('share-form');
    if (!form || !core) return;
    var find = function (selector) { return form.querySelector(selector); };
    var each = function (nodes, fn) { Array.prototype.forEach.call(nodes, fn); };
    var LIMIT = core.JOURNAL_WORD_LIMIT;

    var review = document.getElementById('share-review');
    var preview = document.getElementById('share-preview');
    var titleInput = find('#s-title');
    var dateInput = find('#j-date');
    var photoInput = find('#s-photo');
    var photoState = find('#s-photo-state');
    var photoTextField = find('#s-photo-text-field');
    var photoText = find('#s-photo-text');
    var storyCount = find('#s-count');
    var journalCount = find('#j-count');
    var photo = null;   /* { type, data, url } once a photo is chosen */

    /* topic ideas: the usual ones, and any a published story already uses */
    var seen = {};
    core.SUGGESTED_TOPICS.concat(topicsInUse().map(function (t) { return t.name; })).forEach(function (name) {
      if (seen[name.toLowerCase()]) return;
      seen[name.toLowerCase()] = true;
      find('#s-topic-ideas').appendChild(el('option', { value: name }));
    });

    /* the reflection questions, from the same list the worker checks */
    core.REFLECTION.forEach(function (r) {
      find('#j-reflection').appendChild(el('div', { class: 'field' }, [
        el('label', { for: 'j-' + r.key, text: r.question }),
        el('textarea', { id: 'j-' + r.key, rows: '2', required: '' })
      ]));
    });

    dateInput.value = core.today();
    dateInput.max = core.today();

    function kind() { return find('input[name="kind"]:checked').value; }

    function journalParts() {
      var parts = { description: find('#j-description').value };
      core.REFLECTION.forEach(function (r) { parts[r.key] = find('#j-' + r.key).value; });
      return parts;
    }

    function counted() {
      if (kind() === 'journal') {
        var words = core.journalWordCount(journalParts());
        journalCount.textContent = words + ' / ' + LIMIT + ' words';
        journalCount.classList.toggle('is-over', words > LIMIT);
        return words;
      }
      var n = core.countWords(find('#s-story').value);
      storyCount.textContent = n + (n === 1 ? ' word' : ' words');
      return n;
    }

    /* a journal entry always has a photo and a caption; a story may have a photo */
    function photoFields() {
      var journal = kind() === 'journal';
      photoInput.required = journal && !photo;
      photoText.required = journal;
      photoTextField.hidden = !journal && !photo;
      photoText.placeholder = journal ? 'The district team showing us their patient register' : 'Prayer flags over a river bridge';
    }

    function kindChanged() {
      var current = kind();
      var journal = current === 'journal';
      each(document.querySelectorAll('[data-for]'), function (node) {
        var on = node.getAttribute('data-for') === current;
        node.hidden = !on;
        /* a hidden required field would block sending */
        each(node.querySelectorAll('input, textarea'), function (input) { input.disabled = !on; });
      });
      each(form.querySelectorAll('[data-kind-word]'), function (n) { n.textContent = journal ? 'Journal entry' : 'Story'; });
      titleInput.placeholder = journal ? 'Meeting the palliative care team in Mongar' : 'Finding strength in small steps';
      photoFields();
      counted();
    }

    if (/[?&]type=journal\b/.test(location.search)) find('input[name="kind"][value="journal"]').checked = true;
    each(form.querySelectorAll('input[name="kind"]'), function (radio) { radio.addEventListener('change', kindChanged); });
    form.addEventListener('input', counted);
    kindChanged();

    /* photos are shrunk in the browser, so a phone picture sends quickly */
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      photo = null;
      photoState.hidden = true;
      photoFields();
      if (!file) return;
      shrink(file, 1600).then(function (dataUrl) {
        photo = { type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), url: dataUrl };
        photoState.querySelector('img').src = dataUrl;
        photoState.hidden = false;
        photoFields();
      }).catch(function () { status('That photo could not be read. Try a JPG or PNG.', true); });
    });
    find('#s-photo-clear').addEventListener('click', function () {
      photo = null;
      photoInput.value = '';
      photoState.hidden = true;
      photoFields();
    });

    function say(element, message, isError) {
      element.textContent = message;
      element.className = 'sh-status' + (isError ? ' is-error' : '');
    }
    var formStatus = find('#s-status');
    var reviewStatus = document.getElementById('share-review-status');
    function status(message, isError) { say(formStatus, message, isError); }

    /* the bot check only appears once a Turnstile site key is filled in */
    var check = find('.cf-turnstile');
    if (check && check.getAttribute('data-sitekey')) {
      check.hidden = false;
      document.head.appendChild(el('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js', async: '', defer: '' }));
    }

    function payload() {
      var turnstile = form.querySelector('[name="cf-turnstile-response"]');
      var p = {
        kind: kind(),
        title: titleInput.value,
        consent: find('#s-consent').checked,
        website: find('#s-website').value,
        turnstile: turnstile ? turnstile.value : ''
      };
      if (p.kind === 'journal') {
        p.date = dateInput.value;
        Object.assign(p, journalParts());
      } else {
        p.topic = find('#s-topic').value;
        p.story = find('#s-story').value;
        p.name = find('#s-name').value;
      }
      if (photo) {
        p.photo = { type: photo.type, data: photo.data };
        p.photo[p.kind === 'journal' ? 'caption' : 'alt'] = photoText.value;
      }
      return p;
    }

    /* step 1: check, then show it exactly as it will appear */
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      status('');
      if (!form.reportValidity()) return;
      if (kind() === 'journal') {
        var words = counted();
        if (words > LIMIT) {
          status('Keep the journal entry within ' + LIMIT + ' words — it has ' + words + '. Trim a sentence or two.', true);
          return;
        }
        if (!photo) { status('Add a photo — every journal entry has one.', true); return; }
      }

      var p = payload();
      var journal = p.kind === 'journal';
      var nodes = [
        el('p', { class: 'dh-meta', text: journal
          ? core.humanDate(p.date) + ' · Druk.help'
          : core.cleanTopic(p.topic) + ' · ' + p.name.trim() + ' · ' + core.humanDate(core.today()) }),
        el('h1', { text: p.title.trim() })
      ];
      if (photo) {
        var figure = el('figure', {}, [el('img', { src: photo.url, alt: photoText.value })]);
        if (journal && photoText.value.trim()) figure.appendChild(el('figcaption', { text: photoText.value.trim() }));
        nodes.push(figure);
      }
      var body = el('div', { class: 'post-body' });
      /* the same safe rendering the site build uses */
      body.innerHTML = core.withReflection(core.renderBody(journal ? core.journalBody(p) : p.story, '', { safe: true }));
      nodes.push(body);
      if (journal) nodes.push(el('p', { class: 'dh-meta sh-words', text: core.journalWordCount(p) + ' of ' + LIMIT + ' words' }));
      fill(preview, nodes);

      say(reviewStatus, '');
      form.hidden = true;
      review.hidden = false;
      review.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('share-edit').addEventListener('click', function () {
      review.hidden = true;
      form.hidden = false;
      titleInput.focus();
    });

    /* step 2: publish — it goes to the team as a pull request */
    var meta = document.querySelector('meta[name="studio-api"]');
    var endpoint = meta ? meta.content.replace(/\/+$/, '') : '';
    var publish = document.getElementById('share-publish');
    publish.addEventListener('click', function () {
      /* the endpoint is still the placeholder: this copy of the site (opened
         from disk, or from a plain file server) has nowhere to send to */
      if (/YOUR-ACCOUNT/.test(endpoint)) {
        say(reviewStatus, 'Sending is not connected on this copy of the site, so nothing was sent — what you wrote is still here. ' +
          'To try it on this computer, run  node studio-api/local.mjs  in the druk folder and open http://localhost:8080/stories/share.html', true);
        return;
      }
      var p = payload();
      publish.disabled = true;
      say(reviewStatus, 'Publishing…');
      fetch(endpoint + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || 'It could not be sent.');
        });
      }).then(function () {
        review.hidden = true;
        if (p.kind === 'journal') {
          var back = document.getElementById('share-done-link');
          back.href = '../journal/index.html';
          back.firstChild.textContent = 'Read the journal ';
        }
        document.getElementById('share-done').hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }).catch(function (error) {
        say(reviewStatus, error.message && error.message !== 'Failed to fetch'
          ? error.message
          : 'It could not be sent. Check your connection and try again — nothing you wrote has been lost.', true);
        publish.disabled = false;
      });
    });
  }



  function shrink(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }



  /* ---------- 3. post page extras ---------- */

  function initReadingTime() {
    var slot = document.querySelector('[data-reading-time]');
    var body = document.querySelector('.post-body');
    if (!slot || !body) return;
    var words = (body.textContent || '').trim().split(/\s+/).length;
    slot.textContent = Math.max(1, Math.round(words / 200)) + ' min read';
  }

  function shortDate(iso) {
    var parts = String(iso || '').split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var month = months[parseInt(parts[1], 10) - 1];
    return month ? parseInt(parts[2], 10) + ' ' + month + ' ' + parts[0] : (iso || '');
  }

  var ARROW_UP_RIGHT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';

  function moreCard(href, media, meta, title, excerpt, extraClass) {
    var text = el('span', { class: 'more-card-text' }, [meta, el('h3', { text: title })]);
    if (excerpt) text.appendChild(el('p', { text: excerpt }));
    var go = el('span', { class: 'more-card-go', 'aria-hidden': 'true' });
    go.innerHTML = ARROW_UP_RIGHT;
    return el('a', { class: 'more-card' + (extraClass ? ' ' + extraClass : ''), href: href }, [media, text, go]);
  }

  function initMorePosts() {
    var grid = document.getElementById('more-grid');
    if (!grid) return;

    var current = grid.getAttribute('data-current-slug') || '';
    var currentPost = POSTS.filter(function (p) { return p.slug === current; })[0];
    var currentTags = (currentPost && currentPost.tags) || [];

    var others = POSTS.filter(function (post) { return post.slug !== current; });
    others.sort(function (a, b) {
      var shared = function (post) {
        return (post.tags || []).filter(function (t) { return currentTags.indexOf(t) !== -1; }).length;
      };
      var diff = shared(b) - shared(a);
      return diff !== 0 ? diff : String(b.date).localeCompare(String(a.date));
    });

    var picks = others.slice(0, 3);
    if (!picks.length) {
      var section = document.getElementById('post-more');
      if (section) section.hidden = true;
      return;
    }

    picks.forEach(function (post) {
      /* entries and their images sit in the same folder as this page */
      var media = post.image
        ? el('span', { class: 'more-card-media' }, [el('img', { src: post.image, alt: '', loading: 'lazy' })])
        : el('span', { class: 'more-card-media is-empty' }, [el('span', { class: 'dh-flagmark', 'aria-hidden': 'true' })]);
      var topic = post.category || (post.tags || [])[0];
      var meta = el('span', { class: 'more-card-meta' }, [el('time', { datetime: post.date, text: shortDate(post.date) })]);
      if (topic) {
        meta.appendChild(el('i', { 'aria-hidden': 'true' }));
        meta.appendChild(el('span', { text: topic }));
      }
      grid.appendChild(moreCard(postUrl(post), media, meta, post.title, post.excerpt));
    });

    /* fewer than three to show: the last place invites the next one */
    var count = picks.length;
    if (count < 3) {
      var story = !!window.DRUK_ITEMS;
      grid.appendChild(moreCard(
        story ? 'share.html' : '../stories/share.html?type=journal',
        el('span', { class: 'more-card-media is-invite', 'aria-hidden': 'true' }),
        el('span', { class: 'more-card-meta', text: 'Your turn' }),
        story ? 'Share your story' : 'Share a journal entry',
        story ? 'Your experience can help others.' : 'A short field note from a meeting or a visit.',
        'more-card--invite'));
      count++;
    }
    grid.setAttribute('data-count', String(count));
  }

  /* the side panel and reading progress on an article page */
  function initPostPage() {
    var article = document.querySelector('article.post');
    var body = article && article.querySelector('.post-body');
    if (!body) return;

    /* "In this article": every heading, with smaller headings and a journal
       entry's three reflection questions as points beneath them. An opening
       before the first heading is listed as the Overview. */
    var toc = article.querySelector('.post-toc');
    var stops = Array.prototype.map.call(
      body.querySelectorAll('h2, h3, .post-reflect p > strong:first-child'),
      function (node) {
        var heading = /^H[23]$/.test(node.tagName);
        return { target: heading ? node : node.parentNode, label: node.textContent.trim(), sub: node.tagName !== 'H2' };
      }).filter(function (stop) { return stop.label; });
    var first = body.firstElementChild;
    if (stops.length && first && first !== stops[0].target) {
      stops.unshift({ target: body, label: 'Overview', sub: false });
    }
    if (toc && stops.length > 1) {
      var list = toc.querySelector('ol');
      var links = stops.map(function (stop, i) {
        if (!stop.target.id) stop.target.id = stop.target === body ? 'overview' : 'section-' + i;
        var link = el('a', { href: '#' + stop.target.id, text: stop.label });
        list.appendChild(el('li', stop.sub ? { class: 'is-sub' } : {}, [link]));
        return link;
      });
      toc.hidden = false;
      var mark = function () {
        var current = 0;
        stops.forEach(function (stop, i) {
          if (stop.target !== body && stop.target.getBoundingClientRect().top < 160) current = i;
        });
        links.forEach(function (link, i) { link.setAttribute('aria-current', i === current ? 'true' : 'false'); });
      };
      window.addEventListener('scroll', mark, { passive: true });
      mark();
    }

    /* "Share this article": each network gets the page's address and title */
    var share = article.querySelector('.post-share');
    if (share) {
      var canonical = document.querySelector('link[rel="canonical"]');
      var url = canonical ? canonical.href : window.location.href;
      var title = ((article.querySelector('h1') || {}).textContent || document.title).trim();
      var u = encodeURIComponent(url);
      var t = encodeURIComponent(title);
      var targets = {
        x: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t,
        facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
        linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u,
        whatsapp: 'https://wa.me/?text=' + t + '%20' + u
      };
      Array.prototype.forEach.call(share.querySelectorAll('[data-share-to]'), function (link) {
        var href = targets[link.getAttribute('data-share-to')];
        if (href) link.href = href;
      });

      var note = share.querySelector('.post-share-note');
      var copy = share.querySelector('[data-copy-link]');
      var copied = function () {
        copy.classList.add('is-done');
        if (note) note.textContent = 'Link copied';
        setTimeout(function () {
          copy.classList.remove('is-done');
          if (note) note.textContent = '';
        }, 2000);
      };
      if (copy) copy.addEventListener('click', function () {
        var fallback = function () {
          var field = el('textarea', { readonly: '', style: 'position:fixed;opacity:0' });
          field.value = url;
          document.body.appendChild(field);
          field.select();
          try { document.execCommand('copy'); copied(); } catch (e) { window.prompt('Copy this link:', url); }
          field.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(copied, fallback);
        } else {
          fallback();
        }
      });
    }

    /* a thin bar under the header fills as the article is read */
    var header = document.querySelector('.dh-header');
    if (header) {
      var fill = el('span');
      header.appendChild(el('div', { class: 'post-progress', 'aria-hidden': 'true' }, [fill]));
      var ticking = false;
      var draw = function () {
        ticking = false;
        var box = body.getBoundingClientRect();
        var span = box.height - window.innerHeight * 0.6;
        var done = span > 0 ? (window.innerHeight * 0.4 - box.top) / span : 1;
        fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, done)) + ')';
      };
      var queue = function () { if (!ticking) { ticking = true; window.requestAnimationFrame(draw); } };
      window.addEventListener('scroll', queue, { passive: true });
      window.addEventListener('resize', queue);
      draw();
    }
  }

  /* ---------- 4. mobile menu ---------- */

  function initMobileNav() {
    var burger = document.querySelector('.dh-burger');
    var panel = document.getElementById('journal-mobile-nav');
    if (!burger || !panel) return;

    function setOpen(open) {
      panel.setAttribute('data-open', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    burger.addEventListener('click', function () {
      setOpen(panel.getAttribute('data-open') !== 'true');
    });

    /* a tap on any link closes the panel behind it */
    Array.prototype.forEach.call(panel.querySelectorAll('a'), function (link) {
      link.addEventListener('click', function () { setOpen(false); });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 1024) setOpen(false);
    });

    setOpen(false);
  }

  /* ---------- boot ---------- */

  function boot() {
    initMobileNav();
    forwardOldReadLinks();
    initHub();
    initStories();
    initShare();
    initReadingTime();
    initMorePosts();
    initPostPage();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
