(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. DATA — normalize whatever came in (external raghu.js
        defines `raghu` as [header, ...rows]; fallback is
        already an array of objects).
  --------------------------------------------------------- */
  function normalizeData() {
    var src = RAGHU_FALLBACK;
    if (!src || !src.length) return [];
    // If it's the [header, ...rows] array-of-arrays shape (raw raghu.json), convert to objects.
    if (Array.isArray(src[0])) {
      var header = src[0];
      return src.slice(1).map(function (row) {
        var obj = {};
        header.forEach(function (key, i) { obj[key] = row[i]; });
        return obj;
      });
    }
    // Already array of objects.
    return src;
  }

  var VERSES = normalizeData();

  // Sort by SargaNo then SlokamNo so prev/next is well-ordered even if source isn't sorted.
  VERSES.sort(function (a, b) {
    return (a.SargaNo - b.SargaNo) || (a.SlokamNo - b.SlokamNo);
  });

  var TOPICS = [
    { key: 'Padavibhaga', te: 'పదవిభాగ',  color: '#8C1F28', icon: iconSplit() },
    { key: 'Anvyaya',     te: 'అన్వయ',    color: '#1E3A5F', icon: iconFlow() },
    { key: 'Akanksha',    te: 'ఆకాంక్ష',  color: '#B8862E', icon: iconQuestion() },
    { key: 'Bhava',       te: 'భావ',      color: '#6B3FA0', icon: iconLotus() },
    { key: 'Vyakarana',   te: 'వ్యాకరణ', color: '#2E7D5B', icon: iconGrammar() },
    { key: 'Others',      te: 'ఇతర',      color: '#6B6255', icon: iconMore() }
  ];

  /* ---------------------------------------------------------
     2. STATE (persisted in localStorage)
  --------------------------------------------------------- */
  var LS = {
    fontSize: 'raghu_fontSize',
    lastRead: 'raghu_lastRead',      // {sargaNo, slokamNo} — auto-tracked
    saved: 'raghu_savedBookmarks',   // array of {sargaNo, slokamNo}
    lastTopic: 'raghu_lastTopic'
  };

  var state = {
    index: 0,                 // current position in VERSES
    topicIndex: 2,            // default = Akanksha
    fontSize: parseInt(localStorage.getItem(LS.fontSize) || '26', 10)
  };

  function findIndex(sargaNo, slokamNo) {
    for (var i = 0; i < VERSES.length; i++) {
      if (VERSES[i].SargaNo === sargaNo && VERSES[i].SlokamNo === slokamNo) return i;
    }
    return -1;
  }

  function getSavedBookmarks() {
    try { return JSON.parse(localStorage.getItem(LS.saved) || '[]'); } catch (e) { return []; }
  }
  function setSavedBookmarks(arr) { localStorage.setItem(LS.saved, JSON.stringify(arr)); }

  function isSaved(v) {
    return getSavedBookmarks().some(function (b) { return b.sargaNo === v.SargaNo && b.slokamNo === v.SlokamNo; });
  }

  function setLastRead(v) {
    localStorage.setItem(LS.lastRead, JSON.stringify({ sargaNo: v.SargaNo, slokamNo: v.SlokamNo }));
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

  function renderTopicRow() {
    topicRow.innerHTML = '';
    TOPICS.forEach(function (t, i) {
      var btn = document.createElement('button');
      btn.className = 'topic-btn' + (i === state.topicIndex ? ' active' : '');
      btn.style.setProperty('--topic-color', t.color);
      btn.innerHTML = t.icon + '<span class="label-te">' + t.te + '</span>';
      btn.addEventListener('click', function () { setTopic(i); });
      topicRow.appendChild(btn);
    });
  }

  function renderSloka() {
    var v = VERSES[state.index];
    if (!v) {
      slokaText.innerHTML = '<div class="content-empty">No data loaded.</div>';
      return;
    }
    var lines = String(v.Slokam || '').split('\n').filter(function (l) { return l.trim().length; });
    slokaText.innerHTML = lines.map(function (line, i) {
      var cls = (i % 2 === 0) ? 'line-a' : 'line-b';
      return '<div class="sloka-line ' + cls + '">' + escapeHtml(line.trim()) + '</div>';
    }).join('');
    slokaText.style.setProperty('--x', '');
    document.documentElement.style.setProperty('--sloka-font-size', state.fontSize + 'px');

    slokaRef.innerHTML = 'Sarga <b>' + v.SargaNo + '</b> &middot; Verse <b>' + v.SlokamNo + '</b>';
    starBtn.classList.toggle('saved', isSaved(v));
    // Note: lastRead (the Home-button bookmark) is intentionally NOT updated here.
    // Browsing via Next/Previous/Search must never disturb the bookmark — it only
    // changes when the reader explicitly stars a verse (see starBtn handler below).
  }

  function renderContent() {
    var v = VERSES[state.index];
    var topic = TOPICS[state.topicIndex];
    var text = v ? (v[topic.key] || '') : '';
    contentInner.style.animation = 'none';
    void contentInner.offsetWidth; // restart fade-in animation
    contentInner.style.animation = '';
    if (!text || !String(text).trim().length) {
      contentInner.innerHTML = '<div class="content-empty">(ఈ శ్లోకమునకు ' + topic.te + ' లేదు)</div>';
      return;
    }
    if (topic.key === 'Akanksha') {
      // Akanksha is a Q&A-style breakdown, one point per line — alternate red/blue like the sloka.
      var lines = String(text).split('\n').filter(function (l) { return l.trim().length; });
      contentInner.innerHTML = lines.map(function (line, i) {
        var cls = (i % 2 === 0) ? 'line-a' : 'line-b';
        return '<div class="content-line ' + cls + '">' + escapeHtml(line.trim()) + '</div>';
      }).join('');
    } else {
      contentInner.innerHTML = escapeHtml(String(text).trim());
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
     4. FOOTER NAV + HOME (tap vs long-press) + STAR BOOKMARK
  --------------------------------------------------------- */
  prevBtn.addEventListener('click', function () { goTo(state.index - 1); });
  nextBtn.addEventListener('click', function () { goTo(state.index + 1); });

  var homeBtn = document.getElementById('homeBtn');
  var pressTimer = null, longPressed = false;

  homeBtn.addEventListener('pointerdown', function () {
    longPressed = false;
    pressTimer = setTimeout(function () {
      longPressed = true;
      openBookmarkDrawer();
    }, 500);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evt) {
    homeBtn.addEventListener(evt, function () { clearTimeout(pressTimer); });
  });
  homeBtn.addEventListener('click', function () {
    if (longPressed) { longPressed = false; return; } // drawer already opened
    goToLastRead();
  });

  function goToLastRead() {
    try {
      var lr = JSON.parse(localStorage.getItem(LS.lastRead) || 'null');
      if (lr) {
        var i = findIndex(lr.sargaNo, lr.slokamNo);
        if (i >= 0) { goTo(i); showToast('Back to your last-read verse'); return; }
      }
    } catch (e) {}
    goTo(0);
  }

  starBtn.addEventListener('click', function () {
    var v = VERSES[state.index];
    if (!v) return;
    var list = getSavedBookmarks();
    var idx = list.findIndex(function (b) { return b.sargaNo === v.SargaNo && b.slokamNo === v.SlokamNo; });
    if (idx >= 0) {
      list.splice(idx, 1);
      setSavedBookmarks(list);
      // If the verse we just un-starred was the active Home bookmark, fall back
      // to the most recently saved remaining bookmark (or clear it entirely).
      var lr = null;
      try { lr = JSON.parse(localStorage.getItem(LS.lastRead) || 'null'); } catch (e) {}
      if (lr && lr.sargaNo === v.SargaNo && lr.slokamNo === v.SlokamNo) {
        if (list.length) {
          var fallback = list[list.length - 1];
          localStorage.setItem(LS.lastRead, JSON.stringify(fallback));
        } else {
          localStorage.removeItem(LS.lastRead);
        }
      }
      showToast('Bookmark removed');
    } else {
      list.push({ sargaNo: v.SargaNo, slokamNo: v.SlokamNo });
      setSavedBookmarks(list);
      setLastRead(v); // starring a verse also sets it as the Home bookmark
      showToast('Verse saved to bookmarks');
    }
    starBtn.classList.toggle('saved', isSaved(v));
  });

  /* ---------------------------------------------------------
     5. BOOKMARK DRAWER (long-press Home)
  --------------------------------------------------------- */
  var bmDrawer = document.getElementById('bmDrawer');
  var bmList = document.getElementById('bmList');

  function openBookmarkDrawer() {
    var list = getSavedBookmarks();
    if (!list.length) {
      bmList.innerHTML = '<div class="bm-empty">No saved bookmarks yet. Tap the star above a verse to save it.</div>';
    } else {
      bmList.innerHTML = list.map(function (b, i) {
        var v = VERSES[findIndex(b.sargaNo, b.slokamNo)];
        var snip = v ? String(v.Slokam || '').split('\n')[0] : '';
        return '<div class="bm-item" data-i="' + i + '">' +
          '<div><div class="bm-ref">Sarga ' + b.sargaNo + ' &middot; Verse ' + b.slokamNo + '</div>' +
          '<div class="bm-snip">' + escapeHtml(snip) + '</div></div>' +
          '<button class="bm-remove" data-remove="' + i + '">✕</button></div>';
      }).join('');
    }
    bmDrawer.classList.add('open');
  }

  bmList.addEventListener('click', function (e) {
    var removeIdx = e.target.getAttribute('data-remove');
    if (removeIdx !== null) {
      var list = getSavedBookmarks();
      list.splice(parseInt(removeIdx, 10), 1);
      setSavedBookmarks(list);
      openBookmarkDrawer();
      return;
    }
    var item = e.target.closest('.bm-item');
    if (item) {
      var list2 = getSavedBookmarks();
      var b = list2[parseInt(item.getAttribute('data-i'), 10)];
      var i = findIndex(b.sargaNo, b.slokamNo);
      if (i >= 0) { goTo(i); closeBookmarkDrawer(); }
    }
  });
  document.getElementById('bmCloseBtn').addEventListener('click', closeBookmarkDrawer);
  bmDrawer.addEventListener('click', function (e) { if (e.target === bmDrawer) closeBookmarkDrawer(); });
  function closeBookmarkDrawer() { bmDrawer.classList.remove('open'); }

  /* ---------------------------------------------------------
     6. SWIPE BETWEEN TOPICS (on content panel)
  --------------------------------------------------------- */
  var contentPanel = document.getElementById('contentPanel');
  var touchStartX = 0, touchStartY = 0, touching = false;

  contentPanel.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touching = true;
  }, { passive: true });

  contentPanel.addEventListener('touchend', function (e) {
    if (!touching) return;
    touching = false;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) setTopic(state.topicIndex + 1); // swipe left -> next topic
      else setTopic(state.topicIndex - 1);        // swipe right -> prev topic
    }
  }, { passive: true });

  /* ---------------------------------------------------------
     7. FONT SIZE CONTROL
  --------------------------------------------------------- */
  var fontOpenBtn = document.getElementById('fontOpenBtn');
  var fontPop = document.getElementById('fontPop');
  fontOpenBtn.addEventListener('click', function () { fontPop.classList.toggle('open'); });
  document.addEventListener('click', function (e) {
    if (!fontPop.contains(e.target) && e.target !== fontOpenBtn && !fontOpenBtn.contains(e.target)) {
      fontPop.classList.remove('open');
    }
  });
  function applyFontSize() {
    state.fontSize = Math.max(16, Math.min(44, state.fontSize));
    document.documentElement.style.setProperty('--sloka-font-size', state.fontSize + 'px');
    localStorage.setItem(LS.fontSize, state.fontSize);
  }
  document.getElementById('fontInc').addEventListener('click', function () { state.fontSize += 2; applyFontSize(); });
  document.getElementById('fontDec').addEventListener('click', function () { state.fontSize -= 2; applyFontSize(); });
  document.getElementById('fontReset').addEventListener('click', function () { state.fontSize = 26; applyFontSize(); });

  /* ---------------------------------------------------------
     8. SEARCH (Telugu-aware substring match across fields)
  --------------------------------------------------------- */
  var searchOverlay = document.getElementById('searchOverlay');
  var searchInput = document.getElementById('searchInput');
  var searchResults = document.getElementById('searchResults');
  var SEARCH_FIELDS = ['Slokam', 'Padavibhaga', 'Anvyaya', 'Akanksha', 'Bhava', 'Vyakarana', 'Others'];

  document.getElementById('searchOpenBtn').addEventListener('click', function () {
    searchOverlay.classList.add('open');
    // Deliberately NOT clearing searchInput/searchResults here — the term and
    // results should persist across opens/closes until the reader clears the box.
    setTimeout(function () { searchInput.focus(); }, 50);
  });
  document.getElementById('searchCloseBtn').addEventListener('click', function () {
    searchOverlay.classList.remove('open');
  });
  searchOverlay.addEventListener('click', function (e) {
    if (e.target === searchOverlay) searchOverlay.classList.remove('open');
  });

  function normalizeTelugu(s) {
    // Basic normalization: trim, collapse whitespace. (Room to extend with
    // combining-mark normalization if needed for fuzzier matching later.)
    return (s || '').toString().replace(/\s+/g, ' ').trim();
  }

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
          break; // one hit per verse is enough for the results list
        }
      }
    }
    if (!hits.length) {
      searchResults.innerHTML = '<div class="search-empty">No matches found.</div>';
      return;
    }
    searchResults.innerHTML = hits.map(function (h) {
      var v = VERSES[h.index];
      return '<div class="search-result" data-i="' + h.index + '">' +
        '<div class="meta">Sarga ' + v.SargaNo + ' &middot; Verse ' + v.SlokamNo + ' &middot; ' + h.field + '</div>' +
        '<div class="snippet">' + h.snippet + '</div></div>';
    }).join('');
  }

  function buildSnippet(hay, q) {
    var idx = hay.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) idx = hay.indexOf(q);
    var start = Math.max(0, idx - 30);
    var end = Math.min(hay.length, idx + q.length + 40);
    var pre = (start > 0 ? '…' : '') + escapeHtml(hay.slice(start, idx));
    var mid = '<mark>' + escapeHtml(hay.slice(idx, idx + q.length)) + '</mark>';
    var post = escapeHtml(hay.slice(idx + q.length, end)) + (end < hay.length ? '…' : '');
    return idx === -1 ? escapeHtml(hay.slice(0, 70)) + '…' : pre + mid + post;
  }

  searchResults.addEventListener('click', function (e) {
    var item = e.target.closest('.search-result');
    if (!item) return;
    goTo(parseInt(item.getAttribute('data-i'), 10));
    searchOverlay.classList.remove('open');
  });

  /* ---------------------------------------------------------
     9. TOAST
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
     10. ICONS (inline SVG, single-color line icons)
  --------------------------------------------------------- */
  var STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

  function iconSplit() {
    return '<svg viewBox="0 0 24 24" ' + STROKE + '><path d="M12 3v6"/><path d="M12 9 6 21"/><path d="M12 9l6 12"/></svg>';
  }
  function iconFlow() {
    return '<svg viewBox="0 0 24 24" ' + STROKE + '><path d="M4 6h10a4 4 0 0 1 0 8H8"/><polyline points="10 10 6 14 10 18"/></svg>';
  }
  function iconQuestion() {
    return '<svg viewBox="0 0 24 24" ' + STROKE + '><circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 1 1 3.8 2.6c-.9.4-1.5 1-1.5 2.1"/><line x1="12" y1="17" x2="12" y2="17.1"/></svg>';
  }
  function iconLotus() {
    return '<svg viewBox="0 0 24 24" ' + STROKE + '><path d="M12 21c-4-1.5-7-5-7-9 2 1 4.5 1 7 3 2.5-2 5-3 7-3 0 4-3 7.5-7 9Z"/><path d="M12 12V4"/><path d="M8 7c1.5 1 2.5 2.5 4 5"/><path d="M16 7c-1.5 1-2.5 2.5-4 5"/></svg>';
  }
  function iconGrammar() {
    return '<svg viewBox="0 0 24 24" ' + STROKE + '><path d="M4 19.5V5.5A1.5 1.5 0 0 1 5.5 4H18a1 1 0 0 1 1 1v14.5"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="11.5" x2="13" y2="11.5"/></svg>';
  }
  function iconMore() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  }

  /* ---------------------------------------------------------
     11. INIT
  --------------------------------------------------------- */
  function init() {
    if (!VERSES.length) {
      slokaText.innerHTML = '<div class="content-empty">No verses loaded.</div>';
      return;
    }
    var lr = null;
    try { lr = JSON.parse(localStorage.getItem(LS.lastRead) || 'null'); } catch (e) {}
    var startIndex = 0;
    if (lr) {
      var i = findIndex(lr.sargaNo, lr.slokamNo);
      if (i >= 0) startIndex = i;
    }
    var savedTopic = parseInt(localStorage.getItem(LS.lastTopic), 10);
    state.topicIndex = (savedTopic >= 0 && savedTopic < TOPICS.length) ? savedTopic : 2;
    goTo(startIndex, false);
    applyFontSize();
  }

  // Give the external <script src="raghu.js"> a brief moment to either load or
  // fire onerror before we decide which dataset to use.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 30);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 30); });
  }
})();
