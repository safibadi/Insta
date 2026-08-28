/**
 * Application wiring: routing, file intake, and event handling.
 *
 * The whole app is four screens driven by the URL hash, so the phone back
 * button walks back through the wizard instead of leaving the site.
 */

import { parseUpload } from './parse.js';
import { analyze, sortRecords, filterRecords, toCsv } from './analyze.js';
import { detectDevice, supportsFolderUpload } from './steps.js';
import {
  renderSteps, renderSummary, renderTabs, renderNotices, setStatus,
  createListRenderer, loadHandled, saveHandled, clearHandled,
} from './ui.js';

const SCREENS = ['home', 'how', 'upload', 'results'];

const dom = {
  screens: new Map(
    [...document.querySelectorAll('[data-screen]')].map((el) => [el.dataset.screen, el])
  ),
  stepsContent: document.getElementById('steps-content'),
  deviceButtons: [...document.querySelectorAll('[data-device]')],
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  folderInput: document.getElementById('folder-input'),
  pickFile: document.getElementById('pick-file'),
  pickFolder: document.getElementById('pick-folder'),
  uploadStatus: document.getElementById('upload-status'),
  notices: document.getElementById('notices'),
  summary: document.getElementById('summary'),
  countNote: document.getElementById('count-note'),
  tabs: document.getElementById('tabs'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  accounts: document.getElementById('accounts'),
  listMeta: document.getElementById('list-meta'),
  sentinel: document.getElementById('sentinel'),
  copyButton: document.getElementById('copy-usernames'),
  csvButton: document.getElementById('download-csv'),
  clearButton: document.getElementById('clear-data'),
  startOver: document.getElementById('start-over'),
  countDialog: document.getElementById('count-dialog'),
  countPanels: [...document.querySelectorAll('#count-dialog [data-panel]')],
  countQuestion: document.getElementById('count-question'),
  countInput: document.getElementById('count-input'),
  countError: document.getElementById('count-error'),
  countResult: document.getElementById('count-result'),
  countDiffers: document.getElementById('count-differs'),
  countMatches: document.getElementById('count-matches'),
  countSave: document.getElementById('count-save'),
  countBack: document.getElementById('count-back'),
  countClose: document.getElementById('count-close'),
  countShowList: document.getElementById('count-show-list'),
  countRedo: document.getElementById('count-redo'),
};

const state = {
  results: null,
  tabs: [],
  activeTab: 'notFollowingBack',
  handled: loadHandled(),
  listRenderer: null,
  // What the user's profile says their following count is, once they have
  // told us. Null until then, and never persisted - the results themselves
  // don't survive a reload either.
  profileFollowing: null,
};

/* ---------------------------------------------------------------
   Routing
   --------------------------------------------------------------- */

function currentScreen() {
  const hash = location.hash.replace(/^#\/?/, '');
  return SCREENS.includes(hash) ? hash : 'home';
}

function showScreen(name, { moveFocus = true } = {}) {
  // Results are meaningless without a parsed file - most likely someone
  // reloaded the page, which drops the data since we never persist it.
  const target = name === 'results' && !state.results ? 'upload' : name;

  for (const [key, element] of dom.screens) {
    element.hidden = key !== target;
  }
  window.scrollTo(0, 0);

  // Move focus to the new screen's heading so screen readers announce the
  // change instead of leaving focus on a button that just disappeared.
  // Skipped on first paint, where nothing has changed yet.
  if (!moveFocus) return;
  const focusTarget = dom.screens.get(target)?.querySelector('h1, h2');
  if (focusTarget) {
    focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus({ preventScroll: true });
  }
}

function navigate(name) {
  if (currentScreen() === name) {
    showScreen(name);
    return;
  }
  location.hash = `#/${name}`;
}

window.addEventListener('hashchange', () => showScreen(currentScreen()));

for (const button of document.querySelectorAll('[data-go]')) {
  button.addEventListener('click', () => navigate(button.dataset.go));
}

/* ---------------------------------------------------------------
   Instructions screen
   --------------------------------------------------------------- */

function selectDevice(deviceKey) {
  for (const button of dom.deviceButtons) {
    button.setAttribute('aria-selected', String(button.dataset.device === deviceKey));
  }
  renderSteps(dom.stepsContent, deviceKey);
}

for (const button of dom.deviceButtons) {
  button.addEventListener('click', () => selectDevice(button.dataset.device));
}

/* ---------------------------------------------------------------
   File intake
   --------------------------------------------------------------- */

dom.pickFile.addEventListener('click', () => dom.fileInput.click());
dom.fileInput.addEventListener('change', () => {
  const files = [...dom.fileInput.files];
  // Cleared so that picking the same file again still fires a change event;
  // otherwise a retry after an error looks like the app has frozen.
  dom.fileInput.value = '';
  handleFiles(files);
});

// Folder upload is offered only on a computer: iOS Safari has no folder
// picker at all, and on a phone the ZIP straight from Downloads is the path
// people actually take. Feature detection alone can't distinguish a real
// iPhone from a desktop browser emulating one, so the device check matters.
if (supportsFolderUpload() && detectDevice() === 'desktop') {
  dom.pickFolder.hidden = false;
  dom.pickFolder.addEventListener('click', () => dom.folderInput.click());
  dom.folderInput.addEventListener('change', () => {
    const files = [...dom.folderInput.files];
    dom.folderInput.value = '';
    handleFiles(files);
  });
}

for (const eventName of ['dragenter', 'dragover']) {
  dom.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropzone.classList.add('is-dragover');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dom.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove('is-dragover');
  });
}
dom.dropzone.addEventListener('drop', (event) => {
  const files = event.dataTransfer?.files;
  if (files?.length) handleFiles(files);
});

