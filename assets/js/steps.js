/**
 * Instruction content for the "get your file" screen.
 *
 * The request flow itself is genuinely identical on Android and iOS - both go
 * through the same Meta Accounts Center screens with the same taps. What
 * differs is what happens after the email arrives: where the ZIP lands and how
 * you hand it to a web page. So the app steps below share their first half and
 * diverge at the end, which is exactly where users actually get stuck.
 *
 * The Computer path is NOT the same flow. It reaches the same Accounts Center
 * but through a different shell, with different labels, an extra screen and an
 * extra password prompt, so it gets its own strings rather than reusing the
 * app ones with "Tap" left in.
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

/*
 * The iPhone path below is transcribed from screenshots of the real flow
 * (Instagram, August 2026) and is verified step by step. The Computer path was
 * walked through in a desktop browser (August 2026) and is likewise verified.
 * Android has not been walked through on a device, so treat its wording as
 * close rather than confirmed.
 *
 * Instagram renamed most of this: "Settings and privacy" is now "Settings and
 * activity", "Download your information" is now "Export your information",
 * and the final button is "Start export" rather than "Create files".
 *
 * The web build also uses US spelling where the app uses British - "Accounts
 * Center", "Customize information" - so the Computer steps are spelled to
 * match what is actually on screen.
 */

const REQUEST_STEPS_APP = [
  'Open Instagram, go to your profile and tap the ☰ ' +
    '<b>Settings and activity</b> menu (top right).',
  'At the top, under <i>Your account</i>, tap <b>Accounts Centre</b>.',
  'Tap <b>Your information and permissions</b>.',
  'Tap <b>Export your information</b>, then <b>Create export</b>.',
  'Pick your Instagram account, then choose <b>Export to device</b>.',
];

const REQUEST_STEPS_WEB = [
  'Open Instagram in your browser and sign in.',
  'In the left sidebar click <b>More</b> (☰, at the bottom), then ' +
    '<b>Settings</b>. There is no “Settings and activity” menu on the web.',
  'Settings opens on <i>Edit profile</i>. In the <b>Accounts Center</b> box at ' +
    'the top of the sidebar, click <b>See more in Accounts Center</b> — ' +
    '<i>Your information and permissions</i> is not in the Instagram list ' +
    'itself.',
  'Click <b>Your information and permissions</b>, then <b>Export your ' +
    'information</b>, then <b>Create export</b>.',
  'Pick your Instagram profile on <b>Choose a profile</b>, then pick ' +
    '<b>Export to device</b> on <b>Choose where to export</b>. That lands you ' +
    'on <b>Confirm your export</b>, where the next three steps live.',
];

const CHOOSE_DATA_STEP = {
  html:
    'Tap <b>Customise information</b>. Everything starts ticked, so tap ' +
    '<b>Clear all</b> on each section, then scroll to <b>Connections</b> and ' +
    'tick <b>Followers and following</b> — that one only. Tap <b>Save</b>.',
  highlight:
    'Instagram pre-selects every category, so this screen opens with all of ' +
    'your photos, videos and messages already included. Left as-is you get a ' +
    'multi-gigabyte archive that takes hours to build and can be slow to open ' +
    'on a phone. Clearing everything and ticking only Followers and following ' +
    'keeps it under a megabyte and usually ready within minutes.',
};

const CHOOSE_DATA_STEP_WEB = {
  html:
    'Click <b>Customize information</b>. Everything starts ticked and the ' +
    'list is split into eight sections, each with its own <b>Clear all</b> — ' +
    'click every one of them. A cleared section’s link flips to ' +
    '<i>Select all</i>; that is how you know it is empty, not that you undid ' +
    'something. Then scroll to <b>Connections</b> and tick <b>Followers and ' +
    'following</b> — that one only. Click <b>Save</b>.',
  highlight:
    'Instagram pre-selects every category, so this screen opens with all of ' +
    'your photos, videos and messages already included. Left as-is you get a ' +
    'multi-gigabyte archive that takes hours to build. Clearing everything and ' +
    'ticking only Followers and following keeps it under a megabyte and ' +
    'usually ready within minutes.',
};

