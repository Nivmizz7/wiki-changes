'use strict';

/* ===== Display config ===== */
const CATEGORIES = [
  { key: 'creation',   label: 'Created',     color: '#4caf50' },
  { key: 'edit',       label: 'Edits',       color: '#ffb347' },
  { key: 'upload',     label: 'Uploads',     color: '#4f8fd8' },
  { key: 'move',       label: 'Moves',       color: '#9f7bc2' },
  { key: 'deletion',   label: 'Deletions',   color: '#d6544f' },
  { key: 'patrol',     label: 'Patrols',     color: '#3bb3a9' },
  { key: 'protection', label: 'Protections', color: '#ff8c1a' },
  { key: 'block',      label: 'Blocks',      color: '#ff5c5c' },
  { key: 'rights',     label: 'Rights',      color: '#c0c0c0' },
  { key: 'merge',      label: 'Merges',      color: '#c0a0ff' },
  { key: 'newusers',   label: 'New users',   color: '#9fd3ff' },
  { key: 'import',     label: 'Imports',     color: '#d0b0ff' },
  { key: 'log',        label: 'Logs',        color: '#8a8a94' },
  { key: 'other',      label: 'Other',       color: '#8a8a94' }
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const state = {
  languages: [],
  currentLang: null,
  allDays: {},   // lang -> { date: {count, byType} }
  detailDate: null,
  es: null
};

const $ = (id) => document.getElementById(id);

function fmtTime(iso) { return (iso || '').slice(11, 16) || '--:--'; }
function fmtBytes(diff) {
  if (diff === null || diff === undefined) return '';
  if (diff > 0) return '+' + diff.toLocaleString('en-US');
  if (diff < 0) return diff.toLocaleString('en-US');
  return '0';
}
function colorForCount(n) {
  if (!n) return '#161618';
  if (n < 5) return '#3a2a12';
  if (n < 10) return '#6b4310';
  if (n < 20) return '#a3620f';
  if (n < 40) return '#d9820c';
  return '#ff9d00';
}
function todayUTC() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ===== Wiki tabs (one per language) ===== */
async function loadLanguages() {
  const data = await api('/api/languages');
  state.languages = data.languages;
  await Promise.all(state.languages.map(async (l) => {
    try {
      const s = await api('/api/changes/' + l.code);
      state.allDays[l.code] = s.days || {};
    } catch (_) { state.allDays[l.code] = {}; }
  }));
  renderTabs();
  renderLegend();
  if (state.languages.length) selectLang(state.languages[0].code);
}

function renderTabs() {
  const nav = $('tabs');
  nav.innerHTML = '';
  for (const l of state.languages) {
    const b = document.createElement('button');
    b.className = 'tab' + (l.code === state.currentLang ? ' active' : '');
    b.innerHTML = `<code>${l.code.toUpperCase()}</code><span>${escapeHtml(l.label)}</span><span class="count-badge" data-lang="${l.code}"></span>`;
    b.addEventListener('click', () => selectLang(l.code));
    nav.appendChild(b);
  }
  updateBadges();
}

function latestDateFor(lang) {
  const days = state.allDays[lang] || {};
  const keys = Object.keys(days).sort();
  return keys.length ? keys[keys.length - 1] : null;
}
function updateBadges() {
  for (const l of state.languages) {
    const el = document.querySelector('.count-badge[data-lang="' + l.code + '"]');
    if (!el) continue;
    const d = latestDateFor(l.code);
    el.textContent = d ? String(state.allDays[l.code][d].count) : '';
  }
}

function renderLegend() {
  const box = $('legend');
  box.innerHTML = CATEGORIES
    .map((c) => `<span class="item"><span class="swatch" style="background:${c.color}"></span>${escapeHtml(c.label)}</span>`)
    .join('');
}

function selectLang(lang) {
  state.currentLang = lang;
  renderTabs();
  renderDays(state.allDays[lang] || {});
  updateMeta();
  if (search.open) syncScopeButtons();
  connectLive(lang);
}

function updateMeta() {
  const lang = state.currentLang;
  const days = state.allDays[lang] || {};
  const dates = Object.keys(days).sort();
  const total = dates.reduce((a, d) => a + days[d].count, 0);
  const today = todayUTC();
  const label = (state.languages.find((l) => l.code === lang) || {}).label || lang;
  if (!dates.length) {
    $('langMeta').innerHTML = `<b>${escapeHtml(label)}</b> · no data yet`;
    return;
  }
  const first = dates[0];
  const covered = Math.round((Date.parse(today) - Date.parse(first)) / 86400000) + 1;
  $('langMeta').innerHTML =
    `<b>${escapeHtml(label)}</b> · ${covered} day(s) covered · ${total.toLocaleString('en-US')} changes · ` +
    `from <b>${first}</b> to <b>${today}</b>`;
}

/* ===== One line per day ===== */
function dateParts(date) {
  const p = String(date).split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}
function weekdayName(date) {
  const { y, m, d } = dateParts(date);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function monthSeq(firstYM, curYM) {
  const out = [];
  const [y0, m0] = firstYM.split('-').map(Number);
  const [y1, m1] = curYM.split('-').map(Number);
  // Inclusive count of months between the two bounds (e.g. 2015-02 -> 2026-09 = 140).
  // Previously capped at 120, which silently cut the timeline (en froze at 2025-01).
  const total = (y1 - y0) * 12 + (m1 - m0) + 1;
  if (total <= 0) return out;
  for (let i = 0; i < total; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    out.push(String(y) + '-' + String(m).padStart(2, '0'));
  }
  return out;
}
// Day rows from newest to oldest, grouped by month.
// Every single day between the first tracked day and today is shown,
// even days without any changes (those are rendered as empty rows).
function getFirstTrackedDate() {
  const today = todayUTC();
  let earliest = today;
  for (const lang of Object.keys(state.allDays)) {
    const keys = Object.keys(state.allDays[lang] || {}).sort();
    if (keys.length && keys[0] < earliest) earliest = keys[0];
  }
  if (earliest === today) {
    const d = new Date(Date.now() - 30 * 86400000);
    earliest = d.toISOString().slice(0, 10);
  }
  return earliest;
}

// Day rows from newest to oldest, grouped by month.
// Every single day between the first tracked day and today is shown,
// even days without any changes (rendered as 0 change rows).
function buildDayRows(days) {
  const today = todayUTC();
  const keys = Object.keys(days || {}).sort();
  const firstDate = keys.length ? keys[0] : getFirstTrackedDate();

  const months = monthSeq(firstDate.slice(0, 7), today.slice(0, 7));
  const groups = [];
  for (let i = months.length - 1; i >= 0; i--) {
    const ym = months[i];
    const [y, m] = ym.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const start = ym === firstDate.slice(0, 7) ? dateParts(firstDate).d : 1;
    const rows = [];
    for (let d = start; d <= dim; d++) {
      const date = ym + '-' + String(d).padStart(2, '0');
      if (date > today) break; // never render future days
      rows.push({ date, info: days[date] || { count: 0, byType: {} } });
    }
    if (rows.length) {
      const total = rows.reduce((a, r) => a + (r.info ? r.info.count : 0), 0);
      groups.push({ label: MONTHS_FULL[m - 1].toUpperCase() + ' ' + y, total, rows: rows.reverse() });
    }
  }
  return groups;
}

function renderDays(days) {
  const box = $('days');
  box.innerHTML = '';
  const groups = buildDayRows(days);
  if (!groups.length) {
    box.innerHTML = '<div class="placeholder">No data yet.</div>';
    return;
  }
  let maxCount = 0;
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.info && r.info.count > maxCount) maxCount = r.info.count;
    }
  }
  const today = todayUTC();
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'month-block';
    const head = document.createElement('div');
    head.className = 'month-title';
    head.innerHTML = escapeHtml(g.label) + ' <span class="roll">' + g.total.toLocaleString('en-US') + ' changes</span>';
    section.appendChild(head);

    const col = document.createElement('div');
    col.className = 'colheads';
    col.innerHTML = '<span>date</span><span>Δ</span><span>types</span><span>activity</span><span></span>';
    section.appendChild(col);

    const list = document.createElement('div');
    list.className = 'day-list';
    for (const r of g.rows) {
      const { m, d } = dateParts(r.date);
      const isToday = r.date === today;
      const count = r.info ? r.info.count : 0;
      const pct = (r.info && maxCount && count > 0) ? Math.max(3, Math.round((count / maxCount) * 100)) : 0;

      let chips = '';
      if (isToday) chips += '<span class="type-chip today-chip">TODAY</span>';
      if (r.info && r.info.byType) {
        const top = CATEGORIES
          .map((c) => ({ c, n: r.info.byType[c.key] || 0 }))
          .filter((x) => x.n > 0)
          .sort((a, b) => b.n - a.n)
          .slice(0, 4);
        for (const t of top) {
          chips += `<span class="type-chip" style="--c:${t.c.color}" title="${escapeHtml(t.c.label)} : ${t.n}">${t.n}</span>`;
        }
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-row has-data' + (isToday ? ' today' : '') + (count === 0 ? ' zero-changes' : '');
      btn.dataset.date = r.date;
      btn.innerHTML =
        `<span class="rdate"><em>${weekdayName(r.date)}</em><b>${String(d).padStart(2, '0')}</b><small>${MONTHS[m - 1].toUpperCase()}</small></span>` +
        `<span class="rcount${count > 0 ? '' : ' empty'}">${count}</span>` +
        `<span class="rtypes">${chips}</span>` +
        `<span class="rbar"><i style="width:${pct}%"></i></span>` +
        '<span class="rgo">›</span>';
      list.appendChild(btn);
    }
    section.appendChild(list);
    box.appendChild(section);
  }
}