function describeParse(parsed) {
  const notices = [];

  if (parsed.formats.has('html') && !parsed.formats.has('json')) {
    notices.push({
      type: 'info',
      text:
        'You uploaded the HTML export. Every count and list here is exact — ' +
        'the only difference is that HTML has no precise follow dates, so ' +
        'sorting by date is unavailable. Choose JSON next time for those.',
    });
  }
  for (const warning of parsed.warnings) notices.push({ type: 'info', text: warning });
  for (const error of parsed.errors) notices.push({ type: 'error', text: error });
  return notices;
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;

  setStatus(dom.uploadStatus, 'Reading your file…', 'busy');

  let parsed;
  try {
    parsed = await parseUpload(files);
  } catch (error) {
    setStatus(
      dom.uploadStatus,
      `Something went wrong reading that file: ${error.message}`,
      'error'
    );
    return;
  }

  const { followers, following } = parsed.sets;

  if (followers.length === 0 && following.length === 0) {
    const detail = parsed.errors.length ? ` (${parsed.errors[0]})` : '';
    setStatus(
      dom.uploadStatus,
      `We couldn't find your followers or following list in that file${detail}. ` +
        'Look for followers_1.json and following.json — upload the whole ZIP, ' +
        'or unzip it and pick those two files. If you exported as HTML and it ' +
        'still fails, request the export again choosing JSON.',
      'error'
    );
    return;
  }

  // One list missing still yields a usable answer for the other views, so
  // report it and carry on rather than refusing the whole import.
  const notices = describeParse(parsed);
  if (followers.length === 0) {
    notices.unshift({
      type: 'error',
      text: 'No followers file found, so "doesn\'t follow you back" can\'t be calculated. ' +
        'Make sure followers_1.json is included.',
    });
  }
  if (following.length === 0) {
    notices.unshift({
      type: 'error',
      text: 'No following file found, so "doesn\'t follow you back" can\'t be calculated. ' +
        'Make sure following.json is included.',
    });
  }

  setStatus(dom.uploadStatus, '', null);
  showResults(analyze(parsed.sets), notices, parsed.formats.has('json'));
}

/* ---------------------------------------------------------------
   Results screen
   --------------------------------------------------------------- */

/**
 * The following count.
 *
 * Instagram's export lists more accounts than the profile counter shows,
 * because deleted and deactivated accounts stay in the file after they stop
 * being counted. Confirmed by opening one from a real export's results: the
 * profile returns Instagram's "page isn't available".
 *
 * The explanation used to sit under the stats as a paragraph. It now lives
 * behind the "i" on the Following tile, and asks for the number on the user's
 * profile - the difference is exactly how many dead accounts the export is
 * still listing, which turns a caveat into an answer.
 */

/** How many accounts the export lists that Instagram no longer counts. */
function ghostCount() {
  if (state.profileFollowing === null || !state.results) return 0;
  return Math.max(0, state.results.totals.following - state.profileFollowing);
}

function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

/**
 * The one line left on the results screen, and only once there is something
 * specific to say. Empty otherwise - `.count-note:empty` hides it.
 */
function renderCountNote() {
  const ghosts = ghostCount();
  if (ghosts === 0) {
    dom.countNote.textContent = '';
    return;
  }
  dom.countNote.textContent =
    `${ghosts.toLocaleString()} of the ${state.results.totals.following.toLocaleString()} ` +
    `accounts in your export ${plural(ghosts, 'is', 'are')} deleted or deactivated — ` +
    `${plural(ghosts, 'it sits', 'they sit')} in “Doesn't follow back” below.`;
}

function showCountPanel(name) {
  for (const panel of dom.countPanels) panel.hidden = panel.dataset.panel !== name;
}

