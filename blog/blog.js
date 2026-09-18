/* ==========================================================================
   Druk.help — blog runtime
   Drives three things:
     1. the reveal-on-scroll motion used across the site,
     2. the index listing (search + tag filtering) built from posts.js,
     3. the "more writing" cards and reading time on a post page.
   No build step, no dependencies. Add a post by editing posts.js.
   ========================================================================== */
(function () {
  'use strict';

  var POSTS = (window.DRUK_POSTS || []).slice().sort(function (a, b) {
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

  /* ---------- 2. index listing ---------- */

  function buildCard(post) {
    var side = el('div', { class: 'card-side' }, [
      el('span', { class: 'dh-meta', text: formatDate(post.date) })
    ]);
    if (post.author) side.appendChild(el('span', { class: 'dh-meta', text: post.author }));

    var main = el('div', {}, [el('h2', { text: post.title })]);
    if (post.excerpt) main.appendChild(el('p', { class: 'excerpt', text: post.excerpt }));
    if (post.tags && post.tags.length) {
      var tagRow = el('div', { class: 'card-tags' }, post.tags.map(function (tag) {
        return el('span', { class: 'card-tag', text: tag });
      }));
      main.appendChild(tagRow);
    }

    var children = [side, main];
    if (post.image) {
      children.push(el('img', {
        class: 'card-cover',
        src: post.image,
        alt: '',
        loading: 'lazy',
        width: '600',
        height: '400'
      }));
    }

    return el('li', {}, [
      el('a', { class: 'post-card' + (post.image ? ' has-cover' : ''), href: postUrl(post) }, children)
    ]);
  }

  function initIndex() {
    var list = document.getElementById('blog-list');
    if (!list) return;

    var search = document.getElementById('blog-search');
    var tagBar = document.getElementById('blog-tags');
    var count = document.getElementById('blog-count');
    var empty = document.getElementById('blog-empty');
    var activeTag = '';

    /* tag buttons, derived from the posts themselves */
    var allTags = [];
    POSTS.forEach(function (post) {
      (post.tags || []).forEach(function (tag) {
        if (allTags.indexOf(tag) === -1) allTags.push(tag);
      });
    });
    if (tagBar && allTags.length) {
      allTags.sort();
      [''].concat(allTags).forEach(function (tag) {
        var button = el('button', {
          type: 'button',
          class: 'blog-tag',
          'data-tag': tag,
          'aria-pressed': tag === '' ? 'true' : 'false',
          text: tag === '' ? 'All' : tag
        });
        button.addEventListener('click', function () {
          activeTag = activeTag === tag ? '' : tag;
          Array.prototype.forEach.call(tagBar.children, function (other) {
            other.setAttribute('aria-pressed', other.getAttribute('data-tag') === activeTag ? 'true' : 'false');
          });
          render();
        });
        tagBar.appendChild(button);
      });
    }

    function render() {
      var query = (search && search.value || '').trim().toLowerCase();
      var matches = POSTS.filter(function (post) {
        if (activeTag && (post.tags || []).indexOf(activeTag) === -1) return false;
        if (!query) return true;
        var haystack = [post.title, post.excerpt, post.author]
          .concat(post.tags || []).join(' ').toLowerCase();
        return haystack.indexOf(query) !== -1;
      });

      list.textContent = '';
      matches.forEach(function (post) { list.appendChild(buildCard(post)); });

      if (empty) empty.hidden = matches.length !== 0;
      if (count) {
        count.textContent = matches.length === POSTS.length
          ? POSTS.length + (POSTS.length === 1 ? ' post' : ' posts')
          : matches.length + ' of ' + POSTS.length + ' posts';
      }
    }

    if (search) search.addEventListener('input', render);
    render();
  }

  /* ---------- 3. post page extras ---------- */

  function initReadingTime() {
    var slot = document.querySelector('[data-reading-time]');
    var body = document.querySelector('.post-body');
    if (!slot || !body) return;
    var words = (body.textContent || '').trim().split(/\s+/).length;
    slot.textContent = Math.max(1, Math.round(words / 200)) + ' min read';
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
      var card = el('a', { class: 'more-card', href: postUrl(post) }, [
        el('span', { class: 'dh-meta', text: formatDate(post.date) }),
        el('h3', { text: post.title })
      ]);
      if (post.excerpt) card.appendChild(el('p', { text: post.excerpt }));
      grid.appendChild(card);
    });
  }

  /* ---------- 4. mobile menu ---------- */

  function initMobileNav() {
    var burger = document.querySelector('.dh-burger');
    var panel = document.getElementById('blog-mobile-nav');
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
      if (window.innerWidth > 900) setOpen(false);
    });

    setOpen(false);
  }

  /* ---------- boot ---------- */

  function boot() {
    initMobileNav();
    initIndex();
    initReadingTime();
    initMorePosts();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