/* ===== Day detail page ===== */
async function openDetail(date) {
  state.detailDate = date;
  const data = await api('/api/changes/' + state.currentLang + '/' + date);
  renderDetail(data);
  const m = $('modal');
  m.classList.remove('hidden');
}

function closeDetail() {
  $('modal').classList.add('hidden');
  state.detailDate = null;
}

function bytesClass(diff) {
  if (diff === null || diff === undefined) return 'zero';
  if (diff > 0) return 'up';
  if (diff < 0) return 'down';
  return 'zero';
}

function renderDetail(data) {
  const lang = state.currentLang;
  const label = (state.languages.find((l) => l.code === lang) || {}).label || lang;
  const FANDOM_BASE = 'https://escapefromtarkov.fandom.com';
  $('modalTitle').textContent = `${data.date} · ${label}`;
  $('modalSub').textContent = `${data.count} change(s) on this day`;
  $('downloadBtn').setAttribute('href', '/api/raw/' + lang + '/' + data.date);

  // Group by change category (CATEGORIES order)
  const groups = Object.create(null);
  for (const c of data.changes || []) {
    (groups[c.category] = groups[c.category] || []).push(c);
  }

  const body = $('modalBody');
  body.innerHTML = '';
  let any = false;
  for (const cat of CATEGORIES) {
    const items = groups[cat.key];
    if (!items || !items.length) continue;
    any = true;
    items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.timestamp.localeCompare(b.timestamp));
    const sec = document.createElement('div');
    sec.className = 'group';
    sec.innerHTML = `<div class="group-head"><span class="swatch" style="background:${cat.color}"></span>${escapeHtml(cat.label)}<span class="gcount">${items.length}</span></div>`;
    for (const it of items) {
      const minor = it.minor ? `<span class="flags"><span class="flag-minor">minor</span></span>` : '';
      const comment = it.comment ? ` title="${escapeHtml(it.comment)}"` : '';
      const href = it.diffUrl || it.pageUrl || '#';
      const userUrl = `${FANDOM_BASE}/${lang}/wiki/User:${encodeURIComponent((it.user || '').replace(/ /g, '_'))}`;
      const bytes = it.diff === null || it.diff === undefined
        ? '—'
        : fmtBytes(it.diff);
      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.innerHTML =
        `<span class="time">${fmtTime(it.timestamp)}</span>` +
        `<a class="author link" href="${userUrl}" target="_blank" rel="noopener" title="User:${escapeHtml(it.user)}">${escapeHtml(it.user)}</a>` +
        `<span><a class="title" href="${href}" target="_blank" rel="noopener"${comment}>${escapeHtml(it.title)}</a>${minor}</span>` +
        `<span class="bytes ${bytesClass(it.diff)}">${bytes}</span>`;
      sec.appendChild(entry);
    }
    body.appendChild(sec);
  }
  if (!any) body.innerHTML = '<div class="empty-day">No changes on this day.</div>';
}

