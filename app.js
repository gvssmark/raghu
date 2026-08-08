(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. DATA — normalize whatever came in (external raghu.json
        defines global `raghu` as [header, ...rows]; fallback is
        the same shape, embedded so the app always works offline).
  --------------------------------------------------------- */
  function normalizeData() {
    var src = (typeof raghu !== 'undefined' && !window.__raghuExternalFailed) ? raghu : RAGHU_FALLBACK;
    if (!src || !src.length) return [];
    if (Array.isArray(src[0])) {
      var header = src[0];
      return src.slice(1).map(function (row) {
        var obj = {};
        header.forEach(function (key, i) { obj[key] = row[i]; });
        return obj;
      });
    }
    return src;
  }

  var VERSES = normalizeData();
  VERSES.sort(function (a, b) { return (a.SargaNo - b.SargaNo) || (a.SlokamNo - b.SlokamNo); });

  var TOPICS = [
    { key: 'Padavibhaga', te: 'పదవిభాగ',  glyph: 'ప',    color: '#8C1F28' },
    { key: 'Anvyaya',     te: 'అన్వయ',    glyph: 'అ',    color: '#1E3A5F' },
    { key: 'Akanksha',    te: 'ఆకాంక్ష',  glyph: 'ఆ',    color: '#B8862E' },
    { key: 'Bhava',       te: 'భావ',      glyph: 'భా',   color: '#6B3FA0' },
    { key: 'Vyakarana',   te: 'వ్యాకరణ', glyph: 'వ్యా', color: '#2E7D5B' },
    { key: 'Others',      te: 'ఇతర',      glyph: 'ఇ',    color: '#6B6255' }
  ];

  /* ---------------------------------------------------------
     2. STATE (persisted in localStorage)
  --------------------------------------------------------- */
  var LS = {
    fontSize: 'raghu_fontSize',
    primaryBookmark: 'raghu_primaryBookmark', // {sargaNo, slokamNo} — set ONLY by Previous/Next
    saved: 'raghu_savedBookmarks',            // array of {sargaNo, slokamNo} — the starred list
    lastTopic: 'raghu_lastTopic'
  };

  var state = {
    index: 0,
    topicIndex: 2,                 // default = Akanksha
    fontSize: parseInt(localStorage.getItem(LS.fontSize) || '26', 10),
    highlightQuery: null,          // set when arriving via a search result
    searchMode: false              // true after a search jump; Prev/Next won't touch the bookmark while true
  };

  function clearHighlight() { state.highlightQuery = null; }

  function highlightLine(rawLine) {
    if (!state.highlightQuery) return escapeHtml(rawLine);
    var q = state.highlightQuery;
    var lowerLine = rawLine.toLowerCase(), lowerQ = q.toLowerCase();
    var result = '', i = 0, idx;
    while (true) {
      idx = lowerLine.indexOf(lowerQ, i);
      if (idx === -1) { result += escapeHtml(rawLine.slice(i)); break; }
      result += escapeHtml(rawLine.slice(i, idx));
      result += '<mark class="hl">' + escapeHtml(rawLine.slice(idx, idx + q.length)) + '</mark>';
      i = idx + q.length;
    }
    return result;
  }

  function findIndex(sargaNo, slokamNo) {
    for (var i = 0; i < VERSES.length; i++) {
      if (VERSES[i].SargaNo === sargaNo && VERSES[i].SlokamNo === slokamNo) return i;
    }
    return -1;
  }

  /* ---- primary bookmark (set only by Previous/Next, per spec) ---- */
  function getPrimaryBookmark() {
    try { return JSON.parse(localStorage.getItem(LS.primaryBookmark) || 'null'); } catch (e) { return null; }
  }
  function setPrimaryBookmark(v) {
    localStorage.setItem(LS.primaryBookmark, JSON.stringify({ sargaNo: v.SargaNo, slokamNo: v.SlokamNo }));
  }

  /* ---- starred / marked-slokas list (independent of the primary bookmark) ---- */
  function getSavedBookmarks() {
    try { return JSON.parse(localStorage.getItem(LS.saved) || '[]'); } catch (e) { return []; }
  }
  function setSavedBookmarks(arr) { localStorage.setItem(LS.saved, JSON.stringify(arr)); }
  function isSaved(v) {
    return getSavedBookmarks().some(function (b) { return b.sargaNo === v.SargaNo && b.slokamNo === v.SlokamNo; });
  }

  /* ---------------------------------------------------------
     3. RENDER
  --------------------------------------------------------- */
  var slokaText = document.getElementById('slokaText');
  var slokaRef = document.getElementById('slokaRef');
  var starBtn = document.getElementById('starBtn');
  var topicRow = document.getElementById('topicRow');
  var contentInner = document.getElementById('contentInner');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var bookmarkBanner = document.getElementById('bookmarkBanner');

  function renderTopicRow() {
    topicRow.innerHTML = '';
    TOPICS.forEach(function (t, i) {
      var btn = document.createElement('button');
      btn.className = 'topic-btn' + (i === state.topicIndex ? ' active' : '');
      btn.style.setProperty('--topic-color', t.color);
      btn.innerHTML = '<span class="topic-glyph">' + t.glyph + '</span><span class="label-te">' + t.te + '</span>';
      btn.addEventListener('click', function () { clearHighlight(); setTopic(i); });
      topicRow.appendChild(btn);
    });
  }

  function renderSloka() {
    var v = VERSES[state.index];
    if (!v) { slokaText.innerHTML = '<div class="content-empty">No data loaded.</div>'; return; }
    var lines = String(v.Slokam || '').split('\n').filter(function (l) { return l.trim().length; });
    slokaText.innerHTML = lines.map(function (line, i) {
      var cls = (i % 2 === 0) ? 'line-a' : 'line-b';
      return '<div class="sloka-line ' + cls + '">' + highlightLine(line.trim()) + '</div>';
    }).join('');
    document.documentElement.style.setProperty('--sloka-font-size', state.fontSize + 'px');
    slokaRef.innerHTML = 'Sarga <b>' + v.SargaNo + '</b> &middot; Verse <b>' + v.SlokamNo + '</b>';
    starBtn.classList.toggle('saved', isSaved(v));
    bookmarkBanner.hidden = !state.searchMode;
  }

  function renderContent() {
    var v = VERSES[state.index];
    var topic = TOPICS[state.topicIndex];
    var text = v ? (v[topic.key] || '') : '';
    contentInner.style.animation = 'none';
    void contentInner.offsetWidth;
    contentInner.style.animation = '';
    if (!text || !String(text).trim().length) {
      contentInner.innerHTML = '<div class="content-empty">(ఈ శ్లోకమునకు ' + topic.te + ' లేదు)</div>';
      return;
    }
    if (topic.key === 'Akanksha') {
      var lines = String(text).split('\n').filter(function (l) { return l.trim().length; });
      contentInner.innerHTML = lines.map(function (line, i) {
        var cls = (i % 2 === 0) ? 'line-a' : 'line-b';
        return '<div class="content-line ' + cls + '">' + highlightLine(line.trim()) + '</div>';
      }).join('');
    } else {
      contentInner.innerHTML = highlightLine(String(text).trim());
    }
  }

  function renderNav() {
    prevBtn.disabled = state.index <= 0;
    nextBtn.disabled = state.index >= VERSES.length - 1;
  }

  function renderAll() {
    renderTopicRow();
    renderSloka();
    renderContent();
    renderNav();
  }

  function setTopic(i) {
    state.topicIndex = ((i % TOPICS.length) + TOPICS.length) % TOPICS.length;
    localStorage.setItem(LS.lastTopic, state.topicIndex);
    renderTopicRow();
    renderContent();
  }

  function goTo(i, resetTopic) {
    if (i < 0 || i >= VERSES.length) return;
    state.index = i;
    if (resetTopic !== false) state.topicIndex = 2; // default back to Akanksha on verse change
    renderAll();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ---------------------------------------------------------
     4. FOOTER: PREVIOUS / MENU / NEXT
     Previous & Next are the PRIMARY bookmark setters (per spec) —
     every tap updates the stored bookmark UNLESS the reader is
     currently exploring a search result (searchMode), in which
     case browsing must not disturb the real bookmark.
  --------------------------------------------------------- */
  function stepAndBookmark(delta) {
    clearHighlight();
    var newIndex = state.index + delta;
    if (newIndex < 0 || newIndex >= VERSES.length) return;
    goTo(newIndex);
    if (!state.searchMode) setPrimaryBookmark(VERSES[state.index]);
  }
  prevBtn.addEventListener('click', function () { stepAndBookmark(-1); });
  nextBtn.addEventListener('click', function () { stepAndBookmark(1); });

  document.getElementById('backToBookmarkBtn').addEventListener('click', function () {
    state.searchMode = false;
    clearHighlight();
    var bm = getPrimaryBookmark();
    if (bm) {
      var i = findIndex(bm.sargaNo, bm.slokamNo);
      if (i >= 0) goTo(i);
    }
    renderSloka(); // hides the banner
  });

  /* ---------------------------------------------------------
     5. STAR (marked-slokas list) — independent of the primary bookmark
  --------------------------------------------------------- */
  starBtn.addEventListener('click', function () {
    var v = VERSES[state.index];
    if (!v) return;
    var list = getSavedBookmarks();
    var idx = list.findIndex(function (b) { return b.sargaNo === v.SargaNo && b.slokamNo === v.SlokamNo; });
    if (idx >= 0) { list.splice(idx, 1); showToast('Bookmark removed'); }
    else { list.push({ sargaNo: v.SargaNo, slokamNo: v.SlokamNo }); showToast('Verse saved to bookmarks'); }
    setSavedBookmarks(list);
    starBtn.classList.toggle('saved', isSaved(v));
    renderMenuBookmarkList();
  });

  /* ---------------------------------------------------------
     6. SWIPE BETWEEN TOPICS (on content panel)
  --------------------------------------------------------- */
  var contentPanel = document.getElementById('contentPanel');
  var touchStartX = 0, touchStartY = 0, touching = false;

  contentPanel.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; touching = true;
  }, { passive: true });

  contentPanel.addEventListener('touchend', function (e) {
    if (!touching) return;
    touching = false;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      clearHighlight();
      if (dx < 0) setTopic(state.topicIndex + 1);
      else setTopic(state.topicIndex - 1);
    }
  }, { passive: true });

  /* ---------------------------------------------------------
     7. FONT SIZE CONTROL (lives in the hamburger menu)
  --------------------------------------------------------- */
  function applyFontSize() {
    state.fontSize = Math.max(16, Math.min(44, state.fontSize));
    document.documentElement.style.setProperty('--sloka-font-size', state.fontSize + 'px');
    localStorage.setItem(LS.fontSize, state.fontSize);
  }
  document.getElementById('mFontInc').addEventListener('click', function () { state.fontSize += 2; applyFontSize(); });
  document.getElementById('mFontDec').addEventListener('click', function () { state.fontSize -= 2; applyFontSize(); });
  document.getElementById('mFontReset').addEventListener('click', function () { state.fontSize = 26; applyFontSize(); });

  /* ---------------------------------------------------------
     8. SEARCH (persists term/results until cleared; navigating
        via a result never touches the primary bookmark; lands on
        the matched commentary tab and highlights the term there)
  --------------------------------------------------------- */
  var searchOverlay = document.getElementById('searchOverlay');
  var searchInput = document.getElementById('searchInput');
  var searchResults = document.getElementById('searchResults');
  var SEARCH_FIELDS = ['Slokam', 'Padavibhaga', 'Anvyaya', 'Akanksha', 'Bhava', 'Vyakarana', 'Others'];

  document.getElementById('searchOpenBtn').addEventListener('click', function () {
    searchOverlay.classList.add('open');
    setTimeout(function () { searchInput.focus(); }, 50);
  });
  document.getElementById('searchCloseBtn').addEventListener('click', function () { searchOverlay.classList.remove('open'); });
  searchOverlay.addEventListener('click', function (e) { if (e.target === searchOverlay) searchOverlay.classList.remove('open'); });

  function normalizeTelugu(s) { return (s || '').toString().replace(/\s+/g, ' ').trim(); }

  var searchDebounce = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 120);
  });

  function runSearch() {
    var q = normalizeTelugu(searchInput.value);
    if (!q) { searchResults.innerHTML = ''; return; }
    var qLower = q.toLowerCase();
    var hits = [];
    for (var i = 0; i < VERSES.length && hits.length < 40; i++) {
      var v = VERSES[i];
      for (var f = 0; f < SEARCH_FIELDS.length; f++) {
        var field = SEARCH_FIELDS[f];
        var val = v[field];
        if (!val) continue;
        var hay = normalizeTelugu(val);
        if (hay.toLowerCase().indexOf(qLower) !== -1 || hay.indexOf(q) !== -1) {
          hits.push({ index: i, field: field, snippet: buildSnippet(hay, q) });
          break;
        }
      }
    }
    if (!hits.length) { searchResults.innerHTML = '<div class="search-empty">No matches found.</div>'; return; }
    searchResults.innerHTML = hits.map(function (h) {
      var v = VERSES[h.index];
      return '<div class="search-result" data-i="' + h.index + '" data-field="' + h.field + '">' +
        '<div class="meta">Sarga ' + v.SargaNo + ' &middot; Verse ' + v.SlokamNo + ' &middot; ' + h.field + '</div>' +
        '<div class="snippet">' + h.snippet + '</div></div>';
    }).join('');
  }

  function buildSnippet(hay, q) {
    var idx = hay.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) idx = hay.indexOf(q);
    if (idx === -1) return escapeHtml(hay.slice(0, 70)) + '…';
    var start = Math.max(0, idx - 30);
    var end = Math.min(hay.length, idx + q.length + 40);
    var pre = (start > 0 ? '…' : '') + escapeHtml(hay.slice(start, idx));
    var mid = '<mark>' + escapeHtml(hay.slice(idx, idx + q.length)) + '</mark>';
    var post = escapeHtml(hay.slice(idx + q.length, end)) + (end < hay.length ? '…' : '');
    return pre + mid + post;
  }

  searchResults.addEventListener('click', function (e) {
    var item = e.target.closest('.search-result');
    if (!item) return;
    var idx = parseInt(item.getAttribute('data-i'), 10);
    var field = item.getAttribute('data-field');
    var q = normalizeTelugu(searchInput.value);

    state.searchMode = true;         // Prev/Next won't touch the primary bookmark until "back to bookmark"
    state.highlightQuery = q;        // shown at the destination until the next explicit navigation
    goTo(idx, false);                // never touches the primary bookmark

    var topicIdx = -1;
    for (var t = 0; t < TOPICS.length; t++) { if (TOPICS[t].key === field) { topicIdx = t; break; } }
    setTopic(topicIdx >= 0 ? topicIdx : 2);

    searchOverlay.classList.remove('open');
  });

  /* ---------------------------------------------------------
     9. HAMBURGER MENU (opened via footer "Menu"/Home button)
  --------------------------------------------------------- */
  var menuBackdrop = document.getElementById('menuBackdrop');
  var menuDrawer = document.getElementById('menuDrawer');
  var homeBtn = document.getElementById('homeBtn');

  function openMenu() {
    renderMenuBookmarkList();
    renderMenuSargaList();
    menuBackdrop.classList.add('open');
    menuDrawer.classList.add('open');
  }
  function closeMenu() {
    menuBackdrop.classList.remove('open');
    menuDrawer.classList.remove('open');
  }
  homeBtn.addEventListener('click', openMenu);
  document.getElementById('menuCloseBtn').addEventListener('click', closeMenu);
  menuBackdrop.addEventListener('click', closeMenu);

  function renderMenuBookmarkList() {
    var el = document.getElementById('menuBookmarkList');
    var list = getSavedBookmarks();
    if (!list.length) {
      el.innerHTML = '<div class="menu-empty">గుర్తు పెట్టిన శ్లోకాలు లేవు — శ్లోకం పైన ★ నొక్కండి.</div>';
      return;
    }
    el.innerHTML = list.map(function (b, i) {
      var v = VERSES[findIndex(b.sargaNo, b.slokamNo)];
      var snip = v ? String(v.Slokam || '').split('\n')[0] : '';
      return '<div class="bm-row" data-i="' + i + '">' +
        '<div><div class="bm-ref">సర్గ ' + b.sargaNo + ' &middot; శ్లోకం ' + b.slokamNo + '</div>' +
        '<div class="bm-snip">' + escapeHtml(snip) + '</div></div>' +
        '<button class="bm-remove" data-remove="' + i + '">✕</button></div>';
    }).join('');
    el.onclick = function (e) {
      var removeIdx = e.target.getAttribute('data-remove');
      if (removeIdx !== null) {
        var arr = getSavedBookmarks();
        arr.splice(parseInt(removeIdx, 10), 1);
        setSavedBookmarks(arr);
        renderMenuBookmarkList();
        var cur = VERSES[state.index];
        if (cur) starBtn.classList.toggle('saved', isSaved(cur));
        return;
      }
      var row = e.target.closest('.bm-row');
      if (row) {
        var arr2 = getSavedBookmarks();
        var b = arr2[parseInt(row.getAttribute('data-i'), 10)];
        var i = findIndex(b.sargaNo, b.slokamNo);
        if (i >= 0) { clearHighlight(); state.searchMode = false; goTo(i); closeMenu(); }
      }
    };
  }

  function renderMenuSargaList() {
    var el = document.getElementById('menuSargaList');
    // Group by unique Sarga name (Element 0 in the source data), preserving first-seen order.
    var groups = [];
    var groupIndexByName = {};
    VERSES.forEach(function (v, i) {
      var name = v.Sarga;
      if (!(name in groupIndexByName)) {
        groupIndexByName[name] = groups.length;
        groups.push({ name: name, items: [] });
      }
      groups[groupIndexByName[name]].items.push(i);
    });

    el.innerHTML = groups.map(function (g, gi) {
      var rows = g.items.map(function (vIdx) {
        var v = VERSES[vIdx];
        var firstLine = String(v.Slokam || '').split('\n')[0] || '';
        var firstWord = firstLine.trim().split(/\s+/)[0] || '';
        var cur = vIdx === state.index ? ' current' : '';
        return '<button class="sloka-item' + cur + '" data-i="' + vIdx + '">' +
          '<span class="snum">' + v.SlokamNo + '.</span><span>' + escapeHtml(firstWord) + '</span></button>';
      }).join('');
      return '<div class="sarga-group">' +
        '<button class="sarga-header" data-g="' + gi + '"><span>' + escapeHtml(g.name) +
        ' <span class="count">(' + g.items.length + ')</span></span><span class="chev">›</span></button>' +
        '<div class="sarga-slokas" id="sargaGroup' + gi + '" hidden>' + rows + '</div></div>';
    }).join('');

    el.onclick = function (e) {
      var header = e.target.closest('.sarga-header');
      if (header) {
        var gi = header.getAttribute('data-g');
        var body = document.getElementById('sargaGroup' + gi);
        var expanded = header.classList.toggle('expanded');
        body.hidden = !expanded;
        return;
      }
      var item = e.target.closest('.sloka-item');
      if (item) {
        var idx = parseInt(item.getAttribute('data-i'), 10);
        clearHighlight();
        state.searchMode = false;
        goTo(idx);
        closeMenu();
      }
    };
  }

  /* ---------------------------------------------------------
     10. TOAST
  --------------------------------------------------------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  /* ---------------------------------------------------------
     11. PWA — register service worker
  --------------------------------------------------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline support unavailable; app still works online */ });
    });
  }

  /* ---------------------------------------------------------
     12. INIT
  --------------------------------------------------------- */
  function init() {
    if (!VERSES.length) {
      slokaText.innerHTML = '<div class="content-empty">No verses loaded.</div>';
      return;
    }
    var bm = getPrimaryBookmark();
    var startIndex = 0;
    if (bm) {
      var i = findIndex(bm.sargaNo, bm.slokamNo);
      if (i >= 0) startIndex = i;
    } else {
      // First-ever visit: establish the primary bookmark at the starting verse.
      setPrimaryBookmark(VERSES[startIndex]);
    }
    var savedTopic = parseInt(localStorage.getItem(LS.lastTopic), 10);
    state.topicIndex = (savedTopic >= 0 && savedTopic < TOPICS.length) ? savedTopic : 2;
    goTo(startIndex, false);
    applyFontSize();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 30);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 30); });
  }
})();
