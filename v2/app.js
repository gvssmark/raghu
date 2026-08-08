"use strict";

/* =========================================================
   CONFIG
   ---------------------------------------------------------
   DATA_URL / UPDATED_URL point at the test dataset for now.
   Once the real files live inside this repo, change both to
   local relative paths (e.g. "./data/raghu.json" and
   "./data/updated.js") so the PWA can fully cache them
   offline without depending on another origin.

   updated.js is a tiny file containing a version marker, e.g.
       updated = "080820261830";
   It is NOT parsed as a real date — it's treated as an opaque
   string. Whenever raghu.json is edited, change this string to
   anything different (a timestamp is a natural choice) and the
   app will detect the mismatch and pull fresh data.
========================================================= */
const DATA_URL = "https://gvssmark.github.io/raghu/raghu.json";
const UPDATED_URL = "https://gvssmark.github.io/raghu/updated.js";
const DATA_VERSION_KEY = "raghu_data_version";
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min while app stays open

const DB_NAME = "raghu-db";
const DB_VERSION = 1;
const STORE_ROWS = "rows";

const TOPICS = [
  { key: "padavibhaga", label: "Padavibhaga", icon: iconSplit() },
  { key: "anvyaya",     label: "Anvyaya",     icon: iconOrder() },
  { key: "akanksha",    label: "Akanksha",    icon: iconAkanksha(), joinLineBreaks: true },
  { key: "bhava",       label: "Bhava",       icon: iconBhava() },
  { key: "vyakarana",   label: "Vyakarana",   icon: iconGrammar() },
  { key: "others",      label: "Others",      icon: iconOthers() },
];
const DEFAULT_TOPIC_KEY = "akanksha";

/* =========================================================
   STATE
========================================================= */
const state = {
  rows: [],                // flat array of sloka objects, in file order
  sargaList: [],            // [{sarga, sargaNo, firstIndex}]
  sargaTree: [],            // [{sarga, sargaNo, slokas:[{idx, slokamNo, firstWord}]}]
  currentIndex: 0,          // index into state.rows — what's on screen
  bookmarkIndex: 0,         // index into state.rows — last "real" reading position
  currentTopicKey: DEFAULT_TOPIC_KEY,
  fontScale: 1,
  wordIndex: null,          // Map<word, Set<rowIndex>>  (built from Slokam + Padavibhaga)
  searchQuery: "",           // persists until explicitly cleared
  searchNavActive: false,    // true while browsing via a search result
  expandedSargas: new Set(),
};

/* =========================================================
   BOOT
========================================================= */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  loadPrefs();
  applyFontScale();
  buildTopicTabs();
  wireStaticUI();
  registerServiceWorker();

  try {
    const cached = await idbGetAllRows();
    if (cached && cached.length) {
      state.rows = cached;
      afterDataReady();
      checkForDataUpdate(); // cheap version check, upgrades in background if changed
    } else {
      const rows = await fetchAndParseData();
      state.rows = rows;
      await idbPutAllRows(rows);
      await primeDataVersion();
      afterDataReady();
    }
  } catch (err) {
    console.error("Data load failed", err);
    document.getElementById("slokaLines").innerHTML =
      '<p class="sloka-loading">డేటా లోడ్ కాలేదు. ఇంటర్నెట్ తనిఖీ చేయండి.</p>';
  }

  wireUpdatePolling();
}

function afterDataReady() {
  buildSargaList();
  buildSargaTree();
  buildWordIndex();
  renderSargaTree();

  const savedIndex = getSavedPositionIndex();
  state.bookmarkIndex = savedIndex != null ? savedIndex : 0;
  goToIndex(state.bookmarkIndex, { save: false });
}

/* =========================================================
   DATA FETCH + PARSE (raghu.json is `var raghu = [...];`, not
   strict JSON, so we fetch as text and strip the JS wrapper.)
========================================================= */
async function fetchAndParseData() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Fetch failed: " + res.status);
  const text = await res.text();

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Unexpected data format");
  const arr = JSON.parse(text.slice(start, end + 1));

  const [, ...dataRows] = arr; // drop header row
  return dataRows.map((r, i) => ({
    idx: i,
    sarga: r[0],
    sargaNo: Number(r[1]),
    slokamNo: Number(r[2]),
    slokam: r[3] || "",
    padavibhaga: r[4] || "",
    anvyaya: r[5] || "",
    akanksha: r[6] || "",
    bhava: r[7] || "",
    vyakarana: r[8] || "",
    others: r[9] || "",
  }));
}