/* ===== Live updates (SSE) ===== */
function connectLive(lang) {
  if (state.es) { state.es.close(); state.es = null; }
  setLive(false);
  const es = new EventSource('/api/live/' + lang);
  state.es = es;
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false);
  es.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    setLive(true);
    $('lastUpdate').textContent = new Date().toISOString().slice(11, 19) + 'Z';
    if (msg.type === 'snapshot' && msg.lang === state.currentLang) {
      state.allDays[lang] = msg.days || {};
      refreshDays();
    } else if (msg.type === 'changes' && msg.lang === state.currentLang) {
      // Reload the latest summary for this wiki
      api('/api/changes/' + lang).then((s) => {
        state.allDays[lang] = s.days || {};
        refreshDays(msg.dates || []);
        if (state.detailDate && (msg.dates || []).includes(state.detailDate)) {
          api('/api/changes/' + lang + '/' + state.detailDate).then(renderDetail);
        }
      }).catch(() => {});
    }
  };
}

function refreshDays(flashDates) {
  renderDays(state.allDays[state.currentLang] || {});
  updateMeta();
  updateBadges();
  if (flashDates && flashDates.length) {
    for (const d of flashDates) {
      const row = document.querySelector('.day-row[data-date="' + d + '"]');
      if (row) {
        row.classList.remove('flash');
        void row.offsetWidth; // force reflow to restart the animation
        row.classList.add('flash');
      }
    }
  }
}

