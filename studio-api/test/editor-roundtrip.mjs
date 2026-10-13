/* Opens every real content file's text in the editor's two converters, in a real
   browser (headless Edge/Chrome), and checks the page it renders is unchanged.
   Skips quietly when no browser is installed. */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import '../../journal/sync-core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = globalThis.DrukJournal;
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = browsers.find(existsSync);
if (!browser) { console.log('no browser found — skipped'); process.exit(0); }

const cases = [];
for (const dir of ['content/journal', 'content/stories']) {
  for (const f of readdirSync(join(root, dir))) {
    if (!f.endsWith('.md') || /readme/i.test(f)) continue;
    cases.push({ name: dir + '/' + f, md: core.parseStoryMarkdown(readFileSync(join(root, dir, f), 'utf8')).body });
  }
}
/* things editors will type */
cases.push(
  { name: 'bold/italic/link', md: 'Some **bold** and *italic* and [a link](https://example.org/x) here.\n\n- one\n- two\n\n1. first\n2. second\n\n> A quote\n\n## Heading\n\n### Smaller' },
  { name: 'text that looks like markup', md: '\u200b- not a list\n\n\u200b# not a heading' },
  { name: 'raw html is text', md: '<script>alert(1)</script> and <b>x</b>' },
);

const page = `<!doctype html><meta charset=utf-8><body><pre id=out></pre>
<script src="${pathToFileURL(join(root, 'journal/sync-core.js'))}"></script>
<script src="${pathToFileURL(join(root, 'admin/editor.js'))}"></script>
<script>
var cases = ${JSON.stringify(cases).split(String.fromCharCode(60)).join(String.fromCharCode(92) + "u003c")};
var out = [];
cases.forEach(function (c) {
  var ok = false, detail = '';
  try {
    ok = DrukEditor.survives(c.md);
    if (!ok) detail = JSON.stringify(DrukEditor.htmlToMd(DrukEditor.parse(DrukEditor.mdToHtml(c.md)))).slice(0, 300);
  } catch (e) { detail = String(e); }
  out.push((ok ? 'PASS ' : 'FAIL ') + c.name + (ok ? '' : ' ' + detail));
});
/* an editor that has been tampered with can't add scripts or odd links */
var evil = DrukEditor.htmlToMd(DrukEditor.parse('<p onclick="x()">hi <a href="javascript:alert(1)">link</a> <img src=x onerror=alert(1)><script>alert(1)<\\/script></p>'));
out.push((evil === 'hi link' ? 'PASS ' : 'FAIL ') + 'unsafe markup dropped: ' + JSON.stringify(evil));
out.forEach(function (l) { console.log('RESULT:' + l); });
</script>`;
const dir = mkdtempSync(join(tmpdir(), 'druk-editor-'));
const file = join(dir, 'roundtrip.html');
writeFileSync(file, page);
const log = join(dir, 'browser.log');
/* Edge reports the page's console through its log file */
spawnSync(browser, ['--headless', '--disable-gpu', '--allow-file-access-from-files', '--user-data-dir=' + join(dir, 'profile'), '--enable-logging', '--v=0', '--log-file=' + log, '--virtual-time-budget=5000', pathToFileURL(file).href], { timeout: 60000 });

/* the browser outlives the process we started, so wait for its last line */
const deadline = Date.now() + 40000;
let found = [];
while (Date.now() < deadline) {
  found = [];
  if (existsSync(log)) {
    for (const line of readFileSync(log, 'utf8').split('\n')) {
      const m = /INFO:CONSOLE:\d+\] "RESULT:(.*)", source:/.exec(line);
      if (m) found.push(m[1]);
    }
  }
  if (found.some((l) => l.includes('unsafe markup dropped'))) break;
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']);
}
if (!found.length) { console.error('the browser produced no result'); process.exit(1); }
console.log(found.join('\n'));
process.exit(found.some((l) => l.startsWith('FAIL')) ? 1 : 0);
