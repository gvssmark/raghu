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
bookmarking (saved to `localStorage`), Home → side menu with a Sarga
jump list and font-size control, Unicode Telugu word search across
Slokam + Padavibhaga with highlighting, offline caching of both the
app shell (service worker) and the dataset (IndexedDB).

Left as a placeholder since real content wasn't available yet:
- Topic tab icons are generic glyphs — swap `icon*()` functions in
  `app.js` for real iconography if you have a specific set in mind.
- The "position saved" indicator in the topbar is a static icon
  rather than a full bookmarks list — the design discussion assumed
  Prev/Next-as-bookmark meant *last position*, not a saved list; say
  the word if you actually want a multi-bookmark list later, since
  the side menu is already structured to hold one.