function openCountDialog() {
  // The dialog opens on the question, not on a restatement of the counts: the
  // tiles behind it are already showing them.
  const { following } = state.results.totals;
  dom.countQuestion.textContent =
    `Is the following count on your profile different from ${following.toLocaleString()}?`;

  dom.countInput.value = state.profileFollowing === null ? '' : String(state.profileFollowing);
  dom.countError.textContent = '';
  showCountPanel('intro');
  dom.countDialog.showModal();
}

/** Result panel, with the "Show that list" button only when there is a list to show. */
function showCountResult(text, offerList) {
  dom.countResult.textContent = text;
  dom.countShowList.hidden = !offerList;
  showCountPanel('result');
}

function applyProfileCount(value) {
  state.profileFollowing = value;
  renderCountNote();
  renderSummary(dom.summary, state.results, summaryView());
}

function saveProfileCount() {
  const exported = state.results.totals.following;
  const raw = dom.countInput.value.trim();
  const value = Number(raw);

  if (!raw || !Number.isInteger(value) || value < 0) {
    dom.countError.textContent = 'Enter the whole number your profile shows, like 518.';
    dom.countInput.focus();
    return;
  }

  if (value > exported) {
    // Not an error on the user's part: an export is a snapshot, so anyone
    // followed after it was requested is genuinely missing from the file.
    // There is nothing to correct, so the tile goes back to the export figure.
    applyProfileCount(null);
    showCountResult(
      `Your profile shows ${value.toLocaleString()}, which is more than the ` +
        `${exported.toLocaleString()} in your export. An export is a snapshot of the ` +
        'day you asked for it, so accounts you have followed since then are not in ' +
        'the file. Request a fresh export to see them.',
      false
    );
    return;
  }

  applyProfileCount(value);
  const ghosts = ghostCount();

  if (ghosts === 0) {
    showCountResult(
      'Your profile and your export agree, so nothing in your list has been ' +
        'deleted or deactivated. Every account under “Doesn\'t follow back” is a ' +
        'live account that simply does not follow you.',
      false
    );
    return;
  }

  showCountResult(
    `${ghosts.toLocaleString()} ${plural(ghosts, 'profile is', 'profiles are')} deleted or ` +
      `deactivated. Your export still lists ${plural(ghosts, 'it', 'them')}; Instagram ` +
      `stopped counting ${plural(ghosts, 'it', 'them')}, which is why your profile says ` +
      `${state.profileFollowing.toLocaleString()}. ` +
      `${plural(ghosts, 'It is', 'They are')} in your “Doesn't follow back” list — ` +
      `${plural(ghosts, 'a dead account', 'dead accounts')} can't follow you back — and ` +
      `opening ${plural(ghosts, 'it', 'one')} shows “Sorry, this page isn't available”. ` +
      'We cannot tell which rows they are, only how many.',
    true
  );
}

dom.countDiffers.addEventListener('click', () => {
  dom.countError.textContent = '';
  showCountPanel('ask');
  dom.countInput.focus();
});

dom.countMatches.addEventListener('click', () => {
  applyProfileCount(state.results.totals.following);
  showCountResult(
    'Nothing to correct, then. Every account under “Doesn\'t follow back” is a ' +
      'live account that simply does not follow you.',
    false
  );
});

dom.countSave.addEventListener('click', saveProfileCount);
dom.countInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveProfileCount();
  }
});

dom.countBack.addEventListener('click', () => showCountPanel('intro'));
dom.countRedo.addEventListener('click', () => {
  dom.countError.textContent = '';
  showCountPanel('ask');
  dom.countInput.focus();
});
dom.countClose.addEventListener('click', () => dom.countDialog.close());
dom.countShowList.addEventListener('click', () => {
  dom.countDialog.close();
  selectTab('notFollowingBack');
});

function buildTabs(results) {
  const candidates = [
    { id: 'notFollowingBack', label: "Doesn't follow back", records: results.notFollowingBack },
    { id: 'followers', label: 'Followers', records: results.followers },
    { id: 'following', label: 'Following', records: results.following },
    { id: 'fans', label: 'Fans', records: results.fans },
    { id: 'mutuals', label: 'Mutuals', records: results.mutuals },
    { id: 'pending', label: 'Requests sent', records: results.pending },
    { id: 'receivedRequests', label: 'Requests received', records: results.receivedRequests },
    { id: 'unfollowed', label: 'Recently unfollowed', records: results.unfollowed },
    { id: 'favorited', label: 'Favourites', records: results.favorited },
    { id: 'recentRequests', label: 'Recently requested', records: results.recentRequests },
    { id: 'blocked', label: 'Blocked', records: results.blocked },
    { id: 'removedSuggestions', label: 'Removed suggestions', records: results.removedSuggestions },
  ];
  // The first five always show, even at zero: they are the five tiles at the
  // top of the screen, and every one of those is tappable, so each needs a
  // view to land on. The optional ones only appear if that file was present.
  return candidates.filter((tab, index) => index < 5 || tab.records.length > 0);
}

