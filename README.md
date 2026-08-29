# Who doesn't follow you back — Instagram non-followers checker

A single static page that tells you which accounts you follow on Instagram
that don't follow you back.

**Everything runs in your browser.** Your export file is never uploaded
anywhere. There is no server, no account, and no Instagram login — the page
reads the data export that Instagram already gives you.

---

## Why not just use one of the apps?

Every "unfollower" app in the app stores asks for your Instagram username and
password so it can log in as you. That hands over your credentials and is a
well-known way to get your account action-blocked or banned.

This tool never sees your password because it never talks to Instagram at all.
It reads the data export you download from Instagram yourself.

## How the privacy claim is enforced

Not a promise in a policy document — a rule your browser applies:

```html
<meta http-equiv="Content-Security-Policy" content="... connect-src 'none' ...">
```

`connect-src 'none'` tells the browser to block every outgoing network request
this page could make. Not to us, not to anyone. Even a bug or a malicious pull
request could not upload your data, because the browser refuses before the
request leaves. Everything the page loads comes from its own origin, so there
is no third-party script either.

The simplest proof, and one you can run yourself: **turn on airplane mode, then
upload your file.** It still works.

There's an automated test for this too — `tests/run-e2e.mjs` asserts that
processing a file produces exactly zero network requests, and that the app
never contacts any origin but its own.

---

## Getting your file from Instagram

The request steps are **identical on Android and iPhone** — both go through the
same Meta Accounts Center screens. Only the last part, finding the downloaded
file, differs.

Direct link to the download page:
<https://accountscenter.instagram.com/info_and_permissions/dyi/>
(on a computer, `instagram.com/dyi` works too)

1. Instagram → your profile → ☰ menu → **Settings and activity**
2. Under *Your account*, tap **Accounts Centre**
3. **Your information and permissions** → **Export your information**
4. **Create export** → pick your account → **Export to device**
5. **Customise information** → tap **Clear all** on every section, then under
   **Connections** tick **Followers and following** — *that one only* → **Save**
6. **Date range** → **All time** → **Save**
7. **Format** → **JSON** → **Save**
8. **Start export**
9. Instagram emails you when it's ready, often within minutes. Your file then
   appears under **Available downloads** on the same *Export your information*
   screen. **You have 4 days to download it.**

> **Step 5 is the one that matters.** Instagram arrives with *every* category
> already ticked, so leaving it alone exports all your photos, videos and
> messages — a multi-gigabyte archive that takes hours to build and can be slow
> to open on a phone. Clearing everything and ticking only *Followers and
> following* keeps it under a megabyte.
>
> That said, a full export still works here — see below.

These steps are transcribed from the real iPhone flow (Instagram, August 2026).
Android and desktop use the same Accounts Centre screens, since it is one
shared web flow, but have not been walked through on a device.

Then:

| Device | Where the file lands | What to upload |
|---|---|---|
| **Android** | Chrome → Files → Downloads | the `.zip`, as-is |
| **iPhone** | Safari → Files app → Downloads | the `.zip` — or long-press → **Uncompress** and pick the `.json` files |
| **Computer** | your Downloads folder | the `.zip`, or unzip and drop in the folder |

## What the tool accepts

Anything Instagram hands you:

- **The `.zip`** straight from Instagram — including a **full export** with all
  your photos, videos and messages in it. The reader parses the archive index
  and pulls out only the two or three files it needs, so a multi-gigabyte
  archive costs about as much memory as a small one. Everything else is
  ignored without ever being decompressed.
- **Loose `.json` files** — `followers_1.json`, `following.json`, and so on.
  Split follower lists (`followers_1`, `followers_2`, …) are merged
  automatically.
- **A whole unzipped folder** (on a computer).
- **The three different entry shapes Instagram uses.** `followers_1.json`
  states the username in a `value` field; `following.json` omits `value`
  entirely, putting the name in `title` and linking via `/_u/<username>`; and
  the request/blocked/favourite files drop `string_list_data` altogether in
  favour of a `label_values` array. `blocked_profiles.json` is a single record
  at the root rather than a list. All four are handled, and each has a
  regression test.
- **Instagram's double-encoded text.** The export writes UTF-8 bytes escaped as
  Latin-1, so `Renée 💙` arrives as `Ren\u00c3\u00a9e ...` and would
  otherwise render as mojibake. Names are repaired on read.
- **The HTML export**, if you picked HTML instead of JSON. Fully supported —
  every count and list is exactly as accurate as with JSON. The only
  difference is that the HTML format has no machine-readable follow dates, so
  sorting by date isn't offered and the date shown is Instagram's own text.
  JSON is still the better choice if you're asked.

