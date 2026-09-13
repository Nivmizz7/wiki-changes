'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

// Disk storage, per wiki language:
//   data/<lang>/index.json          -> { days:{date:{count,byType}}, lastTimestamp, lastRcid, lastPoll }
//   data/<lang>/<YYYY-MM-DD>.json   -> array of normalized changes for that day

function langDir(lang) {
  const d = path.join(DATA_DIR, lang);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function indexFile(lang) {
  return path.join(langDir(lang), 'index.json');
}

function dayFile(lang, date) {
  return path.join(langDir(lang), `${date}.json`);
}

const indexes = Object.create(null); // lang -> index (cache memory)

function rebuildIndex(lang) {
  const d = langDir(lang);
  if (!fs.existsSync(d)) return { days: {}, lastTimestamp: null, lastRcid: 0, lastPoll: null };

  const files = fs
    .readdirSync(d)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  const idx = { days: {}, lastTimestamp: null, lastRcid: 0, lastPoll: new Date().toISOString() };

  for (const f of files) {
    const date = f.slice(0, 10);
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const summary = { count: arr.length, byType: {} };
      for (const e of arr) {
        summary.byType[e.category] = (summary.byType[e.category] || 0) + 1;
        if (!idx.lastTimestamp || (e.timestamp && e.timestamp > idx.lastTimestamp)) {
          idx.lastTimestamp = e.timestamp;
        }
        if (typeof e.rcid === 'number' && e.rcid > idx.lastRcid) {
          idx.lastRcid = e.rcid;
        }
      }
      idx.days[date] = summary;
    } catch (_) {
      /* skip corrupt day file */
    }
  }

  indexes[lang] = idx;
  fs.writeFileSync(indexFile(lang), JSON.stringify(idx));
  return idx;
}

function initLang(lang) {
  if (indexes[lang]) return indexes[lang];
  let idx = { days: {}, lastTimestamp: null, lastRcid: 0, lastPoll: null };
  try {
    const raw = fs.readFileSync(indexFile(lang), 'utf8');
    const parsed = JSON.parse(raw);
    idx.days = parsed.days || {};
    idx.lastTimestamp = parsed.lastTimestamp || null;
    idx.lastRcid = parsed.lastRcid || 0;
    idx.lastPoll = parsed.lastPoll || null;
  } catch (_) {
    // If index file doesn't exist, build from daily files
    return rebuildIndex(lang);
  }
  indexes[lang] = idx;
  return idx;
}

function saveIndex(lang) {
  const idx = initLang(lang);
  fs.writeFileSync(indexFile(lang), JSON.stringify(idx));
}

function loadDay(lang, date) {
  try {
    return JSON.parse(fs.readFileSync(dayFile(lang, date), 'utf8'));
  } catch (_) {
    return [];
  }
}

// Merges new changes (deduped by rcid) into the day file and updates
// the summary in the index. Returns { newCount, dates, newChanges }.
function appendChanges(lang, changes) {
  const idx = initLang(lang);
  const newChanges = [];
  const byDate = Object.create(null);

  for (const c of changes) {
    if (!c || !c.date) continue; // skip entries without a valid date
    (byDate[c.date] = byDate[c.date] || []).push(c);
  }

  for (const date of Object.keys(byDate)) {
    const existing = loadDay(lang, date);
    const map = new Map(existing.map((e) => [e.rcid, e]));
    for (const c of byDate[date]) {
      if (!map.has(c.rcid)) {
        map.set(c.rcid, c);
        newChanges.push(c);
      }
    }
    const merged = [...map.values()].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    fs.writeFileSync(dayFile(lang, date), JSON.stringify(merged));

    const summary = idx.days[date] || { count: 0, byType: {} };
    summary.count = merged.length;
    summary.byType = {};
    for (const e of merged) {
      summary.byType[e.category] = (summary.byType[e.category] || 0) + 1;
    }
    idx.days[date] = summary;
  }

  for (const c of changes) {
    if (c.timestamp && (!idx.lastTimestamp || c.timestamp > idx.lastTimestamp)) idx.lastTimestamp = c.timestamp;
    if (typeof c.rcid === 'number' && c.rcid > idx.lastRcid) idx.lastRcid = c.rcid;
  }
  idx.lastPoll = new Date().toISOString();

  saveIndex(lang);
  return { newCount: newChanges.length, dates: Object.keys(byDate), newChanges };
}

function getIndex(lang) {
  return initLang(lang);
}

function getDays(lang) {
  return initLang(lang).days;
}

function getDay(lang, date) {
  return loadDay(lang, date);
}

function touchPoll(lang) {
  const idx = initLang(lang);
  idx.lastPoll = new Date().toISOString();
  saveIndex(lang);
}

module.exports = {
  appendChanges,
  getIndex,
  getDays,
  getDay,
  touchPoll,
  rebuildIndex
};
