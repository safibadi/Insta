import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.zip':'application/zip' };

const server = createServer(async (req, res) => {
  try {
    const path = join(ROOT, normalize(decodeURIComponent(req.url.split('?')[0])));
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { console.error('404 ->', req.url); res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => consoleErrors.push('REQ FAILED ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push('HTTP ' + r.status() + ' ' + r.url()); });

await page.goto(`http://localhost:${port}/tests/parse.test.html`);
await page.waitForFunction(() => window.__testResults !== undefined, { timeout: 30000 }).catch(() => {});

const results = await page.evaluate(() => window.__testResults);
const output = await page.evaluate(() =>
  [...document.querySelectorAll('.group, .case, pre')].map((el) => el.textContent).join('\n'));

console.log(output);
console.log('\n' + '='.repeat(60));
if (consoleErrors.length) console.log('CONSOLE ERRORS:\n' + consoleErrors.join('\n'));
console.log(results ? `passed=${results.passed} failed=${results.failed}` : 'SUITE DID NOT COMPLETE');

await browser.close();
server.close();
process.exit(results && results.failed === 0 ? 0 : 1);
