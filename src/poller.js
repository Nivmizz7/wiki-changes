'use strict';

const {
  LANGUAGES,
  POLL_INTERVAL_MS,
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
const historySeedTriggered = Object.create(null);

// One fast polling cycle for a language. NEVER blocks server startup.
async function cycle(lang, broadcastEnabled) {
  const idx = store.getIndex(lang);
  let raw = [];

  // Fast fetch: if we have lastTimestamp, fetch newer changes; otherwise fetch latest changes immediately.
  try {
    if (idx.lastTimestamp) {
      raw = await fetchNewerThan(lang, idx.lastTimestamp, MAX_SEED_CHANGES);
    } else {
      raw = await fetchLatest(lang, MAX_SEED_CHANGES);
    }
  } catch (err) {
    console.error(`[poller] ['${lang}'] fetch error:`, err.message);
  }

  let newCount = 0;
  if (raw && raw.length > 0) {
    const changes = raw
      .map((rc) => normalize(lang, rc))
      .filter((c) => c && c.date);

    const res = store.appendChanges(lang, changes);
    newCount = res.newCount;

    if (newCount > 0) {
      exporter.buildLanguageBase(lang);
      if (broadcastEnabled) {
        broadcast(lang, {
          type: 'changes',
          lang,
          newCount: res.newCount,
          dates: res.dates,
          changes: res.newChanges
        });
      }
    }
  } else {
    store.touchPoll(lang);
  }

  // Non-blocking background history seed trigger if this wiki has no full history yet
  const currentDaysCount = Object.keys(idx.days || {}).length;
  if (currentDaysCount < 100 && !historySeedTriggered[lang] && typeof fetchFullWikiHistory === 'function') {
    historySeedTriggered[lang] = true;
    console.log(`[poller] ['${lang}'] Triggering non-blocking full history download in background...`);
    fetchFullWikiHistory(lang)
      .then(() => {
        console.log(`[poller] ['${lang}'] Background full history download finished!`);
        exporter.buildLanguageBase(lang);
        const updatedIdx = store.getIndex(lang);
        broadcast(lang, {
          type: 'snapshot',
          lang,
          days: updatedIdx.days
        });
      })
      .catch((e) => console.error(`[poller] ['${lang}'] Background history download error:`, e.message));
  }

  return { lang, newCount };
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
    }
  }
  return total;
}

async function start() {
  if (started) return;
  started = true;
  console.log('[poller] Starting non-blocking initial seed...');
  
  // Fast initial fetch for all wikis (completes in < 2 seconds)
  runOnce(false)
    .then((seeded) => {
      console.log(`[poller] Initial fast seed done (${seeded} changes loaded). Polling every ${POLL_INTERVAL_MS} ms.`);
    })
    .catch((e) => console.error('[poller] Initial seed error:', e.message));

  timer = setInterval(() => {
    runOnce(true).catch((e) => console.error('[poller] cycle error:', e.message));
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

module.exports = { start, stop, runOnce, cycle };