function buildSargaList() {
  const seen = new Map();
  state.rows.forEach((row, i) => {
    if (!seen.has(row.sargaNo)) {
      seen.set(row.sargaNo, { sarga: row.sarga, sargaNo: row.sargaNo, firstIndex: i });
    }
  });
  state.sargaList = [...seen.values()].sort((a, b) => a.sargaNo - b.sargaNo);
}

function buildSargaTree() {
  const bySarga = new Map();
  state.rows.forEach((row) => {
    if (!bySarga.has(row.sargaNo)) {
      bySarga.set(row.sargaNo, { sarga: row.sarga, sargaNo: row.sargaNo, slokas: [] });
    }
    const firstLine = (row.slokam.split("\n")[0] || "").trim();
    const firstWord = firstLine.split(/\s+/)[0] || "";
    bySarga.get(row.sargaNo).slokas.push({ idx: row.idx, slokamNo: row.slokamNo, firstWord });
  });
  state.sargaTree = [...bySarga.values()].sort((a, b) => a.sargaNo - b.sargaNo);
}

/* =========================================================
   LIVE DATA UPDATE DETECTION (updated.js version marker)
========================================================= */
async function fetchRemoteVersion() {
  const res = await fetch(UPDATED_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("updated.js fetch failed: " + res.status);
  const text = await res.text();
  const match = text.match(/["'`]([^"'`]+)["'`]/);
  return match ? match[1] : text.trim();
}

async function primeDataVersion() {
  try {
    const v = await fetchRemoteVersion();
    localStorage.setItem(DATA_VERSION_KEY, v);
  } catch (_) {
    /* updated.js not available yet — fine, next check will retry */
  }
}

async function checkForDataUpdate() {
  try {
    const remoteVersion = await fetchRemoteVersion();
    const localVersion = localStorage.getItem(DATA_VERSION_KEY);
    if (!remoteVersion || remoteVersion === localVersion) return false;

    const rows = await fetchAndParseData();

    // Remember current + bookmarked sloka by (sargaNo, slokamNo) so we can
    // re-locate them after the row array is replaced (indices may shift).
    const curRow = state.rows[state.currentIndex];
    const bmRow = state.rows[state.bookmarkIndex];

    state.rows = rows;
    await idbPutAllRows(rows);
    localStorage.setItem(DATA_VERSION_KEY, remoteVersion);

    buildSargaList();
    buildSargaTree();
    buildWordIndex();
    renderSargaTree();

    const newCurIdx = findRowIndex(curRow) ?? 0;
    const newBmIdx = findRowIndex(bmRow) ?? 0;
    state.bookmarkIndex = newBmIdx;
    goToIndex(newCurIdx, { save: false });

    return true;
  } catch (_) {
    return false; // offline, or updated.js/raghu.json not reachable — keep using cache
  }
}

function findRowIndex(refRow) {
  if (!refRow) return null;
  const i = state.rows.findIndex(
    (r) => r.sargaNo === refRow.sargaNo && r.slokamNo === refRow.slokamNo
  );
  return i === -1 ? null : i;
}

function wireUpdatePolling() {
  setInterval(checkForDataUpdate, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForDataUpdate();
  });
}

/* =========================================================
   INDEXEDDB (offline cache of the dataset)
========================================================= */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ROWS)) {
        db.createObjectStore(STORE_ROWS, { keyPath: "idx" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllRows() {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ROWS, "readonly");
      const store = tx.objectStore(STORE_ROWS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.idx - b.idx));
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

async function idbPutAllRows(rows) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ROWS, "readwrite");
      const store = tx.objectStore(STORE_ROWS);
      store.clear();
      rows.forEach((r) => store.put(r));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {
    /* IndexedDB unavailable — app still works in-memory for this session */
  }
}

/* =========================================================
   PREFS (localStorage): font size, last read position
========================================================= */
function loadPrefs() {
  const f = Number(localStorage.getItem("raghu_font_scale"));
  if (f && f >= 0.8 && f <= 1.6) state.fontScale = f;
}

function saveFontScale() {
  localStorage.setItem("raghu_font_scale", String(state.fontScale));
}

function savePosition(row) {
  localStorage.setItem("raghu_last_sarga", String(row.sargaNo));
  localStorage.setItem("raghu_last_sloka", String(row.slokamNo));
  updateLastReadNote(row);
}

function getSavedPositionIndex() {
  const sargaNo = Number(localStorage.getItem("raghu_last_sarga"));
  const slokamNo = Number(localStorage.getItem("raghu_last_sloka"));
  if (!sargaNo || !slokamNo) return null;
  const i = state.rows.findIndex((r) => r.sargaNo === sargaNo && r.slokamNo === slokamNo);
  return i === -1 ? null : i;
}

function updateLastReadNote(row) {
  const el = document.getElementById("lastReadNote");
  if (el && row) el.textContent = `${row.sarga} · శ్లోకం ${row.slokamNo}`;
}

/* =========================================================
   RENDER: sloka panel
========================================================= */
function renderSloka(row) {
  const container = document.getElementById("slokaLines");
  container.innerHTML = "";
  const lines = (row.slokam || "").split("\n").map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const p = document.createElement("p");
    p.className = "sloka-line " + (i % 2 === 0 ? "line-red" : "line-blue");
    p.textContent = line;
    container.appendChild(p);
  });

  document.getElementById("topbarTitle").textContent = `${row.sarga} · శ్లోకం ${row.slokamNo}`;
}

/* =========================================================
   PAGE-FLIP TRANSITION (Prev/Next only)
========================================================= */
function flipSlokaPanel(direction, applyChanges) {
  const el = document.getElementById("slokaPanelInner");
  if (!el || typeof el.animate !== "function") { applyChanges(); return; } // no WAAPI support — just render

  const outAngle = direction === "next" ? -90 : 90;
  const inAngle = direction === "next" ? 90 : -90;

  const anim1 = el.animate(
    [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${outAngle}deg)` }],
    { duration: 150, easing: "ease-in", fill: "forwards" }
  );
  anim1.onfinish = () => {
    applyChanges();
    el.style.transform = `rotateY(${inAngle}deg)`;
    const anim2 = el.animate(
      [{ transform: `rotateY(${inAngle}deg)` }, { transform: "rotateY(0deg)" }],
      { duration: 150, easing: "ease-out", fill: "forwards" }
    );
    anim2.onfinish = () => { el.style.transform = ""; };
  };
}

