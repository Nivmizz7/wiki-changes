'use strict';

/**
 * Historical Data Fetcher for Tarkov Wiki Changes
 * Fetches EVERY revision (edits & creations) and EVERY log event (uploads, deletions, moves, etc.)
 * from the wiki's creation (2015/2016/2017) to today for all 10 Tarkov language wikis.
 * Saves daily files data/<lang>/<YYYY-MM-DD>.json, index.json, and exports base/<lang>.json dumps.
 */

const { LANGUAGES, FANDOM_BASE, USER_AGENT } = require('./src/config');
const store = require('./src/store');
const exporter = require('./src/export');

function categoryFromLog(logtype) {
  switch (logtype) {
    case 'upload': return 'upload';
    case 'delete': return 'deletion';
    case 'move': return 'move';
    case 'protect': return 'protection';
    case 'patrol': return 'patrol';
    case 'block': return 'block';
    case 'rights': return 'rights';
    case 'import': return 'import';
    case 'merge': return 'merge';
    case 'newusers': return 'newusers';
    default: return 'log';
  }
}

// Fetch chunks are flushed to the store progressively so a cold-start re-seed
// fills the timeline day by day and memory stays bounded (en ~556k revisions).
const CHUNK_SIZE = 20000;

async function fetchRevisions(lang, onChunk) {
  console.log(`[fetch-history] ['${lang}'] Fetching all page revisions since wiki creation...`);
  let items = [];
  let arvcontinue = null;
  let page = 0;
  let total = 0;

  const flush = async () => {
    if (!items.length) return;
    total += items.length;
    if (onChunk) await onChunk(items);
    items = [];
  };

  while (true) {
    page++;
    const params = new URLSearchParams({
      action: 'query',
      list: 'allrevisions',
      format: 'json',
      arvdir: 'newer',
      arvstart: '2015-01-01T00:00:00Z',
      arvlimit: '500',
      arvprop: 'ids|flags|timestamp|user|size|comment'
    });
    if (arvcontinue) params.set('arvcontinue', arvcontinue);

    try {
      const res = await fetch(`${FANDOM_BASE}/${lang}/api.php?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const pages = (data.query && data.query.allrevisions) || [];

      for (const pg of pages) {
        const title = pg.title || '';
        const ns = pg.ns || 0;
        const pageid = pg.pageid || null;
        const pageUrl = `${FANDOM_BASE}/${lang}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

        for (const rev of (pg.revisions || [])) {
          if (!rev.timestamp) continue;
          const ts = rev.timestamp;
          const date = ts.slice(0, 10);
          const isNew = rev.parentid === 0;
          const category = isNew ? 'creation' : 'edit';
          const rcid = rev.revid ? `rev-${rev.revid}` : `rev-p${pageid}-${ts}`;

          items.push({
            rcid,
            revid: rev.revid || null,
            old_revid: rev.parentid || null,
            type: isNew ? 'new' : 'edit',
            category,
            title,
            ns,
            pageid,
            user: rev.user || (rev.anon !== undefined ? 'Anonymous' : 'Unknown'),
            timestamp: ts,
            date,
            oldlen: null,
            newlen: typeof rev.size === 'number' ? rev.size : null,
            diff: null,
            minor: !!rev.minor,
            bot: false,
            comment: rev.comment || null,
            pageUrl,
            diffUrl: rev.revid ? `${pageUrl}?oldid=${rev.revid}` : null
          });
        }
      }

      if (page % 10 === 0) {
        console.log(`[fetch-history] ['${lang}'] Revisions progress: page ${page}, total revs: ${total + items.length}`);
      }

      if (items.length >= CHUNK_SIZE) await flush();

      if (data.continue && data.continue.arvcontinue) {
        arvcontinue = data.continue.arvcontinue;
      } else {
        break;
      }
    } catch (err) {
      console.error(`[fetch-history] ['${lang}'] Error fetching revisions page ${page}:`, err.message);
      // Save whatever has been fetched so far, then stop.
      await flush();
      break;
    }
  }

  await flush();
  console.log(`[fetch-history] ['${lang}'] Total revisions fetched: ${total}`);
  return total;
}

