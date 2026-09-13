'use strict';

const {
  LANGUAGES,
  POLL_INTERVAL_MS,
  INITIAL_LOOKBACK_DAYS,
  MAX_SEED_CHANGES
} = require('./config');
const { fetchLatest, fetchNewerThan, normalize } = require('./fetcher');
const store = require('./store');
const { broadcast } = require('./live');
const exporter = require('./export');

let fetchFullWikiHistory = null;
try {
  fetchFullWikiHistory = require('../fetch-history').fetchFullWikiHistory;
} catch (_) {}

let timer = null;
let started = false;

// One polling cycle for a language.
async function cycle(lang, broadcastEnabled) {
  const idx = store.getIndex(lang);
  let raw;

  // If this wiki has no stored history or less than 5 tracked days, fetch full creation history!
  if (!idx.lastTimestamp || Object.keys(idx.days || {}).length < 5) {
    if (typeof fetchFullWikiHistory === 'function') {
      console.log(`[poller] ['${lang}'] First run in this environment — auto-fetching full history since creation...`);
      try {
        await fetchFullWikiHistory(lang);
      } catch (err) {
        console.error(`[poller] ['${lang}'] Initial full history fetch error:`, err.message);
      }
      return { lang, newCount: 0 };
    }
  }

  if (idx.lastTimestamp) {
    raw = await fetchNewerThan(lang, idx.lastTimestamp, MAX_SEED_CHANGES);
  } else {
    raw = await fetchLatest(lang, MAX_SEED_CHANGES);
  }

  if (!raw || !raw.length) {
    store.touchPoll(lang);
    if (exporter.needsRebuild(lang)) exporter.buildLanguageBase(lang);
    return { lang, newCount: 0 };
  }

  const changes = raw
    .map((rc) => normalize(lang, rc))
    .filter((c) => c && c.date); // safety check

  const res = store.appendChanges(lang, changes);

  if (res.newCount > 0 || exporter.needsRebuild(lang)) {
    exporter.buildLanguageBase(lang);
  }

  if (broadcastEnabled && res.newCount > 0) {
    broadcast(lang, {
      type: 'changes',
      lang,
      newCount: res.newCount,
      dates: res.dates,
      changes: res.newChanges
    });
  }
  return { lang, newCount: res.newCount };
}

async function runOnce(broadcastEnabled) {
  const results = await Promise.allSettled(
    LANGUAGES.map((l) => cycle(l.code, broadcastEnabled))
  );
  let total = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      total += r.value.newCount;
    } else {
      console.error(`[poller] error ${LANGUAGES[i].code}:`, r.reason && r.reason.message);
    }
  }
  return total;
}

async function start() {
  if (started) return;
  started = true;
  console.log('[poller] initial seed & history check...');
  const seeded = await runOnce(false);
  console.log(`[poller] seed done (${seeded} new changes loaded). Polling every ${POLL_INTERVAL_MS} ms.`);
  
  const built = exporter.buildAll(LANGUAGES.map((l) => l.code));
  console.log('[export] base files status:', built.map((b) => `${b.lang}:${b.count}`).join(' '));

  timer = setInterval(() => {
    runOnce(true).catch((e) => console.error('[poller] cycle error:', e));
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

module.exports = { start, stop, runOnce, cycle };