function setLive(on) {
  $('liveText').className = 'live ' + (on ? 'online' : 'offline');
  $('liveText').textContent = on ? 'LIVE' : 'OFFLINE';
}

/* ===== Command search (Ctrl+K) ===== */
const search = {
  open: false,
  scope: 'lang', // 'lang' = current wiki tab, 'all' = all ten wikis
  results: [],
  active: -1,
  timer: null,
  ctrl: null,
  searching: false,
  prevFocus: null
};

function searchScope() {
  return search.scope === 'all' ? 'all' : (state.currentLang || 'en');
}

function catColor(cat) {
  const c = CATEGORIES.find((x) => x.key === cat);
  return c ? c.color : '#8a8a94';
}
function catLabel(cat) {
  const c = CATEGORIES.find((x) => x.key === cat);
  return c ? c.label : cat;
}

function openSearch() {
  if (search.open) return;
  search.open = true;
  search.prevFocus = document.activeElement;
  syncScopeButtons();
  $('searchModal').classList.remove('hidden');
  const inp = $('searchInput');
  inp.value = '';
  $('searchClear').classList.add('hidden');
  $('searchInput').setAttribute('aria-expanded', 'false');
  search.results = [];
  search.active = -1;
  $('searchMeta').textContent = 'Type at least 2 characters to search.';
  $('searchStat').textContent = '';
  $('searchResults').innerHTML = '';
  inp.focus();
}