/* =========================================================
   RENDER: topic tabs + content
========================================================= */
function buildTopicTabs() {
  const nav = document.getElementById("topicTabs");
  nav.innerHTML = "";
  TOPICS.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "topic-tab" + (t.key === state.currentTopicKey ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.dataset.key = t.key;
    btn.innerHTML = `${t.icon}<span class="topic-tab-label">${t.label}</span>`;
    btn.addEventListener("click", () => selectTopic(t.key));
    nav.appendChild(btn);
  });
}

function selectTopic(key) {
  state.currentTopicKey = key;
  [...document.querySelectorAll(".topic-tab")].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.key === key);
  });
  renderTopicContent();
}

function renderTopicContent() {
  const row = state.rows[state.currentIndex];
  const topic = TOPICS.find((t) => t.key === state.currentTopicKey);
  const el = document.getElementById("topicText");
  if (!row || !topic) return;

  let text = (row[topic.key] || "").trim();

  if (topic.joinLineBreaks) {
    text = text.split("\n").map((l) => l.trim()).filter(Boolean).join(" # ");
  }

  el.innerHTML = text
    ? escapeHtml(text)
    : '<span class="topic-empty">ఈ విభాగానికి సమాచారం లేదు.</span>';

  document.getElementById("topicContent").scrollTop = 0;
}