Files are matched by name wherever they sit in the archive, because Instagram
has moved the folder between `connections/followers_and_following/` and
`followers_and_following/` across export versions.

### A note on counts

The numbers here come from your export file, and can sit slightly above what
your Instagram profile shows. That gap is between Instagram's export and
Instagram's own counter — it is not introduced by this tool.

Checked against a real export where the profile read 518 following and the file
listed 532: the followers count matched exactly (441/441), every one of the 532
entries was a distinct, valid handle, and none of the difference was explained
by duplicates, pending requests, or recently-unfollowed accounts. The remaining
explanation is accounts Instagram still has on file but no longer counts.

That has since been confirmed directly: opening one of the resulting
"doesn't follow back" profiles returns Instagram's *"Sorry, this page isn't
available."* The account was present in `following.json`, absent from
`followers_1.json`, and so landed in the headline list exactly as the
explanation predicts. One confirmed case does not prove the whole gap is that,
but the mechanism is real rather than presumed.

It matters for reading the results: accounts like that never follow you back,
so they land in "Doesn't follow back" and inflate it by however many there are.
Mutuals are unaffected, since an account that follows you back is live.

The **i** on the Following tile turns that caveat into a number. It asks
whether your profile shows a different following count, and if you type in the
number your profile shows, the difference is exactly how many accounts in your
export Instagram no longer counts — *"14 profiles are deleted or deactivated"*
rather than *"some of these may be"*. The Following tile is then corrected to
your profile's number, with the export figure kept underneath it. The tool
can't tell you *which* rows those are, only how many, since a deleted account
looks like any other line in the file.

## What you get

- **Doesn't follow back** — the headline: accounts you follow that don't follow you
- **Followers** and **Following** — the two raw lists as they came out of the file
- **Fans** — accounts that follow you but you don't follow back
- **Mutuals** — the overlap
- **Requests sent**, **Recently unfollowed**, **Close friends**, **Blocked** —
  shown only if those files are in your export

Every count at the top of the results is a button: tap the number and the list
below switches to it.

Each row is a link — tap the avatar, the username, or the **Open** button and
that profile opens in a new tab. Opening one ticks its checkbox for you, since
that is the point at which you have dealt with someone; untick it again if you
haven't. Your checklist is saved in your browser so you can work through a long
list over several sittings. Search, sort, copy all usernames, and CSV export
are all there.

## Two things this deliberately does not do

**It can't unfollow for you.** Instagram has no public unfollow API, and your
browser's same-origin policy blocks any request from this page to
instagram.com. The only way around that is automating a logged-in session,
which violates Instagram's Terms of Use and is a reliable way to get
action-blocked. So you get a link and a checklist instead.

**It can't show profile photos.** The export contains usernames, profile URLs
and follow dates — no avatars, bios or follower counts. Those can't be fetched
either: profile pages are blocked by the same-origin policy, and Instagram's
image URLs are signed and expire. You'll see a generated initials avatar, and
the real photo when you tap through. The alternative would be sending your
entire following list to a third-party avatar service, which would defeat the
point of the tool.

---

## Running it locally

No build step, no dependencies to install for the app itself. It's plain HTML,
CSS and ES modules. Because it uses modules, it needs to be served over HTTP
rather than opened as a `file://` URL:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Tests

```bash
python3 tests/make-fixtures.py     # generate fixtures (gitignored)
node tests/run-unit.mjs            # 87 parser/analysis assertions
node tests/run-e2e.mjs             # 69 browser assertions + screenshots
```

The unit suite also runs in a normal browser at
`http://localhost:8000/tests/parse.test.html` if you'd rather watch it.

The e2e suite covers the full wizard on an emulated iPhone SE, a 360px phone
and a desktop viewport, and checks that the landing screen fits without
scrolling, that tap targets are at least 44px, that a username shaped like
`<script>` renders as text rather than executing, and that nothing touches the
network.

## Deploying

The site is hosted on **Cloudflare Workers** — a Worker that serves static
assets — built straight from this repository's Git integration. Push to `main`
and Cloudflare builds and publishes; there is no deploy step in GitHub Actions.

There are two pieces of configuration, and which one lives where matters:

| Where | Setting | Value |
|---|---|---|
| Cloudflare dashboard | Build command | `./build.sh` |
| Cloudflare dashboard | Root directory | `/` |
| `wrangler.jsonc`, in this repo | `assets.directory` | `./_site` |

A Worker with static assets has no "build output directory" field in the
dashboard; the published directory lives in `wrangler.jsonc` instead. Keeping it
in the repo is deliberate — it is reviewable, and it applies identically to
every branch.

