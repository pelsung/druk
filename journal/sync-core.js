/* ==========================================================================
   Druk.help — journal core

   Pure functions shared by the share endpoint (studio-api/) and the Node scripts
   (new-entry.mjs, sync.mjs). No file access, no DOM: give it entries, it gives
   back strings. Loading this file sets globalThis.DrukJournal, which works both
   as a <script src> in the browser and as an import in Node.
   ========================================================================== */

(function () {
  'use strict';

  var SITE_ORIGIN = 'https://druk.help';
  var HOME_CARDS = 3;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- small helpers ---------- */

  function today() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function humanDate(iso) {
    var parts = String(iso).split('-');
    if (parts.length !== 3) return String(iso);
    var month = MONTHS[parseInt(parts[1], 10) - 1];
    if (!month) return String(iso);
    return parseInt(parts[2], 10) + ' ' + month + ' ' + parts[0];
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function slugify(text) {
    return String(text)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  /* Straight quotes become curly so text is safe in attributes, HTML and the
     JSON-LD block alike — and reads better anyway. */
  function curl(text) {
    return String(text)
      .replace(/"([^"]*)"/g, '“$1”')
      .replace(/"/g, '”')
      .replace(/(\w)'(\w)/g, '$1’$2')
      .replace(/'/g, '’');
  }

  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
  }

  /* Journal entries are numbered by their date, oldest first: 01, 02, …
     An entry dated earlier than others takes its place in that order, and
     the ones after it move up by one. Entries from the same day are numbered
     in the order entries.js lists them, from the bottom up.
     Returns { slug: "05", … }. */
  function entryNumbers(entries) {
    var order = (entries || []).map(function (entry, index) {
      return { entry: entry, index: index };
    }).sort(function (a, b) {
      return String(a.entry.date).localeCompare(String(b.entry.date)) || b.index - a.index;
    });
    var width = Math.max(2, String(order.length).length);
    var numbers = {};
    order.forEach(function (item, n) {
      numbers[item.entry.slug] = String(n + 1).padStart(width, '0');
    });
    return numbers;
  }

  /* ---------- entries.js ---------- */

  var ENTRIES_HEADER = [
    '/* ==========================================================================',
    '   Druk.help — journal entries',
    '   The single list that drives the journal index, the "From the journal"',
    '   cards on the landing page, and sitemap.xml.',
    '',
    '   Add one with a pull request: a Markdown file in content/journal/,',
    '   or from a terminal:  node journal/new-entry.mjs "Your entry title"',
    '   ========================================================================== */',
    '',
    'window.DRUK_ENTRIES = ',
  ].join('\n');

  function entriesFile(entries) {
    var body = sortEntries(entries).map(function (entry) {
      return '  ' + JSON.stringify(entry, null, 2).split('\n').join('\n  ');
    }).join(',\n');
    return ENTRIES_HEADER + '[\n' + body + '\n];\n';
  }

  /* Reads an entries.js file back into an array. */
  function parseEntriesFile(source) {
    var start = source.indexOf('[');
    var end = source.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No entry array found in entries.js');
    return JSON.parse(source.slice(start, end + 1));
  }

  /* ---------- sitemap.xml ---------- */

  function sitemapXml(entries, homeLastmod, stories) {
    var sorted = sortEntries(entries);
    var tales = sortEntries(stories || []);
    var both = mergeFeed(sorted, tales);
    var newest = both.length ? both[0].date : homeLastmod;
    /* /journal/ is the Journal & Stories front door; /stories/ lists stories */
    var rows = [
      { loc: SITE_ORIGIN + '/', lastmod: homeLastmod, changefreq: 'monthly', priority: '1.0' },
      { loc: SITE_ORIGIN + '/journal/', lastmod: newest, changefreq: 'weekly', priority: '0.8' },
      { loc: SITE_ORIGIN + '/stories/', lastmod: tales.length ? tales[0].date : newest, changefreq: 'weekly', priority: '0.8' },
    ].concat(sorted.map(function (entry) {
      return {
        loc: SITE_ORIGIN + '/journal/' + entry.slug + '.html',
        lastmod: entry.date, changefreq: 'yearly', priority: '0.7',
      };
    })).concat(tales.map(function (story) {
      return {
        loc: SITE_ORIGIN + '/stories/' + story.slug + '.html',
        lastmod: story.date, changefreq: 'yearly', priority: '0.7',
      };
    }));

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ].concat(rows.map(function (row) {
      return [
        '  <url>',
        '    <loc>' + row.loc + '</loc>',
        '    <lastmod>' + row.lastmod + '</lastmod>',
        '    <changefreq>' + row.changefreq + '</changefreq>',
        '    <priority>' + row.priority + '</priority>',
        '  </url>',
      ].join('\n');
    })).concat(['</urlset>', '']).join('\n');
  }

  function homeLastmodFrom(sitemapSource) {
    var match = String(sitemapSource || '')
      .match(/<loc>https:\/\/druk\.help\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/);
    return match ? match[1] : today();
  }

  /* ---------- the landing page's "From the journal" cards ---------- */

  var META_STYLE = "font-family: 'Geist Mono', monospace; font-size: 12.5px; letter-spacing: 0.06em; color: #8C816F; margin: 0";
  var TITLE_STYLE = "font-family: 'Bodoni Moda', serif; font-size: 22px; font-weight: 500; line-height: 1.2; margin: 12px 0 0";
  var EXCERPT_STYLE = 'font-size: 15.5px; line-height: 1.65; color: #5E5648; margin: 10px 0 0; text-wrap: pretty';
  var READ_STYLE = "font-family: 'Geist Mono', monospace; font-size: 12.5px; font-weight: 500; letter-spacing: 0.1em; color: var(--accent, #8E2B1F)";
  var IMAGE_STYLE = 'display: block; width: 100%; height: auto; aspect-ratio: 3 / 2; object-fit: cover';

  function card(entry, number) {
    var href = 'journal/' + entry.slug + '.html';
    var lines = ['        <article data-reveal="" style="border-top: 1px solid #DCD2C0; padding: 28px 0 32px">'];

    if (entry.image) {
      lines.push('          <a href="' + href + '" style="display: block; margin: 0 0 20px; border-radius: 10px; overflow: hidden; background: #EFE7D8" style-hover="opacity: 0.92"><img src="journal/' + entry.image + '" alt="" loading="lazy" width="600" height="400" style="' + IMAGE_STYLE + '"></a>');
    }

    lines.push(
      '          <p style="' + META_STYLE + '">' + (number ? 'No. ' + number + ' · ' : '') + humanDate(entry.date) + '</p>',
      '          <h3 style="' + TITLE_STYLE + '"><a href="' + href + '" style="color: #231A12" style-hover="color: var(--accent, #8E2B1F)">' + escapeHtml(entry.title) + '</a></h3>',
      '          <p style="' + EXCERPT_STYLE + '">' + escapeHtml(entry.excerpt) + '</p>',
      '          <p style="margin: 16px 0 0"><a href="' + href + '" style="' + READ_STYLE + '" style-hover="color: #6E1F15">READ &rarr;</a></p>',
      '        </article>'
    );
    return lines.join('\n');
  }

  function cardsBlock(entries) {
    var numbers = entryNumbers(entries);
    return [
      '      <div style="margin-top: 48px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 56px">',
    ].concat(sortEntries(entries).slice(0, HOME_CARDS).map(function (entry) {
      return card(entry, numbers[entry.slug]);
    }))
      .concat(['      </div>', '      ']).join('\n');
  }

  /* Swaps the cards between the JOURNAL:START / JOURNAL:END markers. */
  function withHomeCards(homeSource, entries) {
    var startMarker = homeSource.indexOf('<!-- JOURNAL:START');
    var endMarker = homeSource.indexOf('<!-- JOURNAL:END -->');
    if (startMarker === -1 || endMarker === -1) return null;
    var startLineEnd = homeSource.indexOf('\n', startMarker) + 1;
    return homeSource.slice(0, startLineEnd) + cardsBlock(entries) + homeSource.slice(endMarker);
  }

  /* ---------- the landing page's Stories section ----------
     The three newest stories, between the STORIES:START / STORIES:END markers.
     Every card links to the story's own page. */

  /* A story's topic is written by its writer. The usual ones keep their
     colour; any other gets one from the same palette — always the same one
     for the same word. */
  var TOPIC_COLORS = {
    'health & wellbeing': '#4E7A46', 'caregiving': '#3F6E9D', 'disability': '#B8861B',
    'palliative care': '#8E2B1F', 'other': '#8C816F',
  };
  var TOPIC_PALETTE = ['#4E7A46', '#3F6E9D', '#B8861B', '#8E2B1F', '#6B5B8E', '#2F7A74', '#A0522D'];

  function topicColor(name) {
    var key = String(name || '').toLowerCase();
    if (TOPIC_COLORS[key]) return TOPIC_COLORS[key];
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return TOPIC_PALETTE[hash % TOPIC_PALETTE.length];
  }

  /* "  palliative   care " → "Palliative care" */
  function cleanTopic(value) {
    var topic = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    return topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : '';
  }

  /* text that ends up in the landing page: no markup, and no {{ }} for its template engine */
  function pageText(value) {
    return escapeHtml(value).replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  }

  function storyTopic(story) {
    return cleanTopic(story.category) || cleanTopic((story.tags || [])[0]) || 'Other';
  }

  /* a story without a photo gets a quiet landscape in its topic's colour */
  function landscapeSvg(color) {
    return '<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="display: block; width: 100%; height: 100%">' +
      '<rect width="320" height="200" fill="#EFE7D8"/>' +
      '<circle cx="238" cy="58" r="20" fill="' + color + '" opacity=".18"/>' +
      '<path d="M0 150 L60 92 L104 128 L162 66 L222 124 L262 98 L320 140 V200 H0Z" fill="' + color + '" opacity=".22"/>' +
      '<path d="M0 172 L70 128 L128 160 L196 112 L256 152 L320 130 V200 H0Z" fill="' + color + '" opacity=".38"/>' +
      '<path d="M40 38 Q110 64 180 40" fill="none" stroke="#231A12" stroke-opacity=".18"/>' +
      '<g opacity=".55"><rect x="62" y="44" width="9" height="12" fill="#D9A62E"/><rect x="92" y="51" width="9" height="12" fill="#8E2B1F"/><rect x="122" y="52" width="9" height="12" fill="#4E7A46"/><rect x="152" y="46" width="9" height="12" fill="#3F6E9D"/></g>' +
      '</svg>';
  }

  function storyMedia(story, topic) {
    return story.image
      ? '<img src="stories/' + pageText(story.image) + '" alt="" loading="lazy">'
      : landscapeSvg(topicColor(topic));
  }

  function storyByline(story) {
    return (story.author ? pageText(story.author) + ' &middot; ' : '') + humanDate(story.date);
  }

  /* the newest story, large: its photo, its opening words as a quote */
  function featuredStory(story) {
    var topic = storyTopic(story);
    return [
      '        <a class="dh-st-card dh-st-feature" data-reveal="" href="stories/' + story.slug + '.html" style="--dot: ' + topicColor(topic) + '">',
      '          <span class="dh-st-media">' + storyMedia(story, topic) + '<span class="dh-st-badge">' + pageText(topic) + '</span></span>',
      '          <span class="dh-st-body">',
      '            <span class="dh-st-mark" aria-hidden="true">&ldquo;</span>',
      '            <p class="dh-st-quote">' + pageText(story.excerpt || story.title) + '</p>',
      '            <h3 class="dh-st-title">' + pageText(story.title) + '</h3>',
      '            <p class="dh-st-meta">' + storyByline(story) + '</p>',
      '            <p class="dh-st-read">READ STORY &rarr;</p>',
      '          </span>',
      '        </a>',
    ].join('\n');
  }

  /* the next ones, beside it */
  function storyItem(story) {
    var topic = storyTopic(story);
    return [
      '          <a class="dh-st-card dh-st-item" data-reveal="" href="stories/' + story.slug + '.html" style="--dot: ' + topicColor(topic) + '">',
      '            <span class="dh-st-thumb">' + storyMedia(story, topic) + '</span>',
      '            <span>',
      '              <span class="dh-st-topic">' + pageText(topic) + '</span>',
      '              <h3>' + pageText(story.title) + '</h3>',
      '              <p class="dh-st-excerpt">' + pageText(story.excerpt || '') + '</p>',
      '              <p class="dh-st-meta">' + storyByline(story) + '</p>',
      '            </span>',
      '          </a>',
    ].join('\n');
  }

  /* the topics in use, most stories first; "caregiving" and "Caregiving" are one */
  function topicGroups(stories) {
    var groups = {};
    (stories || []).forEach(function (s) {
      var name = storyTopic(s);
      var key = name.toLowerCase();
      (groups[key] = groups[key] || { name: name, count: 0 }).count++;
    });
    return Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  /* every topic that has a story, linking to the Stories page filtered to it */
  function storyTopics(stories) {
    var chips = topicGroups(stories).map(function (g) {
      return '<a href="stories/index.html?topic=' + encodeURIComponent(g.name) + '" style="--dot: ' + topicColor(g.name) + '">' + pageText(g.name) + ' <small>' + g.count + '</small></a>';
    });
    return '      <p class="dh-st-topics" data-reveal=""><span>Explore by topic</span>' + chips.join('') + '</p>';
  }

  /* before the first story is published */
  function storiesSoon() {
    return [
      '      <div class="dh-st-soon" data-reveal="">',
      '        <span class="dh-st-media">' + landscapeSvg('#3F6E9D') + '</span>',
      '        <div class="dh-st-body">',
      '          <p class="dh-st-topic" style="--dot: #D9A62E; margin: 0">Coming soon</p>',
      '          <h3>The first stories are on their way.</h3>',
      '          <p>Lived experiences from patients, caregivers, volunteers and families will appear here as they are shared and read by our team.</p>',
      '        </div>',
      '      </div>',
    ].join('\n');
  }

  function storiesBlock(stories) {
    var all = sortEntries(stories || []);
    var newest = all.slice(0, HOME_CARDS);
    if (!newest.length) return storiesSoon();
    var lines = ['      <div class="dh-st' + (newest.length === 1 ? ' dh-st--one' : '') + '">', featuredStory(newest[0])];
    if (newest.length > 1) {
      lines.push('        <div class="dh-st-list">');
      newest.slice(1).forEach(function (story) { lines.push(storyItem(story)); });
      lines.push('        </div>');
    }
    lines.push('      </div>', storyTopics(all));
    return lines.join('\n');
  }


  /* Swaps the cards between the STORIES:START / STORIES:END markers. */
  function withHomeStories(homeSource, stories) {
    return withMarkedBlock(homeSource, 'STORIES', storiesBlock(stories));
  }

  function mergeFeed(entries, stories) {
    var tag = function (kind) {
      return function (item) { return Object.assign({}, item, { kind: kind }); };
    };
    return sortEntries((entries || []).map(tag('journal')).concat((stories || []).map(tag('story'))));
  }

  /* the cover photo that opens an article: in the template's {{HERO}} slot,
     above the text and beside the side panel, or else at the top of the text */
  function heroHtml(entry, slotted) {
    if (!entry.image) return '';
    var attr = function (v) { return escapeHtml(v).replace(/"/g, '&quot;'); };
    var img = '<img src="' + attr(entry.image) + '" alt="' + attr(entry.imageAlt || entry.caption || '') + '">';
    if (slotted) {
      return '<figure class="post-hero">\n      ' + img +
        (entry.caption ? '\n      <figcaption>' + escapeHtml(entry.caption) + '</figcaption>' : '') + '\n    </figure>';
    }
    return '      <figure>\n        ' + img +
      (entry.caption ? '\n        <figcaption>' + escapeHtml(entry.caption) + '</figcaption>' : '') + '\n      </figure>\n\n';
  }

  /* a journal entry ends with its personal reflection; the page shows it as
     a card of its own, from the heading to the end of the text */
  function withReflection(html) {
    var match = /^[ \t]*<h2>Personal reflection<\/h2>/im.exec(html);
    if (!match) return html;
    var pad = match[0].match(/^[ \t]*/)[0];
    return html.slice(0, match.index) + pad + '<section class="post-reflect">\n' +
      html.slice(match.index).replace(/\s+$/, '') + '\n' + pad + '</section>';
  }

  /* ---------- shared stories: content/stories/<slug>.md ----------
     A story sent in from the site arrives as a pull request holding one
     Markdown file with a small header:

       ---
       title: "Finding strength in small steps"
       author: "Pema, Thimphu"
       category: "Caregiving"
       date: "2026-09-28"
       image: "images/finding-strength-in-small-steps.jpg"
       imageAlt: "Prayer flags over a bridge"
       ---
       The story, in plain paragraphs.

     Once merged, sync.mjs turns it into stories/<slug>.html and a line in
     content/stories.js. A story's category is whatever topic its writer
     typed.

     A journal entry (content/journal/<slug>.md) follows the journal template:
     date, photo, photo caption, what happened from a witness's viewpoint, and
     a personal reflection on three questions:

       ---
       title: "Meeting the palliative care team in Mongar"
       author: "Druk.help"
       date: "2026-09-28"
       image: "images/meeting-the-palliative-care-team-in-mongar.jpg"
       caption: "The district team showing us their patient register"
       ---
       What happened, as a witness saw it.

       ## Personal reflection

       **Why did we come for the meeting?** …

       **What happened?** …

       **What’s next?** … */

  /* offered as suggestions; a writer can type any topic */
  var SUGGESTED_TOPICS = ['Health & Wellbeing', 'Caregiving', 'Disability', 'Palliative Care'];
  var STORY_FIELDS = ['title', 'author', 'category', 'date', 'excerpt', 'image', 'imageAlt', 'caption'];

  var REFLECTION = [
    { key: 'why', question: 'Why did we come for the meeting?' },
    { key: 'what', question: 'What happened?' },
    { key: 'next', question: 'What’s next?' },
  ];

  function countWords(text) {
    var t = String(text || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }

  /* every word the writer wrote: the description and the three answers */
  function journalWordCount(parts) {
    return ['description'].concat(REFLECTION.map(function (r) { return r.key; }))
      .reduce(function (n, key) { return n + countWords(parts[key]); }, 0);
  }

  /* the body of a journal entry, in the order of the template; its two
     headings give the page's "In this article" list something to point to */
  var WITNESS_HEADING = 'What we saw';
  function journalBody(parts) {
    var line = function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); };
    return ['## ' + WITNESS_HEADING, String(parts.description || '').replace(/\r\n/g, '\n').trim(), '## Personal reflection']
      .concat(REFLECTION.map(function (r) { return '**' + r.question + '** ' + line(parts[r.key]); }))
      .join('\n\n');
  }

  function yamlString(value) {
    return JSON.stringify(String(value));
  }

  function storyMarkdown(story, body) {
    var head = STORY_FIELDS.filter(function (key) { return story[key]; }).map(function (key) {
      return key + ': ' + yamlString(story[key]);
    });
    return '---\n' + head.join('\n') + '\n---\n\n' + String(body).replace(/\r\n/g, '\n').trim() + '\n';
  }

  function parseStoryMarkdown(source) {
    var text = String(source).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    var match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) throw new Error('missing the --- header');
    var meta = {};
    match[1].split('\n').forEach(function (line) {
      var pair = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (!pair) return;
      var value = pair[2].trim();
      if (/^".*"$/.test(value)) {
        try { value = JSON.parse(value); } catch (e) { value = value.slice(1, -1); }
      } else if (/^'.*'$/.test(value)) {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
      meta[pair[1]] = value;
    });
    return { meta: meta, body: match[2].trim() };
  }

  /* The first paragraph, cut to a card-sized summary. */
  function excerptFrom(markdown) {
    var first = String(markdown).split(/\n\s*\n/).map(function (p) { return p.trim(); })
      .filter(function (p) { return p && !/^(#|>|-|\*|\d+[.)]|<)/.test(p); })[0] || '';
    var plain = first.replace(/[*_`[\]]/g, '').replace(/\((https?:[^)]+)\)/g, '').replace(/\s+/g, ' ');
    if (plain.length <= 180) return plain;
    return plain.slice(0, 180).replace(/\s+\S*$/, '') + '…';
  }


  /* ---------- site copy: taglines ---------- */

  var TAGLINE_P_STYLE = "font-family: 'Bodoni Moda', serif; font-style: italic; font-weight: 400; font-size: clamp(26px, 3.4vw, 42px); line-height: 1.2; color: #D9A62E; margin: 64px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 22px";
  var TAGLINE_DOT_STYLE = 'width: 8px; height: 8px; background: rgba(243, 237, 226, 0.3); transform: rotate(45deg)';

  function taglineHtml(parts) {
    var spans = (parts || []).filter(Boolean).map(function (part) {
      return '<span>' + escapeHtml(part) + '</span>';
    }).join('<span style="' + TAGLINE_DOT_STYLE + '"></span>');
    return '      <p data-reveal="" style="' + TAGLINE_P_STYLE + '">' + spans + '</p>';
  }

  function footerLineHtml(line) {
    return '      <p style="font-size: 14.5px; color: #B3A897; margin: 0">' + escapeHtml(line) + '</p>';
  }

  /* Replaces whatever sits between a pair of NAME:START / NAME:END markers,
     keeping the marker lines themselves. */
  function withMarkedBlock(source, name, block) {
    var start = source.indexOf('<!-- ' + name + ':START');
    var end = source.indexOf('<!-- ' + name + ':END -->');
    if (start === -1 || end === -1 || end < start) return null;
    var afterStartLine = source.indexOf('\n', start) + 1;
    var endLineStart = source.lastIndexOf('\n', end) + 1;
    return source.slice(0, afterStartLine) + block + '\n' + source.slice(endLineStart);
  }

  function withSiteCopy(homeSource, site) {
    var next = homeSource;
    if (site.tagline && site.tagline.length) {
      var t = withMarkedBlock(next, 'TAGLINE', taglineHtml(site.tagline));
      if (t !== null) next = t;
    }
    if (site.footerLine) {
      var f = withMarkedBlock(next, 'FOOTERLINE', footerLineHtml(site.footerLine));
      if (f !== null) next = f;
    }
    return next;
  }

  function siteFile(site) {
    return [
      "/* ==========================================================================",
      "   Druk.help — site copy you can edit without touching the page",
      "",
      "   Injected into index.html between the TAGLINE and FOOTERLINE markers by",
      "   node journal/sync.mjs, which the GitHub Action runs after every merge.",
      "   Edit them here, in a pull request.",
      "   ========================================================================== */",
      "",
      "window.DRUK_SITE = " + JSON.stringify(site, null, 2) + ";",
      "",
    ].join(String.fromCharCode(10));
  }

  function storiesFile(stories) {
    return [
      "/* ==========================================================================",
      "   Druk.help — stories",
      "",
      "   A story is a longer piece about one piece of work: what the problem was,",
      "   what was built, what happened. Unlike a journal entry it is not a dated",
      "   note — it stays useful, and it is meant to be linked to.",
      "",
      "   Drives /stories/, the story pages, the front page and sitemap.xml.",
      "   Add one from /stories/share.html (it arrives as a pull request), or",
      "   put a Markdown file in content/stories/ and run node journal/sync.mjs.",
      "   ========================================================================== */",
      "",
      "window.DRUK_STORIES = " + JSON.stringify(sortEntries(stories), null, 2) + ";",
      "",
    ].join(String.fromCharCode(10));
  }

  /* ---------- body text → article HTML ----------
     A small Markdown subset, enough for a field journal. Any line that starts
     with "<" is passed through untouched, so hand-written HTML still works. */

  /* Safe mode is for writing sent in by the public: no raw HTML, no inline
     images, and links only to http(s) or mailto. */
  function inline(text, safe) {
    var html = escapeHtml(text);
    if (safe) {
      html = html
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '$1')
        .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s"]+)\)/g, '<a href="$2" rel="nofollow noopener">$1</a>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
    }
    return html
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function renderBody(markdown, indent, options) {
    var pad = indent || '      ';
    var safe = !!(options && options.safe);
    var inlineText = function (text) { return inline(text, safe); };
    var lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var list = null;   /* 'ul' | 'ol' | null */
    var quote = [];

    function closeList() {
      if (!list) return;
      out.push(pad + '</' + list + '>');
      list = null;
    }
    function closeQuote() {
      if (!quote.length) return;
      out.push(pad + '<blockquote>');
      quote.forEach(function (q) { out.push(pad + '  <p>' + inlineText(q) + '</p>'); });
      out.push(pad + '</blockquote>');
      quote = [];
    }

    lines.forEach(function (raw) {
      var line = raw.trim();

      if (!line) { closeList(); closeQuote(); return; }

      if (line.charAt(0) === '<' && !safe) { closeList(); closeQuote(); out.push(pad + line); return; }

      if (/^---+$/.test(line)) { closeList(); closeQuote(); out.push(pad + '<hr>'); return; }

      if (/^###\s+/.test(line)) { closeList(); closeQuote(); out.push(pad + '<h3>' + inlineText(line.replace(/^###\s+/, '')) + '</h3>'); return; }
      if (/^##\s+/.test(line)) { closeList(); closeQuote(); out.push(pad + '<h2>' + inlineText(line.replace(/^##\s+/, '')) + '</h2>'); return; }
      if (/^#\s+/.test(line)) { closeList(); closeQuote(); out.push(pad + '<h2>' + inlineText(line.replace(/^#\s+/, '')) + '</h2>'); return; }

      if (/^>\s?/.test(line)) { closeList(); quote.push(line.replace(/^>\s?/, '')); return; }

      if (/^[-*]\s+/.test(line)) {
        closeQuote();
        if (list !== 'ul') { closeList(); out.push(pad + '<ul>'); list = 'ul'; }
        out.push(pad + '  <li>' + inlineText(line.replace(/^[-*]\s+/, '')) + '</li>');
        return;
      }
      if (/^\d+[.)]\s+/.test(line)) {
        closeQuote();
        if (list !== 'ol') { closeList(); out.push(pad + '<ol>'); list = 'ol'; }
        out.push(pad + '  <li>' + inlineText(line.replace(/^\d+[.)]\s+/, '')) + '</li>');
        return;
      }

      closeList(); closeQuote();
      out.push(pad + '<p>' + inlineText(line) + '</p>');
    });

    closeList(); closeQuote();
    return out.join('\n\n')
      .replace(/\n\n(\s*<\/(ul|ol|blockquote)>)/g, '\n$1')
      .replace(/(<(ul|ol)>)\n\n/g, '$1\n')
      .replace(/(<\/li>)\n\n(\s*<li>)/g, '$1\n$2')        /* keep list items together */
      .replace(/(<blockquote>)\n\n/g, '$1\n')
      .replace(/(<\/p>)\n\n(\s*<p>)(?=[\s\S]*?<\/blockquote>)/g, '$1\n$2');
  }

  /* ---------- a complete entry page ---------- */

  function entryPage(entry, bodyHtml, template) {
    var tagsHtml = (entry.tags || []).map(function (tag) {
      return '<span class="card-tag">' + escapeHtml(tag) + '</span>';
    }).join(' ');

    var slotted = String(template).indexOf('{{HERO}}') !== -1;
    var hero = heroHtml(entry, slotted);

    /* an excerpt taken from the opening paragraph would only repeat it under
       the title, so the page leaves the standfirst out */
    var letters = function (text) {
      return String(text).replace(/<[^>]*>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
    };
    var firstPara = /<p>([\s\S]*?)<\/p>/.exec(bodyHtml);
    var excerptLetters = letters(String(entry.excerpt || '').replace(/…$/, ''));
    var repeats = !!(firstPara && excerptLetters && letters(firstPara[1]).indexOf(excerptLetters) === 0);

    /* Drop the leading instructions comment first: it mentions the same tags
       we slice on below, so leaving it in would cut the page in the wrong
       place. Any template's header comment is stripped, not just the journal's. */
    var page = String(template)
      .replace(/^(<!DOCTYPE html>\s*)<!--[\s\S]*?-->\s*/i, '$1')
      .split('{{TITLE}}').join(escapeHtml(entry.title))
      .split('{{DESCRIPTION}}').join(escapeHtml(entry.excerpt))
      .split('{{SLUG}}').join(entry.slug)
      .split('{{DATE_ISO}}').join(entry.date)
      .split('{{DATE_HUMAN}}').join(humanDate(entry.date))
      .split('{{AUTHOR}}').join(escapeHtml(entry.author || 'Druk.help'))
      .split('{{TAGS_HTML}}').join(tagsHtml)
      .split('{{HERO}}').join(hero);
    if (repeats) page = page.replace(/\n[ \t]*<p class="standfirst">[^<]*<\/p>/, '');

    /* drop the template's sample article in favour of the real one, looking
       only inside <body> so nothing in the head or a comment can match; the
       sample ends at the last </div> before the END OF ENTRY comment */
    var open = '<div class="post-body">';
    var bodyStart = page.indexOf('<body');
    var a = page.indexOf(open, bodyStart === -1 ? 0 : bodyStart);
    var end = a === -1 ? -1 : page.indexOf('<!-- ===================== END OF ENTRY', a);
    var closeDiv = end === -1 ? -1 : page.lastIndexOf('</div>', end);
    if (a === -1 || closeDiv < a) throw new Error('Template body markers not found');
    var b = page.lastIndexOf('\n', closeDiv) + 1;
    return page.slice(0, a + open.length) + '\n\n' + (slotted ? '' : hero) + withReflection(bodyHtml) + '\n\n' + page.slice(b);
  }

  var api = {
    SITE_ORIGIN: SITE_ORIGIN,
    HOME_CARDS: HOME_CARDS,
    entryNumbers: entryNumbers,
    today: today,
    humanDate: humanDate,
    escapeHtml: escapeHtml,
    slugify: slugify,
    curl: curl,
    sortEntries: sortEntries,
    entriesFile: entriesFile,
    parseEntriesFile: parseEntriesFile,
    sitemapXml: sitemapXml,
    homeLastmodFrom: homeLastmodFrom,
    cardsBlock: cardsBlock,
    withHomeCards: withHomeCards,
    withHomeStories: withHomeStories,
    mergeFeed: mergeFeed,
    heroHtml: heroHtml,
    withReflection: withReflection,
    SUGGESTED_TOPICS: SUGGESTED_TOPICS,
    cleanTopic: cleanTopic,
    topicColor: topicColor,
    topicGroups: topicGroups,
    REFLECTION: REFLECTION,
    countWords: countWords,
    journalWordCount: journalWordCount,
    journalBody: journalBody,
    storyMarkdown: storyMarkdown,
    parseStoryMarkdown: parseStoryMarkdown,
    excerptFrom: excerptFrom,
    renderBody: renderBody,
    taglineHtml: taglineHtml,
    footerLineHtml: footerLineHtml,
    withMarkedBlock: withMarkedBlock,
    withSiteCopy: withSiteCopy,
    siteFile: siteFile,
    storiesFile: storiesFile,
    entryPage: entryPage,
  };

  if (typeof globalThis !== 'undefined') globalThis.DrukJournal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