/* =========================================================
   NAVIGATION: go to a sloka by row index
   ---------------------------------------------------------
   save=true  -> this becomes the new bookmark (normal reading)
   save=false -> just look at it; bookmark stays where it was
   animate    -> "next" | "prev" | null (page-flip on prev/next only)
========================================================= */
function goToIndex(i, opts = {}) {
  const { save = true, animate = null } = opts;
  if (i < 0 || i >= state.rows.length) return;

  const apply = () => {
    state.currentIndex = i;
    const row = state.rows[i];
    renderSloka(row);
    renderTopicContent();
    updatePrevNextState();
    highlightCurrentInTree();

    if (save) {
      state.bookmarkIndex = i;
      savePosition(row);
      exitSearchNav({ silent: true });
    } else {
      updateLastReadNote(state.rows[state.bookmarkIndex] || row);
    }
  };

  if (animate) flipSlokaPanel(animate, apply);
  else apply();
}

function updatePrevNextState() {
  document.getElementById("prevBtn").disabled = state.currentIndex <= 0;
  document.getElementById("nextBtn").disabled = state.currentIndex >= state.rows.length - 1;
}

/* =========================================================
   SWIPE between topics (touch)
========================================================= */
function wireSwipe() {
  const el = document.getElementById("topicContent");
  let startX = 0, startY = 0, tracking = false;

  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // not a horizontal swipe

    const idx = TOPICS.findIndex((t) => t.key === state.currentTopicKey);
    if (dx < 0 && idx < TOPICS.length - 1) selectTopic(TOPICS[idx + 1].key); // swipe left -> next
    if (dx > 0 && idx > 0) selectTopic(TOPICS[idx - 1].key);                 // swipe right -> prev
  }, { passive: true });
}

/* =========================================================
   STATIC UI WIRING
========================================================= */
function wireStaticUI() {
  document.getElementById("prevBtn").addEventListener("click", () => {
    goToIndex(state.currentIndex - 1, { save: !state.searchNavActive, animate: "prev" });
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    goToIndex(state.currentIndex + 1, { save: !state.searchNavActive, animate: "next" });
  });
  document.getElementById("homeBtn").addEventListener("click", openMenu);

  document.getElementById("menuCloseBtn").addEventListener("click", closeMenu);
  document.getElementById("menuOverlay").addEventListener("click", closeMenu);

  document.getElementById("fontIncBtn").addEventListener("click", () => setFontScale(state.fontScale + 0.1));
  document.getElementById("fontDecBtn").addEventListener("click", () => setFontScale(state.fontScale - 0.1));

  document.getElementById("searchToggleBtn").addEventListener("click", openSearch);
  document.getElementById("searchCloseBtn").addEventListener("click", closeSearchPanel);
  document.getElementById("searchClearBtn").addEventListener("click", clearSearch);
  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    toggleClearBtn();
    runSearch(state.searchQuery);
  });

  document.getElementById("searchNavBanner").addEventListener("click", () => exitSearchNav());

  wireSwipe();
}

function openMenu() {
  document.getElementById("sideMenu").classList.add("open");
  document.getElementById("menuOverlay").classList.add("open");
}
function closeMenu() {
  document.getElementById("sideMenu").classList.remove("open");
  document.getElementById("menuOverlay").classList.remove("open");
}

function setFontScale(v) {
  state.fontScale = Math.min(1.6, Math.max(0.8, Math.round(v * 10) / 10));
  applyFontScale();
  saveFontScale();
}
function applyFontScale() {
  document.documentElement.style.setProperty("--sloka-scale", String(state.fontScale));
  document.getElementById("fontSizeLabel").textContent = Math.round(state.fontScale * 100) + "%";
}

