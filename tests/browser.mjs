/**
 * Locates Playwright and Chromium in a way that works both in CI and in a
 * local sandbox where Playwright is installed globally.
 *
 * CI does `npm install --no-save playwright`, so the bare specifier resolves
 * from ./node_modules and Chromium sits in Playwright's own cache. A machine
 * with a global install has neither, so we fall back to well-known paths.
 */
import { existsSync } from 'node:fs';

const GLOBAL_PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.mjs';

const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
];

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    if (existsSync(GLOBAL_PLAYWRIGHT)) return import(GLOBAL_PLAYWRIGHT);
    throw new Error(
      'Playwright not found. Run: npm install --no-save playwright && npx playwright install chromium'
    );
  }
}

/**
 * Only pin an executable path when we can see one. Left undefined, Playwright
 * resolves the browser it installed itself, which is what CI wants.
 */
export function chromiumLaunchOptions() {
  const found = CHROMIUM_CANDIDATES.find((path) => existsSync(path));
  return found ? { executablePath: found } : {};
}
