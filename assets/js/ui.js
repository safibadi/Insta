/**
 * Rendering. Two rules hold throughout this file:
 *
 * 1. Anything that came out of the user's export is written with
 *    `textContent`, never `innerHTML`. A username is attacker-influenceable
 *    text - someone can register an account called `<img onerror=...>`.
 * 2. `innerHTML` is used only for the instruction strings in steps.js, which
 *    are static content authored in this repo, never user data.
 */

import { DEVICES, DYI_URL } from './steps.js';

const HANDLED_STORAGE_KEY = 'insta-nfb:handled:v1';
const PAGE_SIZE = 60;

/* ---------------------------------------------------------------
   Saved progress. Private browsing and "block site data" settings make
   localStorage throw on access, so every use is guarded - the app has to work
   with the checklist silently degraded to session-only.
   --------------------------------------------------------------- */

export function loadHandled() {
  try {
    const raw = localStorage.getItem(HANDLED_STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function saveHandled(handled) {
  try {
    localStorage.setItem(HANDLED_STORAGE_KEY, JSON.stringify([...handled]));
  } catch {
    /* Storage unavailable; progress simply won't survive a reload. */
  }
}

export function clearHandled() {
  try {
    localStorage.removeItem(HANDLED_STORAGE_KEY);
  } catch {
    /* Nothing to clear. */
  }
}

/* ---------------------------------------------------------------
   Instructions screen
   --------------------------------------------------------------- */

function listFrom(items, startIndex) {
  const ol = document.createElement('ol');
  ol.className = 'steps';
  ol.start = startIndex;
  for (const item of items) {
    const li = document.createElement('li');
    li.innerHTML = item; // Static content from steps.js - never user data.
    ol.append(li);
  }
  return ol;
}

function groupTitle(text) {
  const heading = document.createElement('p');
  heading.className = 'steps-group__title';
  heading.textContent = text;
  return heading;
}

export function renderSteps(container, deviceKey) {
  const device = DEVICES[deviceKey] || DEVICES.desktop;
  container.replaceChildren();

  container.append(groupTitle('Request your data'));
  container.append(listFrom(device.requestSteps, 1));

  // The "tick only Followers and following" step gets pulled out of the list
  // and highlighted: picking everything produces a multi-gigabyte archive, and
  // it is far and away the most common reason this flow goes wrong.
  const chooseList = listFrom([device.chooseStep.html], device.requestSteps.length + 1);
  container.append(chooseList);

  const callout = document.createElement('div');
  callout.className = 'callout';
  const calloutTitle = document.createElement('p');
  calloutTitle.className = 'callout__title';
  calloutTitle.textContent = 'Why this step matters';
  const calloutBody = document.createElement('p');
  calloutBody.textContent = device.chooseStep.highlight;
  callout.append(calloutTitle, calloutBody);
  container.append(callout);

  container.append(listFrom(device.deliverySteps, device.requestSteps.length + 2));

  const shortcut = document.createElement('a');
  shortcut.className = 'btn btn--ghost link-btn';
  shortcut.href = DYI_URL;
  shortcut.target = '_blank';
  shortcut.rel = 'noopener noreferrer';
  shortcut.textContent = 'Open Instagram’s download page ↗';
  container.append(shortcut);

  const shortcutNote = document.createElement('p');
  shortcutNote.className = 'muted';
  shortcutNote.style.fontSize = '.85rem';
  shortcutNote.textContent =
    'That link jumps straight to the download screen. If it asks you to sign in ' +
    'or opens the app somewhere else, use the steps above instead.';
  container.append(shortcutNote);

  container.append(groupTitle('Then bring it here'));
  container.append(listFrom(device.retrieveSteps, 1));
}

/* ---------------------------------------------------------------
   Results
   --------------------------------------------------------------- */

/**
 * One summary tile. Every tile is a button that switches the list below to the
 * matching view - the numbers are the most obvious thing on the screen, so
 * they are what people tap first.
 *
 * The info button is a sibling rather than a child: a button inside a button
 * is invalid, and nesting it would make the whole tile un-tappable in some
 * screen readers.
 */
function statTile(spec) {
  const slot = document.createElement('div');
  slot.className = spec.isHeadline ? 'stat-slot stat-slot--headline' : 'stat-slot';

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = spec.isHeadline ? 'stat stat--headline' : 'stat';
  tile.dataset.tabId = spec.tabId;
  tile.setAttribute('aria-pressed', String(spec.tabId === spec.activeTab));

  const valueEl = document.createElement('div');
  valueEl.className = 'stat__value';
  valueEl.textContent = spec.value.toLocaleString();

  const labelEl = document.createElement('div');
  labelEl.className = 'stat__label';
  labelEl.textContent = spec.label;

  tile.append(valueEl, labelEl);

  if (spec.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'stat__note';
    noteEl.textContent = spec.note;
    tile.append(noteEl);
  }

  tile.addEventListener('click', () => spec.onSelect(spec.tabId));
  slot.append(tile);

  if (spec.onInfo) {
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'stat__info';
    info.dataset.info = spec.tabId;
    // The glyph is wrapped so it can sit above the circle the stylesheet
    // draws behind it.
    const glyph = document.createElement('span');
    glyph.textContent = 'i';
    glyph.setAttribute('aria-hidden', 'true');
    info.append(glyph);
    info.setAttribute('aria-label', spec.infoLabel);
    info.addEventListener('click', spec.onInfo);
    slot.append(info);
  }

  return slot;
}

/**
 * `view` carries what the tiles cannot derive themselves: which view is
 * showing, what to do when one is tapped, and the corrected following count
 * once the user has told us what their profile says.
 */
export function renderSummary(container, results, view) {
  const { activeTab, onSelect, onInfo } = view;
  const common = { activeTab, onSelect };

  container.replaceChildren(
    statTile({
      ...common, value: results.notFollowingBack.length,
      label: "Don't follow you back", tabId: 'notFollowingBack', isHeadline: true,
    }),
    statTile({ ...common, value: results.totals.followers, label: 'Followers', tabId: 'followers' }),
    statTile({
      ...common,
      value: view.followingShown ?? results.totals.following,
      label: 'Following',
      tabId: 'following',
      note: view.followingNote,
      onInfo,
      infoLabel: 'Why is this number different from your profile?',
    }),
    statTile({ ...common, value: results.fans.length, label: 'Fans', tabId: 'fans' }),
    statTile({ ...common, value: results.mutuals.length, label: 'Mutuals', tabId: 'mutuals' })
  );
}

export function renderTabs(container, tabs, activeId, onSelect) {
  container.replaceChildren();

  for (const tab of tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    // aria-pressed rather than role="tab": all these buttons drive one shared
    // list, which is a toggle group, not a tab set.
    button.setAttribute('aria-pressed', String(tab.id === activeId));
    button.dataset.tabId = tab.id;

    const label = document.createElement('span');
    label.textContent = tab.label;

    const count = document.createElement('span');
    count.className = 'tab__count';
    count.textContent = tab.records.length.toLocaleString();

    button.append(label, count);
    button.addEventListener('click', () => onSelect(tab.id));
    container.append(button);
  }
}

/** Deterministic colour per username, so the same account always looks the same. */
function avatarHue(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * Initials from a username. Splits on the separators Instagram handles
 * allow, so `jane.doe_23` reads as "JD" rather than "JA".
 */
function initialsFor(username) {
  const parts = username.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length === 0) return username.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const relativeTime =
  typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null;

/**
 * "Followed 2 years ago" beats "Followed Nov 18, 2023" here: the question
 * being answered is how long someone has been ignoring you, and it fits on one
 * line on a narrow phone. The exact date stays available as a tooltip.
 */
function relativeLabel(timestamp) {
  if (!relativeTime) return null;
  const days = Math.round((timestamp - Date.now()) / 86400000);

  if (Math.abs(days) < 31) return relativeTime.format(days, 'day');
  const months = Math.round(days / 30.44);
  if (Math.abs(months) < 12) return relativeTime.format(months, 'month');
  return relativeTime.format(Math.round(days / 365.25), 'year');
}

function exactDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatWhen(record) {
  if (record.timestamp) {
    // Just "3 years ago", not "Followed 3 years ago": on a 320px phone the
    // prefix is what pushes the line into an ellipsis, and the surrounding
    // list already establishes what the date refers to. The full sentence
    // stays in the tooltip and the accessible label.
    const relative = relativeLabel(record.timestamp);
    return {
      text: relative || exactDate(record.timestamp),
      title: `Followed on ${exactDate(record.timestamp)}`,
    };
  }
  // The HTML export carries only a localized string; show it as-is rather than
  // parsing it into a Date we cannot verify.
  if (record.dateText) return { text: record.dateText, title: record.dateText };
  return { text: '', title: '' };
}

function accountRow(record, isHandled, onToggle) {
  const item = document.createElement('li');
  item.className = isHandled ? 'account is-handled' : 'account';

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  const hue = avatarHue(record.key);
  avatar.style.background = `hsl(${hue} 55% 42%)`;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initialsFor(record.username);

  const body = document.createElement('span');
  body.className = 'account__body';

  const name = document.createElement('span');
  name.className = 'account__name';
  name.textContent = `@${record.username}`; // textContent: never trust this string.

  const when = formatWhen(record);
  const meta = document.createElement('span');
  meta.className = 'account__meta';

  // The request/blocked/favourite files carry a display name that the
  // followers and following files never do. Show it when we have it.
  const metaParts = [record.displayName, when.text].filter(Boolean);
  meta.textContent = metaParts.join(' · ');

  const fullMeta = [record.displayName, when.title].filter(Boolean).join(' · ');
  if (fullMeta) {
    meta.title = fullMeta;
    meta.setAttribute('aria-label', fullMeta);
  }

  body.append(name, meta);

  const checkWrap = document.createElement('label');
  checkWrap.className = 'account__check';
  checkWrap.title = 'Mark as handled';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isHandled;
  checkbox.setAttribute('aria-label', `Mark @${record.username} as handled`);
  checkbox.addEventListener('change', () => {
    item.classList.toggle('is-handled', checkbox.checked);
    onToggle(record.key, checkbox.checked);
  });
  checkWrap.append(checkbox);

  /**
   * Opening a profile is how you deal with someone, so it ticks the box for
   * you - working through 94 accounts is otherwise two taps each, and the one
   * people forget is the second. Ticking is never undone here, so a row you
   * deliberately unticked stays unticked when you visit it again.
   */
  function markHandled() {
    if (checkbox.checked) return;
    checkbox.checked = true;
    item.classList.add('is-handled');
    onToggle(record.key, true);
  }

  // Two ways to the same profile: the whole avatar-and-name block, which is
  // what people instinctively tap, and the explicit Open button.
  function profileLink(className) {
    const link = document.createElement('a');
    link.className = className;
    link.href = record.href; // Rebuilt in parse.js from the username alone.
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', markHandled);
    // A middle-click opens the profile too, and never fires a click event.
    link.addEventListener('auxclick', markHandled);
    return link;
  }

  // Deliberately unlabelled: an aria-label here would replace the name and the
  // follow date with one canned sentence, and the date is worth hearing. The
  // Open button next to it says what these links do.
  const identity = profileLink('account__link');
  identity.append(avatar, body);

  const visit = profileLink('account__visit');
  visit.textContent = 'Open';
  visit.setAttribute('aria-label', `Open @${record.username} on Instagram`);

  item.append(identity, visit, checkWrap);
  return item;
}

/**
 * Incremental list renderer. A following list can run to thousands of rows;
 * building them all at once locks up a phone for seconds. This appends a page
 * at a time and exposes `loadMore` for an IntersectionObserver to drive.
 */
export function createListRenderer(container, handled, onToggle) {
  let records = [];
  let rendered = 0;

  function appendPage() {
    const slice = records.slice(rendered, rendered + PAGE_SIZE);
    if (slice.length === 0) return false;

    const fragment = document.createDocumentFragment();
    for (const record of slice) {
      fragment.append(accountRow(record, handled.has(record.key), onToggle));
    }
    container.append(fragment);
    rendered += slice.length;
    return rendered < records.length;
  }

  return {
    setRecords(next, emptyMessage) {
      records = next;
      rendered = 0;
      container.replaceChildren();

      if (records.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = emptyMessage;
        container.append(empty);
        return;
      }
      appendPage();
    },
    loadMore: appendPage,
    hasMore: () => rendered < records.length,
  };
}

export function renderNotices(container, notices) {
  container.replaceChildren();
  for (const notice of notices) {
    const box = document.createElement('div');
    box.className = notice.type === 'error' ? 'notice notice--error' : 'notice';
    box.textContent = notice.text;
    container.append(box);
  }
}

export function setStatus(container, text, kind) {
  container.className = kind ? `status status--${kind}` : 'status';
  container.textContent = text;
}