Leaving it out is not a harmless omission. `wrangler deploy` runs a first-run
setup wizard when it finds no config, and a build has nobody to answer it, so it
accepts the default `assets.directory = "."` and publishes the repository root —
`.git/` and `tests/` included — to the public site. That is not hypothetical;
it happened here, and `.git/config` was readable on the live site until it was
fixed. `wrangler versions upload`, which Cloudflare runs for non-production
branches, has no such fallback and simply fails, which is why failing branch
builds were the first symptom of an already-leaking `main`.

`build.sh` copies `index.html`, `assets/`, the README and the licence into
`_site/`. There is no compile step — it exists only so that the test harness
and the CI config aren't served alongside the app. The repository is private;
the deployed site is not, and only what lands in `_site/` is deployed. CI checks
both halves on every push: that nothing extra lands in `_site/`, and that
`wrangler.jsonc` still points at `_site/`.

Cloudflare serves private repositories on the free plan, which GitHub Pages does
not — that is the reason for the move.

### What CI does now

`.github/workflows/ci.yml` runs the unit and browser suites and the build
check on every push and pull request. It no longer deploys anything.

One consequence worth knowing: because Cloudflare deploys from the Git
integration, a push to `main` publishes whether or not CI is green — the two
run in parallel rather than in sequence. If you want tests to gate the deploy,
turn the Git integration off and publish from CI with
[`wrangler deploy`](https://developers.cloudflare.com/workers/wrangler/commands/#deploy)
in a job that `needs: test`, which requires a `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the repository secrets.

### Setting it up from scratch

1. Sign up at <https://dash.cloudflare.com> (free, no card).
2. **Workers & Pages** → **Create** → **Import a repository**.
3. Authorize GitHub and pick this repo (private repos are fine).
4. Set the build command to `./build.sh`. Leave the deploy command at
   `npx wrangler deploy` — `wrangler.jsonc` is what tells it to publish
   `_site/` rather than the repository root.
5. Deploy. You get `https://<name>.<subdomain>.workers.dev`, and can attach your
   own domain for free.

### A note on analytics

Cloudflare's Web Analytics beacon can't be used here. It is a third-party
script, so the page's own `script-src 'self'` refuses to load it — adding the
snippet doesn't produce analytics, it produces a console error and a failing
test. Loosening the CSP to admit it would cost the guarantee the whole tool is
built on, so the beacon stays out.

The request analytics in the Cloudflare dashboard (**Workers & Pages** → your
project → **Metrics**) need no beacon at all, because they are measured at the
edge rather than in the visitor's browser. That is the way to get traffic
numbers here.

### Other genuinely free options

All of these cost $0 with no credit card and give you a free subdomain.

| Host | Free URL | Private repo? | Notes |
|---|---|---|---|
| **Cloudflare Workers** | `*.workers.dev` | ✓ on the free plan | Unlimited bandwidth, 500 builds/month. What this repo uses. |
| GitHub Pages | `*.github.io` | ✗ — needs paid Pro | Free forever for public repos. |
| Netlify | `*.netlify.app` | ✓ | 100 GB bandwidth, 300 build minutes/month. Drag-and-drop deploys. |
| Vercel Hobby | `*.vercel.app` | ✓ | Free, but **non-commercial use only** under their fair-use terms. Overkill for a static page. |
| GitLab / Codeberg Pages, Surge.sh | subdomain | varies | Solid fallbacks. |

Either way the *deployed site* is public; private only hides the source. Since
this is a privacy tool with no secrets in it, a public repo is arguably a
feature — anyone can verify it does what it claims.

**On v0:** that's Vercel's AI UI-generation product with limited free credits,
not a hosting plan. Not what you want for this.

Because the site is plain static files, moving between any of these hosts is
just copying the folder.

---

## Project layout

```
index.html                  four screens, hash-routed, with the CSP
assets/css/style.css        mobile-first, light/dark
assets/js/zip.js            dependency-free ZIP reader (see below)
assets/js/parse.js          export files -> normalized account records
assets/js/analyze.js        set operations for each view
assets/js/steps.js          per-device export instructions
assets/js/ui.js             rendering
assets/js/main.js           routing and wiring
tests/                      fixture generator, unit suite, e2e suite
build.sh                    stages the publishable site into _site/
```

### Why the ZIP reader is hand-written

The usual ZIP libraries load the whole archive into memory, which crashes
mobile browsers on a multi-gigabyte full export. This reader parses the
archive's central directory and then slices only the byte ranges of the two or
three files it actually needs, decompressing them with the platform's built-in
`DecompressionStream`. It handles ZIP64, so archives over 4 GB work too.

It also means the project has **zero third-party code** — nothing vendored,
nothing from a CDN. That's what makes the "no outbound requests" guarantee
easy to verify.

## Not affiliated with Instagram or Meta.

## License

MIT — see [LICENSE](LICENSE).
