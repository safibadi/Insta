/**
 * Turns whatever Instagram gave the user into normalized account records.
 *
 * Everything here runs on data the user chose to open in their own browser.
 * Nothing in this file performs any network request - see the CSP in
 * index.html, which makes that a browser-enforced guarantee rather than a
 * promise.
 */

import { readMatchingEntries, ZipError } from './zip.js';

/**
 * Which export file feeds which view. Matched against the file's basename
 * (no extension, lowercased) so we find them wherever Instagram has moved the
 * folder to this month - the path has changed between
 * `connections/followers_and_following/` and `followers_and_following/`
 * across export versions, so matching on path would be fragile.
 */
const FILE_KINDS = [
  // followers_1, followers_2, ... - Instagram splits large lists across files.
  { kind: 'followers', pattern: /^followers(_\d+)?$/ },
  { kind: 'following', pattern: /^following$/ },
  { kind: 'pending', pattern: /^pending_follow_requests$/ },
  { kind: 'unfollowed', pattern: /^recently_unfollowed_(profiles|accounts)$/ },
  { kind: 'closeFriends', pattern: /^close_friends$/ },
  { kind: 'blocked', pattern: /^blocked_profiles$/ },
];

export const KIND_LABELS = {
  followers: 'Followers',
  following: 'Following',
  pending: 'Pending follow requests',
  unfollowed: 'Recently unfollowed',
  closeFriends: 'Close friends',
  blocked: 'Blocked accounts',
};

const SUPPORTED_EXTENSIONS = new Set(['json', 'html', 'htm']);

function basename(path) {
  const name = path.split('/').pop() || '';
  return name.toLowerCase();
}

function extensionOf(path) {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1);
}

function stemOf(path) {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

/** Which view a file belongs to, or null if it's one of the thousands we ignore. */
export function classifyPath(path) {
  if (!SUPPORTED_EXTENSIONS.has(extensionOf(path))) return null;
  const stem = stemOf(path);
  const match = FILE_KINDS.find((candidate) => candidate.pattern.test(stem));
  return match ? match.kind : null;
}

/** Pull a clean username out of an instagram.com profile URL. */
export function usernameFromHref(href) {
  if (typeof href !== 'string') return null;

  let url;
  try {
    // Deliberately parsed without a base URL. Supplying one would resolve any
    // arbitrary string ("not a url at all") into a valid instagram.com path,
    // turning junk into a plausible-looking username.
    url = new URL(href);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const candidate = segments[0];
  // Skip Instagram's own routes so navigation chrome in an HTML export doesn't
  // get mistaken for a person.
  const reserved = new Set([
    'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'directory',
    'about', 'developer', 'legal', 'privacy', 'terms', 'help', 'download',
  ]);
  if (reserved.has(candidate.toLowerCase())) return null;
  return candidate;
}

function makeRecord(username, href, timestamp, dateText) {
  const clean = String(username).trim().replace(/^@+/, '');
  if (!clean) return null;
  return {
    username: clean,
    key: clean.toLowerCase(),
    // Rebuilt rather than trusting the file's own href: a hand-edited export
    // must not be able to smuggle a javascript: URL into a link we render.
    href: `https://www.instagram.com/${encodeURIComponent(clean)}/`,
    originalHref: typeof href === 'string' ? href : null,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
    dateText: dateText || null,
  };
}

/**
 * Instagram wraps these lists inconsistently: followers_1.json is a bare
 * array, while following.json is an object with a `relationships_following`
 * key. Rather than hardcoding each key - which breaks whenever Meta renames
 * one - accept an array at the root, else take the first array-valued
 * property, preferring `relationships_*`.
 */
function extractArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];

  const keys = Object.keys(parsed);
  const preferred = keys.find(
    (key) => key.startsWith('relationships_') && Array.isArray(parsed[key])
  );
  if (preferred) return parsed[preferred];

  const fallback = keys.find((key) => Array.isArray(parsed[key]));
  return fallback ? parsed[fallback] : [];
}

function parseJsonText(text) {
  const parsed = JSON.parse(text);
  const items = extractArray(parsed);
  const records = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const list = Array.isArray(item.string_list_data) ? item.string_list_data : [];

    if (list.length === 0) {
      // A few record types carry the name in `title` with an empty list.
      if (typeof item.title === 'string' && item.title.trim()) {
        const record = makeRecord(item.title, null, null, null);
        if (record) records.push(record);
      }
      continue;
    }

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.value || usernameFromHref(entry.href) || item.title;
      if (!name) continue;
      // Instagram's timestamps are seconds; JS wants milliseconds.
      const timestamp = Number.isFinite(entry.timestamp) ? entry.timestamp * 1000 : null;
      const record = makeRecord(name, entry.href, timestamp, null);
      if (record) records.push(record);
    }
  }
  return records;
}

