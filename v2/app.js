"use strict";

/* =========================================================
   CONFIG
   ---------------------------------------------------------
   DATA_URL points at the test dataset for now. Once the real
   raghu.json lives inside this repo, change this to a local
   relative path (e.g. "./data/raghu.json") so the PWA can
   fully cache it offline without depending on another origin.
========================================================= */
const DATA_URL = "https://gvssmark.github.io/raghu/raghu.json";
const DB_NAME = "raghu-db";
const DB_VERSION = 1;
const STORE_ROWS = "rows";
const STORE_META = "meta";

const TOPICS = [
  { key: "padavibhaga", col: 4, label: "Padavibhaga", icon: iconSplit() },
  { key: "anvyaya",     col: 5, label: "Anvyaya",     icon: iconOrder() },
  { key: "akanksha",    col: 6, label: "Akanksha",    icon: iconAkanksha(), joinLineBreaks: true },
  { key: "bhava",       col: 7, label: "Bhava",       icon: iconBhava() },
  { key: "vyakarana",   col: 8, label: "Vyakarana",   icon: iconGrammar() },
  { key: "others",      col: 9, label: "Others",      icon: iconOthers() },
];
const DEFAULT_TOPIC_KEY = "akanksha";

/* =========================================================
   STATE
========================================================= */
const state = {
  rows: [],          // flat array of sloka objects, in file order
  sargaList: [],      // [{sarga, sargaNo, firstIndex}]
  currentIndex: 0,    // index into state.rows
  currentTopicKey: DEFAULT_TOPIC_KEY,
  fontScale: 1,
  wordIndex: null,    // Map<word, Set<rowIndex>>  (built from Slokam + Padavibhaga)
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
      afterDataReady({ fromCache: true });
      refreshFromNetwork(); // update silently in background
    } else {
      const rows = await fetchAndParseData();
      state.rows = rows;
      await idbPutAllRows(rows);
      afterDataReady({ fromCache: false });
    }
  } catch (err) {
    console.error("Data load failed", err);
    document.getElementById("slokaLines").innerHTML =
      '<p class="sloka-loading">డేటా లోడ్ కాలేదు. ఇంటర్నెట్ తనిఖీ చేయండి.</p>';
  }
}

async function refreshFromNetwork() {
  try {
    const rows = await fetchAndParseData();
    // only replace if actually different in length (cheap heuristic)
    if (rows.length !== state.rows.length) {
      state.rows = rows;
      await idbPutAllRows(rows);
      buildSargaList();
      buildWordIndex();
      populateSargaSelect();
    }
  } catch (_) {
    /* offline — silently keep using cache */
  }
}

function afterDataReady() {
  buildSargaList();
  buildWordIndex();
  populateSargaSelect();

  const savedIndex = getSavedPositionIndex();
  goToIndex(savedIndex != null ? savedIndex : 0, { save: false });
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
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
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

  let text = row[topic.key] || "";
  text = text.trim();

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
========================================================= */
function goToIndex(i, { save = true } = {}) {
  if (i < 0 || i >= state.rows.length) return;
  state.currentIndex = i;
  const row = state.rows[i];
  renderSloka(row);
  renderTopicContent();
  updatePrevNextState();
  if (save) savePosition(row);
  else updateLastReadNote(row);
  document.getElementById("sargaSelect").value = String(row.sargaNo);
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
  document.getElementById("prevBtn").addEventListener("click", () => goToIndex(state.currentIndex - 1));
  document.getElementById("nextBtn").addEventListener("click", () => goToIndex(state.currentIndex + 1));
  document.getElementById("homeBtn").addEventListener("click", openMenu);

  document.getElementById("menuCloseBtn").addEventListener("click", closeMenu);
  document.getElementById("menuOverlay").addEventListener("click", closeMenu);

  document.getElementById("sargaSelect").addEventListener("change", (e) => {
    const sargaNo = Number(e.target.value);
    const entry = state.sargaList.find((s) => s.sargaNo === sargaNo);
    if (entry) { goToIndex(entry.firstIndex); closeMenu(); }
  });

  document.getElementById("fontIncBtn").addEventListener("click", () => setFontScale(state.fontScale + 0.1));
  document.getElementById("fontDecBtn").addEventListener("click", () => setFontScale(state.fontScale - 0.1));

  document.getElementById("searchToggleBtn").addEventListener("click", openSearch);
  document.getElementById("searchCloseBtn").addEventListener("click", closeSearch);
  document.getElementById("searchInput").addEventListener("input", (e) => runSearch(e.target.value));

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

function populateSargaSelect() {
  const sel = document.getElementById("sargaSelect");
  sel.innerHTML = "";
  state.sargaList.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s.sargaNo);
    opt.textContent = s.sarga;
    sel.appendChild(opt);
  });
  const row = state.rows[state.currentIndex];
  if (row) sel.value = String(row.sargaNo);
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
  // across all query words.
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

  const rowIndices = [...combined].sort((a, b) => a - b).slice(0, 40);
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
    item.addEventListener("click", () => {
      goToIndex(row.idx);
      closeSearch();
    });
    resultsEl.appendChild(item);
  });
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
  document.getElementById("searchInput").value = "";
  document.getElementById("searchResults").innerHTML = "";
  document.getElementById("searchInput").focus();
}
function closeSearch() {
  document.getElementById("searchBar").hidden = true;
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
