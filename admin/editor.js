/* ==========================================================================
   Druk.help dashboard — the visual editor's two halves

   Markdown → editor HTML uses the site's own renderer in safe mode
   (journal/sync-core.js), so what the editor shows is what the site renders,
   and nothing from the text can run as HTML.

   Editor HTML → Markdown is written here. It understands only what the
   toolbar can make (headings, paragraphs, bold, italic, lists, quotes, links)
   and reads everything else as plain text, so pasted or odd markup can never
   reach the saved file.
   ========================================================================== */

(function () {
  'use strict';

  var core = window.DrukJournal;

  function mdToHtml(markdown) {
    return core.renderBody(markdown, '', { safe: true });
  }

  /* parse HTML into a detached container, dropping the indentation between blocks */
  function parse(html) {
    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    var root = doc.body;
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3 && !/\S/.test(child.nodeValue) && /^(BODY|UL|OL|BLOCKQUOTE)$/.test(node.nodeName)) {
          node.removeChild(child);
        } else if (child.nodeType === 1) clean(child);
      });
    })(root);
    return root;
  }

  /* only web and email links survive */
  function safeHref(href) {
    var h = String(href || '').trim();
    return /^(https?:\/\/|mailto:)[^\s"<>()]+$/i.test(h) ? h : '';
  }

  function inline(node, ctx) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) {
        out += child.nodeValue.replace(/[ \t\r]+/g, ' ').replace(/\n+/g, ' ');
        return;
      }
      if (child.nodeType !== 1) return;
      var tag = child.nodeName;
      if (tag === 'BR') { out += ctx && ctx.flat ? ' ' : '\n'; return; }
      if (/^(SCRIPT|STYLE|IMG|IFRAME|OBJECT|EMBED|SVG|TEMPLATE)$/.test(tag)) return;
      var inner = inline(child, ctx);
      if (/^(STRONG|B)$/.test(tag)) out += wrap(inner, '**');
      else if (/^(EM|I)$/.test(tag)) out += wrap(inner, '*');
      else if (tag === 'CODE') out += inner.trim() ? '`' + inner.replace(/`/g, '') + '`' : '';
      else if (tag === 'A') {
        var href = safeHref(child.getAttribute('href'));
        out += href && inner.trim() ? '[' + inner.replace(/[\[\]]/g, '') + '](' + href + ')' : inner;
      } else if (/^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/.test(tag)) out += '\n' + inner + '\n';   /* stray block inside a block */
      else out += inner;
    });
    return out;
  }

  /* **bold** must hug its words: move spaces outside the marks */
  function wrap(text, mark) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m[2] || /^\*+$/.test(m[2])) return text;
    return m[1] + mark + m[2] + mark + m[3];
  }

  /* a line that would be read as a heading, list, quote or rule gets an invisible
     mark in front so it stays the plain sentence the editor typed */
  function guard(line) {
    return /^(#|>|[-*+]\s|\d+[.)]\s|---)/.test(line) ? '​' + line : line;
  }

  function lines(text) {
    return String(text).split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean).map(function (l) { return l.replace(/\*\*\*\*/g, ''); });
  }

  function blocks(parent, out) {
    Array.prototype.forEach.call(parent.childNodes, function (node) {
      if (node.nodeType === 3) {
        lines(node.nodeValue).forEach(function (l) { out.push(guard(l)); });
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.nodeName;
      if (/^(SCRIPT|STYLE|IMG|IFRAME|OBJECT|EMBED|SVG|TEMPLATE)$/.test(tag)) return;
      if (/^H[12]$/.test(tag)) { var a = lines(inline(node, { flat: true })).join(' '); if (a) out.push('## ' + a.replace(/\*\*/g, '')); return; }
      if (/^H[3-6]$/.test(tag)) { var b = lines(inline(node, { flat: true })).join(' '); if (b) out.push('### ' + b.replace(/\*\*/g, '')); return; }
      if (tag === 'HR') { out.push('---'); return; }
      if (tag === 'UL' || tag === 'OL') {
        var items = [];
        var n = 0;
        Array.prototype.forEach.call(node.children, function (li) {
          var text = lines(inline(li, { flat: true })).join(' ');
          if (text) items.push(tag === 'UL' ? '- ' + text : (++n) + '. ' + text);
        });
        if (items.length) out.push(items.join('\n'));
        return;
      }
      if (tag === 'BLOCKQUOTE') {
        var quote = [];
        var inner = [];
        blocks(node, inner);
        inner.forEach(function (q) { q.split('\n').forEach(function (l) { quote.push('> ' + l.replace(/^(##?#?\s|>\s|-\s)/, '')); }); });
        if (quote.length) out.push(quote.join('\n'));
        return;
      }
      if (/^(DIV|SECTION|ARTICLE|MAIN|P|FIGURE)$/.test(tag)) {
        var hasBlock = Array.prototype.some.call(node.children, function (c) { return /^(P|DIV|UL|OL|H[1-6]|BLOCKQUOTE|HR)$/.test(c.nodeName); });
        if (hasBlock) { blocks(node, out); return; }
        lines(inline(node)).forEach(function (l) { out.push(guard(l)); });
        return;
      }
      /* inline element sitting loose in the editor */
      lines(inline({ childNodes: [node] })).forEach(function (l) { out.push(guard(l)); });
    });
    return out;
  }

  function htmlToMd(root) {
    return blocks(root, []).join('\n\n').trim();
  }

  /* does this Markdown survive the editor? Same rendered page before and after. */
  function survives(markdown) {
    var back = htmlToMd(parse(mdToHtml(markdown)));
    var same = function (md) { return core.renderBody(md, '', { safe: true }).replace(/\s+/g, ' '); };
    return same(back) === same(markdown);
  }

  window.DrukEditor = { mdToHtml: mdToHtml, htmlToMd: htmlToMd, parse: parse, safeHref: safeHref, survives: survives };
})();