async function fetchLogEvents(lang, onChunk) {
  console.log(`[fetch-history] ['${lang}'] Fetching all log events since wiki creation...`);
  let items = [];
  let lecontinue = null;
  let page = 0;
  let total = 0;

  const flush = async () => {
    if (!items.length) return;
    total += items.length;
    if (onChunk) await onChunk(items);
    items = [];
  };

  while (true) {
    page++;
    const params = new URLSearchParams({
      action: 'query',
      list: 'logevents',
      format: 'json',
      ledir: 'newer',
      lestart: '2015-01-01T00:00:00Z',
      lelimit: '500',
      leprop: 'ids|title|type|user|timestamp|comment|details'
    });
    if (lecontinue) params.set('lecontinue', lecontinue);

    try {
      const res = await fetch(`${FANDOM_BASE}/${lang}/api.php?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const logs = (data.query && data.query.logevents) || [];

      for (const log of logs) {
        if (!log.timestamp) continue;
        const ts = log.timestamp;
        const date = ts.slice(0, 10);
        const title = log.title || '';
        const pageUrl = title ? `${FANDOM_BASE}/${lang}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : null;
        const category = categoryFromLog(log.type);

        items.push({
          rcid: log.logid ? `log-${log.logid}` : `log-${ts}-${log.type}`,
          logid: log.logid || null,
          type: 'log',
          logtype: log.type || null,
          logaction: log.action || null,
          category,
          title,
          ns: log.ns || 0,
          pageid: log.pageid || null,
          user: log.user || 'Unknown',
          timestamp: ts,
          date,
          oldlen: null,
          newlen: null,
          diff: null,
          minor: false,
          bot: false,
          comment: log.comment || null,
          pageUrl,
          diffUrl: null
        });
      }

      if (page % 10 === 0) {
        console.log(`[fetch-history] ['${lang}'] Log events progress: page ${page}, total logs: ${total + items.length}`);
      }

      if (items.length >= CHUNK_SIZE) await flush();

      if (data.continue && data.continue.lecontinue) {
        lecontinue = data.continue.lecontinue;
      } else {
        break;
      }
    } catch (err) {
      console.error(`[fetch-history] ['${lang}'] Error fetching log events page ${page}:`, err.message);
      // Save whatever has been fetched so far, then stop.
      await flush();
      break;
    }
  }

  await flush();
  console.log(`[fetch-history] ['${lang}'] Total log events fetched: ${total}`);
  return total;
}

async function fetchFullWikiHistory(lang) {
  let saved = 0;
  const onChunk = async (chunk) => {
    if (!chunk || !chunk.length) return;
    try {
      const res = store.appendChanges(lang, chunk);
      saved += res.newCount;
    } catch (e) {
      console.error(`[fetch-history] ['${lang}'] Error storing chunk:`, e.message);
    }
  };

  console.log(`[fetch-history] ['${lang}'] Saving history to store incrementally...`);
  const revs = await fetchRevisions(lang, onChunk);
  const logs = await fetchLogEvents(lang, onChunk);

  store.rebuildIndex(lang);

  const base = exporter.buildLanguageBase(lang);
  const total = base ? base.count : 0;
  console.log(`[fetch-history] ['${lang}'] Complete! ${revs} revisions + ${logs} logs fetched, ${saved} new entries saved. Total in base/${lang}.json: ${total}`);
  return { lang, count: total };
}

async function main() {
  console.log('================================================================');
  console.log(' Starting FULL HISTORY fetch (all revisions + logs since 2015)');
  console.log('================================================================');
  const t0 = Date.now();

  const results = [];
  for (const l of LANGUAGES) {
    try {
      const res = await fetchFullWikiHistory(l.code);
      results.push(res);
    } catch (e) {
      console.error(`[fetch-history] Fatal error for '${l.code}':`, e.message);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('================================================================');
  console.log(` ALL WIKIS FETCHED IN ${elapsed}s`);
  for (const r of results) {
    console.log(` - ${r.lang.toUpperCase()}: ${r.count} total changes since creation -> base/${r.lang}.json`);
  }
  console.log('================================================================');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fetch-history] Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { fetchFullWikiHistory, main };