/* =========================================================
   SIDE MENU: Sarga -> Sloka accordion tree
========================================================= */
function renderSargaTree() {
  const root = document.getElementById("sargaTree");
  root.innerHTML = "";

  const currentRow = state.rows[state.currentIndex];
  if (currentRow) state.expandedSargas.add(currentRow.sargaNo);

  state.sargaTree.forEach((sarga) => {
    const wrap = document.createElement("div");
    wrap.className = "sarga-node";

    const header = document.createElement("button");
    header.className = "sarga-node-header";
    header.dataset.sargaNo = String(sarga.sargaNo);
    const expanded = state.expandedSargas.has(sarga.sargaNo);
    header.innerHTML = `
      <span class="sarga-node-caret ${expanded ? "open" : ""}">&#9656;</span>
      <span class="sarga-node-title">${sarga.sarga}</span>
      <span class="sarga-node-count">${sarga.slokas.length}</span>`;
    header.addEventListener("click", () => toggleSargaNode(sarga.sargaNo));
    wrap.appendChild(header);

    const list = document.createElement("div");
    list.className = "sloka-list" + (expanded ? " open" : "");
    list.dataset.sargaNo = String(sarga.sargaNo);
    sarga.slokas.forEach((s) => {
      const item = document.createElement("button");
      item.className = "sloka-item" + (currentRow && s.idx === currentRow.idx ? " active" : "");
      item.dataset.idx = String(s.idx);
      item.innerHTML = `<span class="sloka-item-no">${s.slokamNo}</span><span class="sloka-item-word">${escapeHtml(s.firstWord)}</span>`;
      item.addEventListener("click", () => {
        goToIndex(s.idx, { save: true });
        closeMenu();
      });
      list.appendChild(item);
    });
    wrap.appendChild(list);
    root.appendChild(wrap);
  });
}

function toggleSargaNode(sargaNo) {
  if (state.expandedSargas.has(sargaNo)) state.expandedSargas.delete(sargaNo);
  else state.expandedSargas.add(sargaNo);

  const header = document.querySelector(`.sarga-node-header[data-sarga-no="${sargaNo}"]`);
  const list = document.querySelector(`.sloka-list[data-sarga-no="${sargaNo}"]`);
  if (header) header.querySelector(".sarga-node-caret").classList.toggle("open");
  if (list) list.classList.toggle("open");
}

function highlightCurrentInTree() {
  const row = state.rows[state.currentIndex];
  if (!row) return;
  document.querySelectorAll(".sloka-item.active").forEach((el) => el.classList.remove("active"));
  const el = document.querySelector(`.sloka-item[data-idx="${row.idx}"]`);
  if (el) el.classList.add("active");
}

/* =========================================================
   SEARCH (Slokam + Padavibhaga, word-split, Telugu Unicode)
========================================================= */
function normalize(s) {
  return (s || "").normalize("NFC").toLowerCase();
}

// Telugu-aware "word" split: break on whitespace and common
// punctuation/danda marks, keep Telugu letters + matras together.
function tokenize(s) {
  return normalize(s)
    .split(/[\s.,!?;:()\-|॥।"'\u0964\u0965]+/)
    .filter(Boolean);
}

function buildWordIndex() {
  const index = new Map();
  state.rows.forEach((row) => {
    const words = new Set([...tokenize(row.slokam), ...tokenize(row.padavibhaga)]);
    words.forEach((w) => {
      if (!index.has(w)) index.set(w, new Set());
      index.get(w).add(row.idx);
    });
  });
  state.wordIndex = index;
}

function runSearch(query) {
  const resultsEl = document.getElementById("searchResults");
  const qWords = tokenize(query);
  if (!qWords.length) {
    resultsEl.innerHTML = '<div class="search-empty">తెలుగు పదం టైప్ చేయండి</div>';
    return;
  }

  // For each query word, find indexed words containing it as a substring
  // (handles partial/compound Telugu word matches), then intersect rows
  // across all query words — searches the ENTIRE dataset, not just the
  // current sarga.
  let matchSets = qWords.map((qw) => {
    const rows = new Set();
    for (const [word, rowSet] of state.wordIndex.entries()) {
      if (word.includes(qw)) rowSet.forEach((r) => rows.add(r));
    }
    return rows;
  });

  let combined = matchSets[0] || new Set();
  for (let i = 1; i < matchSets.length; i++) {
    combined = new Set([...combined].filter((r) => matchSets[i].has(r)));
  }

  const rowIndices = [...combined].sort((a, b) => a - b).slice(0, 60);
  if (!rowIndices.length) {
    resultsEl.innerHTML = '<div class="search-empty">ఫలితాలు లేవు</div>';
    return;
  }

  resultsEl.innerHTML = "";
  rowIndices.forEach((i) => {
    const row = state.rows[i];
    const snippet = highlightMatch(row.slokam.split("\n")[0] || "", qWords);
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.innerHTML = `
      <div class="search-result-meta">${row.sarga} · శ్లోకం ${row.slokamNo}</div>
      <div class="search-result-snippet">${snippet}</div>`;
    item.addEventListener("click", () => openSearchResult(row));
    resultsEl.appendChild(item);
  });
}

function openSearchResult(row) {
  state.searchNavActive = true;
  goToIndex(row.idx, { save: false });
  showSearchNavBanner();
  closeSearchPanel(); // hide the panel but keep the query/results intact for reopening
}

function showSearchNavBanner() {
  document.getElementById("searchNavBanner").hidden = false;
}
function hideSearchNavBanner() {
  document.getElementById("searchNavBanner").hidden = true;
}

function exitSearchNav({ silent = false } = {}) {
  if (!state.searchNavActive) return;
  state.searchNavActive = false;
  hideSearchNavBanner();
  if (!silent) goToIndex(state.bookmarkIndex, { save: false });
}

function highlightMatch(text, qWords) {
  let html = escapeHtml(text);
  qWords.forEach((qw) => {
    if (!qw) return;
    const re = new RegExp("(" + escapeRegExp(qw) + ")", "gi");
    html = html.replace(re, "<mark>$1</mark>");
  });
  return html;
}

function openSearch() {
  document.getElementById("searchBar").hidden = false;
  const input = document.getElementById("searchInput");
  input.value = state.searchQuery;
  toggleClearBtn();
  input.focus();
  if (state.searchQuery) runSearch(state.searchQuery);
  else document.getElementById("searchResults").innerHTML = "";
}
function closeSearchPanel() {
  document.getElementById("searchBar").hidden = true; // query + results are kept
}
function clearSearch() {
  state.searchQuery = "";
  document.getElementById("searchInput").value = "";
  document.getElementById("searchResults").innerHTML = "";
  toggleClearBtn();
  document.getElementById("searchInput").focus();
}
function toggleClearBtn() {
  document.getElementById("searchClearBtn").hidden = !state.searchQuery;
}

/* =========================================================
   HELPERS
========================================================= */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================================================
   SERVICE WORKER
========================================================= */
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW register failed", e));
    });
  }
}

