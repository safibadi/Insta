/**
 * Instruction content for the "get your file" screen.
 *
 * The request flow itself is genuinely identical on Android and iOS - both go
 * through the same Meta Accounts Center screens with the same taps. What
 * differs is what happens after the email arrives: where the ZIP lands and how
 * you hand it to a web page. So the steps below share their first half and
 * diverge at the end, which is exactly where users actually get stuck.
 */

export const DYI_URL = 'https://accountscenter.instagram.com/info_and_permissions/dyi/';

/** A hint for pre-selecting the tab, never a lock - the toggle stays usable. */
export function detectDevice() {
  const ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac, so the touch-point check catches it.
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpad) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Folder upload relies on a non-standard input attribute that iOS lacks. */
export function supportsFolderUpload() {
  return 'webkitdirectory' in document.createElement('input');
}

const REQUEST_STEPS_APP = [
  'Open Instagram and go to your profile.',
  'Tap the ☰ menu (top right), then <b>Settings and privacy</b>.',
  'Tap <b>Accounts Center</b>, then <b>Your information and permissions</b>.',
  'Tap <b>Download your information</b> → <b>Download or transfer information</b>.',
  'Pick your Instagram account, then choose <b>Some of your information</b>.',
];

const REQUEST_STEPS_WEB = [
  'Open Instagram in your browser and sign in.',
  'Go to <b>Settings</b> → <b>Accounts Center</b> → <b>Your information and permissions</b>.',
  'Click <b>Download your information</b> → <b>Download or transfer information</b>.',
  'Pick your Instagram account, then choose <b>Some of your information</b>.',
];

const CHOOSE_DATA_STEP = {
  html:
    'Scroll to <b>Connections</b> and tick <b>Followers and following</b> — ' +
    'just that one, nothing else.',
  highlight:
    'This is the step that matters most. Selecting everything produces a ' +
    'huge archive full of your photos and videos, which takes far longer to ' +
    'prepare and can be slow to open on a phone. Ticking only this keeps the ' +
    'file small and fast.',
};

const DELIVERY_STEPS = [
  'Choose <b>Download to device</b>.',
  'Set date range to <b>All time</b> and format to <b>JSON</b>, then tap <b>Create files</b>.',
  'Instagram emails you a link — usually within minutes, sometimes up to 24 hours. ' +
    '<b>The link expires after 4 days.</b>',
];

export const DEVICES = {
  android: {
    label: 'Android',
    requestSteps: REQUEST_STEPS_APP,
    chooseStep: CHOOSE_DATA_STEP,
    deliverySteps: DELIVERY_STEPS,
    retrieveSteps: [
      'Open the emailed link in Chrome and let the ZIP download.',
      'It saves to <b>Files</b> → <b>Downloads</b>.',
      'Come back here, tap <b>Choose file</b>, and pick the ZIP. No need to unzip it.',
    ],
  },
  ios: {
    label: 'iPhone',
    requestSteps: REQUEST_STEPS_APP,
    chooseStep: CHOOSE_DATA_STEP,
    deliverySteps: DELIVERY_STEPS,
    retrieveSteps: [
      'Open the emailed link in Safari and let the ZIP download.',
      'It saves to the <b>Files</b> app → <b>Downloads</b>.',
      'Come back here, tap <b>Choose file</b>, and pick the ZIP.',
      'If picking the ZIP does not work, open <b>Files</b>, long-press it, tap ' +
        '<b>Uncompress</b>, then select <b>followers_1.json</b> and ' +
        '<b>following.json</b> together.',
    ],
  },
  desktop: {
    label: 'Computer',
    requestSteps: REQUEST_STEPS_WEB,
    chooseStep: CHOOSE_DATA_STEP,
    deliverySteps: DELIVERY_STEPS,
    retrieveSteps: [
      'Open the emailed link and download the ZIP.',
      'Come back here and drag the ZIP onto the upload box — or unzip it first ' +
        'and drop in the whole folder.',
    ],
  },
};
