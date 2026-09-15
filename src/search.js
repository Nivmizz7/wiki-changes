'use strict';

// Server-side full-text search over the local JSON store.
//
// Design for speed (zero dependencies, huge history since 2015):
//   - scans day files newest-first, so recent matches win early;
//   - hard time budget (BUDGET_MS) shared across languages: stops mid-scan
//     and reports `truncated: true` instead of blocking the event loop;
//   - per-language file cap (MAX_FILES) so cold `all` searches stay bounded;
//   - over-collects (limit x OVERSAMPLE) before ranking so an older exact
//     title match can still beat a newer comment-only match.

const store = require('./store');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const OVERSAMPLE = 4;
const BUDGET_MS = 350;
const MAX_FILES_SINGLE = 365; // ~1 year back when searching one wiki
const MAX_FILES_MULTI = 120; // per wiki when searching across wikis

// Cache of sorted day keys per language. Day keys change at most once a day,
// so a count + first/last check avoids re-sorting thousands of keys on every
// keystroke while still picking up new days automatically.
const dateCache = Object.create(null);

function sortedDates(lang) {
  const days = store.getDays(lang) || {};
  const count = Object.keys(days).length;
  const cached = dateCache[lang];
  if (cached && cached.count === count && days[cached.first] && days[cached.last]) {
    return cached.dates;
  }
  const dates = Object.keys(days).sort();
  dateCache[lang] = {
    count,
    first: dates[0],
    last: dates[dates.length - 1],
    dates
  };
  return dates;
}

function tokenize(raw) {
  return String(raw || '').toLowerCase().split(/\s+/).filter(Boolean);
}

// Rank a change against the tokens. Returns -1 when not all tokens match
// (AND semantics). Lower is better:
//   0 = whole query equals the page title
//   1 = every token in the title
//   2 = every token in title or author
//   3 = at least one token only in the edit comment
function rankChange(change, tokens, query) {
  const title = (change.title || '').toLowerCase();
  const user = (change.user || '').toLowerCase();
  const comment = (change.comment || '').toLowerCase();
  if (!tokens.length) return -1;
  if (title === query) return 0;
  let inTitle = 0;
  let inTitleOrUser = 0;
  for (const t of tokens) {
    const ht = title.includes(t);
    const hu = user.includes(t);
    const hc = comment.includes(t);
    if (!ht && !hu && !hc) return -1;
    if (ht) inTitle++;
    if (ht || hu) inTitleOrUser++;
  }
  if (inTitle === tokens.length) return 1;
  if (inTitleOrUser === tokens.length) return 2;
  return 3;
}

function toResult(lang, change) {
  return {
    lang,
    date: change.date,
    timestamp: change.timestamp,
    title: change.title,
    user: change.user,
    category: change.category,
    type: change.type,
    diff: change.diff,
    minor: Boolean(change.minor),
    comment: change.comment || '',
    pageUrl: change.pageUrl,
    diffUrl: change.diffUrl
  };
}

// langs: array of language codes (already validated by the caller).
// Returns { results, scannedDays, scannedLangs, truncated, tookMs }.
function searchChanges(langs, rawQuery, options) {
  const started = Date.now();
  const query = String(rawQuery || '').trim().toLowerCase();
  const tokens = tokenize(query);
  const limit = Math.min(
    Math.max(1, Number((options && options.limit) || DEFAULT_LIMIT)),
    MAX_LIMIT
  );
  const multi = langs.length > 1;
  const maxFiles = (options && options.maxFiles) || (multi ? MAX_FILES_MULTI : MAX_FILES_SINGLE);
  const budgetMs = (options && options.budgetMs) || BUDGET_MS;
  const deadline = started + budgetMs;
  const want = Math.min(limit * OVERSAMPLE, MAX_LIMIT * OVERSAMPLE);

  const candidates = []; // { rank, ts, result }
  let scannedDays = 0;
  let scannedLangs = 0;
  let truncated = false;

  outer:
  for (const lang of langs) {
    let dates;
    try {
      dates = sortedDates(lang);
    } catch (_) {
      continue;
    }
    scannedLangs++;
    let files = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (Date.now() > deadline) { truncated = true; break outer; }
      if (files >= maxFiles) { truncated = true; break; }
      const date = dates[i];
      let day;
      try {
        day = store.getDay(lang, date);
      } catch (_) {
        continue;
      }
      files++;
      scannedDays++;
      if (!Array.isArray(day) || !day.length) continue;
      // Day arrays are stored oldest-first; walk backwards (newest first).
      for (let j = day.length - 1; j >= 0; j--) {
        const rank = rankChange(day[j], tokens, query);
        if (rank >= 0) {
          candidates.push({ rank, ts: day[j].timestamp || '', result: toResult(lang, day[j]) });
          if (candidates.length >= want) break;
        }
      }
      if (candidates.length >= want) break;
    }
    if (candidates.length >= want) break;
  }

  candidates.sort((a, b) => (a.rank - b.rank) || (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return {
    results: candidates.slice(0, limit).map((c) => c.result),
    scannedDays,
    scannedLangs,
    truncated,
    tookMs: Date.now() - started
  };
}

module.exports = { searchChanges, tokenize };