function closeSearch() {
  if (!search.open) return;
  search.open = false;
  if (search.ctrl) { search.ctrl.abort(); search.ctrl = null; }
  if (search.timer) { clearTimeout(search.timer); search.timer = null; }
  search.searching = false;
  $('searchModal').classList.add('hidden');
  if (search.prevFocus && search.prevFocus.focus) search.prevFocus.focus();
}

function syncScopeButtons() {
  const code = (state.currentLang || 'en').toUpperCase();
  $('scopeLang').textContent = code;
  const isLang = search.scope !== 'all';
  $('scopeLang').classList.toggle('is-active', isLang);
  $('scopeAll').classList.toggle('is-active', !isLang);
  $('scopeLang').setAttribute('aria-pressed', String(isLang));
  $('scopeAll').setAttribute('aria-pressed', String(!isLang));
}

function setScope(scope) {
  if (search.scope === scope) return;
  search.scope = scope;
  syncScopeButtons();
  scheduleSearch(0);
}

// <mark>-highlight every query token (non-overlapping, longest first).
function highlight(text, query) {
  const src = String(text == null ? '' : text);
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!tokens.length) return escapeHtml(src);
  const lower = src.toLowerCase();
  const ranges = [];
  for (const t of tokens) {
    let i = lower.indexOf(t);
    while (i >= 0) {
      ranges.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] < last[1]) { if (r[1] > last[1]) last[1] = r[1]; }
    else merged.push([r[0], r[1]]);
  }
  let out = '';
  let cur = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(src.slice(cur, s)) + '<mark>' + escapeHtml(src.slice(s, e)) + '</mark>';
    cur = e;
  }
  return out + escapeHtml(src.slice(cur));
}

function scheduleSearch(delay) {
  if (search.timer) clearTimeout(search.timer);
  search.timer = setTimeout(runSearch, delay == null ? 150 : delay);
}

async function runSearch() {
  const q = $('searchInput').value.trim();
  $('searchClear').classList.toggle('hidden', !q);
  if (q.length < 2) {
    if (search.ctrl) { search.ctrl.abort(); search.ctrl = null; }
    search.searching = false;
    search.results = [];
    search.active = -1;
    $('searchMeta').textContent = 'Type at least 2 characters to search.';
    $('searchStat').textContent = '';
    $('searchResults').innerHTML = '';
    $('searchInput').setAttribute('aria-expanded', 'false');
    return;
  }
  if (search.ctrl) search.ctrl.abort();
  const ctrl = new AbortController();
  search.ctrl = ctrl;
  search.searching = true;
  $('searchMeta').textContent = 'Searching…';
  try {
    const res = await fetch('/api/search/' + searchScope() + '?q=' + encodeURIComponent(q) + '&limit=40', { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    if (ctrl.signal.aborted) return;
    renderSearchResults(payload, q);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    $('searchMeta').textContent = 'Search failed: ' + (err && err.message ? err.message : err);
  } finally {
    if (search.ctrl === ctrl) { search.ctrl = null; search.searching = false; }
  }
}

function renderSearchResults(payload, q) {
  const box = $('searchResults');
  box.innerHTML = '';
  search.results = payload.results || [];
  const multi = search.scope === 'all';
  let meta = search.results.length + ' result(s) · ' + payload.scannedDays + ' day(s) scanned · ' + payload.tookMs + 'ms';
  if (payload.truncated) meta += ' · recent matches only, refine query for older history';
  $('searchMeta').textContent = meta;
  $('searchStat').textContent = search.scope === 'all' ? 'ALL WIKIS' : (state.currentLang || '').toUpperCase();
  $('searchInput').setAttribute('aria-expanded', String(search.results.length > 0));

  if (!search.results.length) {
    box.innerHTML = '<div class="cmdk-empty">No matches. Try a page name, author, or a word from an edit comment.</div>';
    search.active = -1;
    return;
  }
  search.results.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cmdk-item' + (i === 0 ? ' is-active' : '');
    b.id = 'search-result-' + i;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    const bytes = (r.diff === null || r.diff === undefined) ? '—' : fmtBytes(r.diff);
    b.innerHTML =
      (multi ? `<span class="cmdk-lang">${escapeHtml((r.lang || '').toUpperCase())}</span>` : '') +
      `<span class="cmdk-date">${escapeHtml(r.date || '')}</span>` +
      `<span class="type-chip" style="--c:${catColor(r.category)}">${escapeHtml(catLabel(r.category))}</span>` +
      `<span class="cmdk-main"><span class="cmdk-title">${highlight(r.title, q)}</span>` +
      `<span class="cmdk-sub">by ${highlight(r.user, q)}` +
      (r.comment ? ' · ' + highlight(r.comment.slice(0, 120), q) : '') + '</span></span>' +
      `<span class="bytes ${bytesClass(r.diff)}">${bytes}</span>`;
    b.addEventListener('mouseenter', () => setSearchActive(i, false));
    b.addEventListener('click', () => selectSearchResult(i));
    box.appendChild(b);
  });
  search.active = 0;
  $('searchInput').setAttribute('aria-activedescendant', 'search-result-0');
}