const EMPTY_MESSAGES = {
  notFollowingBack: 'Everyone you follow follows you back. Nice.',
  followers: 'No followers found in your export.',
  following: 'No accounts found in your following list.',
  fans: 'No one follows you that you don\'t already follow back.',
  mutuals: 'No mutual follows found.',
};

function activeRecords() {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTab);
  if (!tab) return [];
  return sortRecords(filterRecords(tab.records, dom.search.value), dom.sort.value);
}

function refreshList() {
  const records = activeRecords();
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTab);
  const total = tab ? tab.records.length : 0;

  const message = dom.search.value.trim()
    ? 'No accounts match your search.'
    : EMPTY_MESSAGES[state.activeTab] || 'Nothing here.';

  state.listRenderer.setRecords(records, message);

  dom.listMeta.textContent =
    records.length === total
      ? `${total.toLocaleString()} account${total === 1 ? '' : 's'}`
      : `${records.length.toLocaleString()} of ${total.toLocaleString()} accounts`;
}

/**
 * What the summary tiles need beyond the numbers: which view is showing, and
 * the corrected following count once the user has told us what their profile
 * says.
 */
function summaryView() {
  const ghosts = ghostCount();
  return {
    activeTab: state.activeTab,
    onSelect: selectTab,
    onInfo: openCountDialog,
    followingShown: ghosts > 0 ? state.profileFollowing : null,
    followingNote: ghosts > 0
      ? `${state.results.totals.following.toLocaleString()} in your export`
      : null,
  };
}

function selectTab(tabId) {
  state.activeTab = tabId;
  renderTabs(dom.tabs, state.tabs, state.activeTab, selectTab);
  renderSummary(dom.summary, state.results, summaryView());
  refreshList();
}

function showResults(results, notices, hasTimestamps) {
  state.results = results;
  state.tabs = buildTabs(results);
  state.activeTab = 'notFollowingBack';
  // A fresh file means the old profile number no longer applies.
  state.profileFollowing = null;

  renderNotices(dom.notices, notices);
  renderCountNote();
  // The tiles are painted by selectTab below, which is what keeps the
  // highlighted tile and the shown list in step with each other.

  // Date sorting is meaningless without timestamps, which the HTML export
  // doesn't provide - so hide those options rather than offering a no-op.
  for (const option of dom.sort.options) {
    option.hidden = !hasTimestamps && option.value !== 'username';
  }
  if (!hasTimestamps) dom.sort.value = 'username';

  dom.search.value = '';
  selectTab('notFollowingBack');
  navigate('results');
}

state.listRenderer = createListRenderer(dom.accounts, state.handled, (key, isHandled) => {
  if (isHandled) state.handled.add(key);
  else state.handled.delete(key);
  saveHandled(state.handled);
});

dom.search.addEventListener('input', refreshList);
dom.sort.addEventListener('change', refreshList);

// Rows render a page at a time; this pulls in the next page as the user
// approaches the end of the list.
new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) state.listRenderer.loadMore();
}, { rootMargin: '400px' }).observe(dom.sentinel);

/* ---------------------------------------------------------------
   List actions
   --------------------------------------------------------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and permission; fall back to the
    // old selection trick so this still works over plain http or in Safari.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flash(button, message) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = message;
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(
    setTimeout(() => { button.textContent = button.dataset.label; }, 1600)
  );
}

dom.copyButton.addEventListener('click', async () => {
  const records = activeRecords();
  if (records.length === 0) return;
  const text = records.map((record) => `@${record.username}`).join('\n');
  flash(dom.copyButton, (await copyText(text)) ? 'Copied' : 'Copy failed');
});

dom.csvButton.addEventListener('click', () => {
  const records = activeRecords();
  if (records.length === 0) return;

  // Built and downloaded entirely in-page; the blob never touches a network.
  const blob = new Blob([toCsv(records)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `instagram-${state.activeTab}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

dom.clearButton.addEventListener('click', () => {
  state.handled.clear();
  clearHandled();
  refreshList();
  flash(dom.clearButton, 'Cleared');
});

dom.startOver.addEventListener('click', () => {
  state.results = null;
  state.profileFollowing = null;
  dom.fileInput.value = '';
  dom.folderInput.value = '';
  setStatus(dom.uploadStatus, '', null);
  navigate('home');
});

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */

selectDevice(detectDevice());
showScreen(currentScreen(), { moveFocus: false });
