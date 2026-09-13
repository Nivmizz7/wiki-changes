'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR, BASE_DIR } = require('./config');

// Rebuilds are throttled so the big dump is not rewritten on every poll tick.
const REBUILD_THROTTLE_MS = Number(process.env.BASE_REBUILD_MS) || 300000;
const lastBuildAt = Object.create(null); // lang -> epoch millis

function needsRebuild(lang, throttleMs) {
  const last = lastBuildAt[lang] || 0;
  return (Date.now() - last) >= (throttleMs || REBUILD_THROTTLE_MS);
}

// Reads every day file of one wiki and merges them into a single
// chronological dump written to base/<lang>.json (committed to GitHub).
// Returns the dump, or null when the wiki has no stored days yet.
function buildLanguageBase(lang) {
  const srcDir = path.join(DATA_DIR, lang);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return null;

  const dayFiles = fs
    .readdirSync(srcDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  const changes = [];
  for (const f of dayFiles) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
      changes.push(...arr);
    } catch (_) {
      /* skip malformed day file */
    }
  }
  changes.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.rcid - b.rcid);

  const base = {
    lang,
    generatedAt: new Date().toISOString(),
    count: changes.length,
    changes
  };
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASE_DIR, `${lang}.json`), JSON.stringify(base, null, 2));
  lastBuildAt[lang] = Date.now();
  return base;
}

function buildAll(langCodes) {
  const results = [];
  for (const lang of langCodes) {
    try {
      const b = buildLanguageBase(lang);
      results.push({ lang, count: b ? b.count : 0 });
    } catch (e) {
      console.error(`[export] error ${lang}:`, e.message);
      results.push({ lang, count: 0, error: e.message });
    }
  }
  return results;
}

module.exports = { buildLanguageBase, buildAll, needsRebuild, REBUILD_THROTTLE_MS };