/**
 * The HTML export yields usernames just as reliably as the JSON one, so it is
 * fully supported. What it does not give us is a machine-readable timestamp -
 * only a localized string like "Mar 14, 2024 5:12 pm". We keep that string and
 * display it verbatim rather than guessing at a Date, because parsing a
 * locale-formatted date without knowing the locale silently produces wrong
 * dates, which is worse than showing none.
 */
function parseHtmlText(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const anchors = doc.querySelectorAll('a[href*="instagram.com/"]');
  const records = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') || '';
    const username = (anchor.textContent || '').trim() || usernameFromHref(href);
    if (!username) continue;
    if (!usernameFromHref(href)) continue;

    records.push(makeRecord(username, href, null, findDateNear(anchor, username)));
  }
  return records.filter(Boolean);
}

/**
 * Walk up a few ancestors looking for text alongside the link that looks like
 * a date. Meta's export markup uses generated class names that change between
 * versions, so structural selectors are not dependable - proximity plus a
 * "contains a 4-digit year" check is.
 */
function findDateNear(anchor, username) {
  let node = anchor.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const text = (node.textContent || '').replace(username, '').trim();
    if (text && /\b(19|20)\d{2}\b/.test(text)) {
      return text.replace(/\s+/g, ' ').slice(0, 60);
    }
  }
  return null;
}

function parseText(path, text) {
  const extension = extensionOf(path);
  if (extension === 'json') return { records: parseJsonText(text), format: 'json' };
  return { records: parseHtmlText(text), format: 'html' };
}

function dedupe(records) {
  const seen = new Map();
  for (const record of records) {
    const existing = seen.get(record.key);
    // Keep whichever copy carries date information.
    if (!existing || (!existing.timestamp && record.timestamp)) {
      seen.set(record.key, record);
    }
  }
  return [...seen.values()];
}

function emptyResult() {
  return {
    sets: {
      followers: [], following: [], pending: [],
      unfollowed: [], closeFriends: [], blocked: [],
    },
    formats: new Set(),
    matchedFiles: [],
    filesScanned: 0,
    warnings: [],
    errors: [],
  };
}

async function ingest(result, path, text) {
  const kind = classifyPath(path);
  if (!kind) return;

  try {
    const { records, format } = parseText(path, text);
    if (records.length === 0) {
      result.warnings.push(`No accounts found in "${basename(path)}".`);
      return;
    }
    result.sets[kind].push(...records);
    result.formats.add(format);
    result.matchedFiles.push(basename(path));
  } catch (error) {
    result.errors.push(`Could not read "${basename(path)}": ${error.message}`);
  }
}

/**
 * Main entry point. Accepts any mix of .zip, .json and .html files - a whole
 * export archive, an unzipped folder, or just the two files that matter.
 */
export async function parseUpload(files) {
  const result = emptyResult();
  const list = [...files];

  for (const file of list) {
    const path = file.webkitRelativePath || file.name;

    if (extensionOf(path) === 'zip') {
      try {
        // Only entries we recognise are decompressed; the photos and videos in
        // a full export are never touched.
        const entries = await readMatchingEntries(file, (entryPath) =>
          classifyPath(entryPath) !== null
        );
        result.filesScanned += entries.length;

        if (entries.length === 0) {
          result.warnings.push(
            `"${file.name}" opened fine, but it contains no followers or following files.`
          );
        }
        for (const entry of entries) {
          if (entry.text === null) {
            result.errors.push(`Could not unzip "${basename(entry.path)}".`);
            continue;
          }
          await ingest(result, entry.path, entry.text);
        }
      } catch (error) {
        const message =
          error instanceof ZipError
            ? error.message
            : `Could not open "${file.name}". It may be damaged or incompletely downloaded.`;
        result.errors.push(message);
      }
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.has(extensionOf(path))) continue;
    result.filesScanned += 1;

    try {
      await ingest(result, path, await file.text());
    } catch (error) {
      result.errors.push(`Could not read "${basename(path)}": ${error.message}`);
    }
  }

  for (const kind of Object.keys(result.sets)) {
    result.sets[kind] = dedupe(result.sets[kind]);
  }
  return result;
}