function setSearchActive(i, scroll) {
  const items = document.querySelectorAll('.cmdk-item');
  items.forEach((el, j) => {
    el.classList.toggle('is-active', j === i);
    el.setAttribute('aria-selected', String(j === i));
  });
  search.active = i;
  $('searchInput').setAttribute('aria-activedescendant', i >= 0 ? 'search-result-' + i : '');
  if (scroll !== false && i >= 0 && items[i] && items[i].scrollIntoView) {
    items[i].scrollIntoView({ block: 'nearest' });
  }
}

function moveSearchActive(dir) {
  if (!search.results.length) return;
  const n = search.results.length;
  const next = search.active < 0 ? (dir > 0 ? 0 : n - 1) : (search.active + dir + n) % n;
  setSearchActive(next);
}

async function selectSearchResult(i) {
  const r = search.results[i];
  if (!r) return;
  closeSearch();
  // Jump to the result's wiki tab first when searching across wikis.
  if (r.lang && r.lang !== state.currentLang) selectLang(r.lang);
  if (r.date) {
    try { await openDetail(r.date); }
    catch (err) { $('days').innerHTML = '<div class="placeholder">Failed to load: ' + escapeHtml(err.message) + '</div>'; }
  }
}

function wireSearch() {
  $('searchBtn').addEventListener('click', openSearch);
  $('searchClose').addEventListener('click', closeSearch);
  $('searchModal').addEventListener('click', (e) => {
    if (e.target === $('searchModal')) closeSearch();
  });
  $('scopeLang').addEventListener('click', () => setScope('lang'));
  $('scopeAll').addEventListener('click', () => setScope('all'));
  $('searchClear').addEventListener('click', () => {
    $('searchInput').value = '';
    $('searchInput').focus();
    scheduleSearch(0);
  });
  $('searchInput').addEventListener('input', () => scheduleSearch(150));
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchActive(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); selectSearchResult(search.active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (search.open) closeSearch();
      else openSearch();
    }
  });
}

/* ===== Init ===== */
function init() {
  $('days').addEventListener('click', (e) => {
    const row = e.target.closest('.day-row.has-data');
    if (row && row.dataset.date) openDetail(row.dataset.date);
  });
  $('closeBtn').addEventListener('click', closeDetail);
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (search.open) closeSearch();
      else closeDetail();
    }
  });
  wireSearch();
  loadLanguages().catch((err) => {
    $('days').innerHTML = '<div class="placeholder">Failed to load: ' + escapeHtml(err.message) + '</div>';
  });
}

init();


