# రఘువంశం — Raghuvamsa Reader (PWA)

A static, installable PWA for reading Raghuvamsa slokas with Telugu
commentary across six topics (Padavibhaga, Anvyaya, Akanksha, Bhava,
Vyakarana, Others), Unicode Telugu search, font-size control, and
last-read-position tracking. No build step — plain HTML/CSS/JS.

## Files

- `index.html` — app shell
- `style.css` — styling (palm-leaf manuscript theme)
- `app.js` — all logic: data load, rendering, search, swipe, menu
- `sw.js` — service worker (offline app shell caching)
- `manifest.json` — PWA install manifest
- `icons/` — app icons
- `test-data/raghu-sample.js` — small local fixture used only for
  offline testing of the parsing/search logic; not loaded by the app

## Before deploying: point at your real data file

`app.js` currently loads the test dataset from:

```js
const DATA_URL = "https://gvssmark.github.io/raghu/raghu.json";
```

Once the full `raghu.json` lives in this repo, change this to a local
relative path, e.g.:

```js
const DATA_URL = "./data/raghu.json";
```

and add that same path to `SHELL_FILES` in `sw.js` if you want the
service worker to precache it directly (optional — IndexedDB already
persists the data for offline use after first load regardless).

**Important:** the data file must stay in the `var raghu = [...];`
format (a JS assignment, not strict JSON) since `app.js` fetches it as
text and extracts the `[...]` — or, if you switch it to pure JSON, you
can simplify `fetchAndParseData()` to a plain `fetch(...).then(r =>
r.json())`.

## Data shape expected

Each row (after the header row, which is skipped) is a flat array:

```
[Sarga, SargaNo, SlokamNo, Slokam, Padavibhaga, Anvyaya, Akanksha, Bhava, Vyakarana, Others]
```

- `Slokam` — verse text; lines separated by `\n` are rendered as
  alternating red/blue lines in the fixed sloka panel.
- `Akanksha` — line breaks (`\n`) are joined into a single line with
  ` # ` as the separator, per current spec. If you want the same
  treatment for another column, add `joinLineBreaks: true` to that
  topic's entry in the `TOPICS` array in `app.js`.

## Deploying to GitHub Pages

1. Push this folder's contents to a repo (or a `/docs` folder / a
   `gh-pages` branch, whichever you use for Pages).
2. Enable GitHub Pages on that branch/folder in repo settings.
3. Because `sw.js` and `manifest.json` use relative paths, this works
   whether the site is served from the repo root or a subpath
   (`username.github.io/reponame/`) — no path rewriting needed.
4. HTTPS is required for service workers; GitHub Pages serves HTTPS by
   default, so no extra config needed there.

## What's implemented vs. what's still a placeholder

Implemented: sloka rendering with alternating line colors, six
swipeable/tappable topic tabs defaulting to Akanksha, Akanksha's
`#`-joined line breaks, footer Prev/Next that double as position
bookmarking (saved to `localStorage`), Unicode Telugu word search
across Slokam + Padavibhaga with highlighting, offline caching of
both the app shell (service worker) and the dataset (IndexedDB),
plus:

- **Sarga/Sloka menu** (Home button): an accordion — tap a sarga to
  expand its slokas, each shown as `SlokamNo` + first word of the
  first line. Tapping a sloka jumps straight to it and sets it as the
  bookmark. The sarga containing whatever's currently open
  auto-expands.
- **Search persistence + "browsing search results" mode**: the search
  query and results stay put when you close/reopen the search panel —
  only the **×** clear button inside the input empties it. Tapping a
  result jumps to that sloka *without* moving your bookmark, and shows
  a gold banner ("browsing search results — tap to return to
  bookmark"). Prev/Next keep working normally while that banner is
  up, but they don't touch the bookmark either — only tapping the
  banner (or manually navigating to a new sloka via the menu) clears
  search-navigation mode.
- **Live data-update detection**: see the section below.
- **Page-flip transition** on Prev/Next: a short 3D `rotateY` fold of
  the sloka panel (Web Animations API), skipped gracefully on
  browsers without WAAPI support.

Left as a placeholder since real content wasn't available yet: topic
tab icons are generic glyphs — swap the `icon*()` functions in
`app.js` for real iconography if you have a specific set in mind.

## Live data updates (`updated.js`)

Add a small file next to `raghu.json` — e.g. `updated.js` — containing
a single version marker:

```js
updated = "080820261830";
```

The app treats this as an **opaque string**, not a real parsed date —
it never tries to interpret `ddmmyyhhmmss` as an actual timestamp. It
just compares this string against the value it last saved in
`localStorage`. So the rule is simple: **whenever you edit
`raghu.json`, also change this string to anything different** (a
fresh `ddmmyyhhmmss` stamp is a natural choice, but even a bumped
counter would work).

Update this file's URL alongside `DATA_URL` in `app.js`:

```js
const UPDATED_URL = "https://gvssmark.github.io/raghu/updated.js";
```

How the check runs:
1. On every app load, plus every 10 minutes while the app stays open,
   plus whenever the app regains focus (tab/app switched back to) —
   the app fetches only `updated.js` (a tiny file, cheap to check
   often) and compares it to the saved version.
2. If it differs, the app fetches the full `raghu.json`, rebuilds the
   search index and the sarga/sloka menu, updates the IndexedDB cache,
   and re-locates whatever sloka was on screen (and the bookmark) by
   matching `(Sarga, SlokamNo)` — so indices shifting around in the
   updated file doesn't strand the reader on the wrong content.
3. If it's offline or `updated.js` is unreachable, the check just
   fails silently and the app keeps using its cached copy — no error
   shown to the reader.

This means a normal content edit is just: edit `raghu.json`, bump the
string in `updated.js`, push both. No rebuild step, no cache-busting
query params needed.