const DELIVERY_STEPS = [
  'Tap <b>Date range</b> → <b>All time</b> → <b>Save</b>.',
  'Tap <b>Format</b> → <b>JSON</b> → <b>Save</b>. (HTML works here too, but ' +
    'JSON gives exact follow dates.)',
  'Tap <b>Start export</b>. You will receive an email with the subject ' +
    '“Your Meta download request is in progress”.',
  'You will receive a second email with the subject “Your Meta information ' +
    'download is ready” — often within minutes. ' +
    '<b>You then have 4 days to download it.</b>',
];

const DELIVERY_STEPS_WEB = [
  'Click <b>Date range</b> → <b>All time</b> → <b>Save</b>. It defaults to ' +
    '<i>Last year</i>, so this one does need changing.',
  'Click <b>Format</b> → <b>JSON</b> → <b>Save</b>. It defaults to <i>HTML</i>, ' +
    'which works here too, but JSON gives exact follow dates.',
  'Click <b>Start export</b>. Instagram then asks you to <b>re-enter your ' +
    'password</b> — type it and click <b>Continue</b>.',
  'The request now appears under <b>Requested</b> on the same screen, and you ' +
    'will receive an email with the subject ' +
    '“Your Meta download request is in progress”.',
  'You will receive a second email with the subject “Your Meta information ' +
    'download is ready” — often within minutes. ' +
    '<b>You then have 4 days to download it.</b>',
];

export const DEVICES = {
  android: {
    label: 'Android',
    requestSteps: REQUEST_STEPS_APP,
    chooseStep: CHOOSE_DATA_STEP,
    deliverySteps: DELIVERY_STEPS,
    retrieveSteps: [
      'When the email arrives, go back to ☰ <b>Settings and activity</b> menu → ' +
        '<b>Accounts Centre</b> → <b>Your information and permissions</b> → ' +
        '<b>Export your information</b> — your file is listed under ' +
        '<b>Available downloads</b>. Tap <b>Download</b>.',
      'The ZIP saves to <b>Files</b> → <b>Downloads</b>.',
      'Come back here, tap <b>Choose file</b>, and pick the ZIP. No need to unzip it.',
    ],
  },
  ios: {
    label: 'iPhone',
    requestSteps: REQUEST_STEPS_APP,
    chooseStep: CHOOSE_DATA_STEP,
    deliverySteps: DELIVERY_STEPS,
    retrieveSteps: [
      'When the email arrives, go back to ☰ <b>Settings and activity</b> menu → ' +
        '<b>Accounts Centre</b> → <b>Your information and permissions</b> → ' +
        '<b>Export your information</b> — your file is listed under ' +
        '<b>Available downloads</b>. Tap <b>Download</b>.',
      'Come back here, tap <b>Choose file</b>, and pick the ZIP.',
      'If picking the ZIP does not work, open <b>Files</b>, long-press it, tap ' +
        '<b>Uncompress</b>, then select <b>followers_1.json</b> and ' +
        '<b>following.json</b> together.',
    ],
  },
  desktop: {
    label: 'Computer',
    requestSteps: REQUEST_STEPS_WEB,
    chooseStep: CHOOSE_DATA_STEP_WEB,
    deliverySteps: DELIVERY_STEPS_WEB,
    retrieveSteps: [
      'When the email arrives, go back to <b>More</b> (☰) → <b>Settings</b> → ' +
        '<b>See more in Accounts Center</b> → <b>Your information and ' +
        'permissions</b> → <b>Export your information</b> and download your ' +
        'file from <b>Available downloads</b>. ' +
        '<a href="https://accountscenter.instagram.com/info_and_permissions/dyi/">' +
        'This link</a> goes straight there.',
      'Come back here and drag the ZIP onto the upload box — or unzip it first ' +
        'and drop in the whole folder.',
    ],
  },
};