/* =========================================================
   ICONS (inline SVG strings, generic glyphs per topic)
========================================================= */
function iconSplit() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M14 4l-1.4 1.4L15.2 8H12a5 5 0 00-4 2l-1.5 2-2-2.7L3 11l3 4-3 4 1.5 1.3 2-2.7 1.5 2A5 5 0 0012 21h3.2l-2.6 2.6L14 25l5-5-5-5 1.4 1.4L12.6 20H12a3 3 0 01-2.4-1.2l-1.9-2.5 1.9-2.6A3 3 0 0112 12h3.2l-2.6 2.6L14 16l5-5z"/></svg>`;
}
function iconOrder() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 3L5 7h3v10H6l4 4 4-4h-2V7h3zM19 3l-4 4h3v10h-3l4 4 4-4h-3V7h3z" transform="translate(-2 0) scale(0.9)"/></svg>`;
}
function iconAkanksha() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm.9 15.5h-1.8v-1.8h1.8zm1.86-7.1c-.46.66-.9 1-1.44 1.42-.56.44-.82.86-.82 1.68h-1.8c0-1.24.5-1.8 1.1-2.3.44-.36.7-.6.86-.86.2-.3.3-.6.3-.94 0-.9-.62-1.5-1.6-1.5-.86 0-1.5.5-1.7 1.4l-1.68-.4C8.1 7.4 9.3 6.4 11.4 6.4c1.9 0 3.3 1.16 3.3 2.86 0 .78-.28 1.4-.94 2.14z"/></svg>`;
}
function iconBhava() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 21s-7.1-4.35-9.6-8.9C.9 8.7 2.4 5 6 5c2 0 3.4 1.1 4 2.2C10.6 6.1 12 5 14 5c3.6 0 5.1 3.7 3.6 7.1C19.1 16.65 12 21 12 21z"/></svg>`;
}
function iconGrammar() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 4h9a3 3 0 013 3v13H7a3 3 0 01-3-3V4zm2 2v11a1 1 0 001 1h8V7a1 1 0 00-1-1H6zm2 3h6v1.5H8zm0 3h6V13H8z"/></svg>`;
}
function iconOthers() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
}
