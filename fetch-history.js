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

async function fetchRevisions(lang) {
  console.log(`[fetch-history] ['${lang}'] Fetching all page revisions since wiki creation...`);
  const items = [];
  let arvcontinue = null;
  let page = 0;

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
        console.log(`[fetch-history] ['${lang}'] Revisions progress: page ${page}, total revs: ${items.length}`);
      }

      if (data.continue && data.continue.arvcontinue) {
        arvcontinue = data.continue.arvcontinue;
      } else {
        break;
      }
    } catch (err) {
      console.error(`[fetch-history] ['${lang}'] Error fetching revisions page ${page}:`, err.message);
      break;
    }
  }

  console.log(`[fetch-history] ['${lang}'] Total revisions fetched: ${items.length}`);
  return items;
}

async function fetchLogEvents(lang) {
  console.log(`[fetch-history] ['${lang}'] Fetching all log events since wiki creation...`);
  const items = [];
  let lecontinue = null;
  let page = 0;

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
        console.log(`[fetch-history] ['${lang}'] Log events progress: page ${page}, total logs: ${items.length}`);
      }

      if (data.continue && data.continue.lecontinue) {
        lecontinue = data.continue.lecontinue;
      } else {
        break;
      }
    } catch (err) {
      console.error(`[fetch-history] ['${lang}'] Error fetching log events page ${page}:`, err.message);
      break;
    }
  }

  console.log(`[fetch-history] ['${lang}'] Total log events fetched: ${items.length}`);
  return items;
}

async function fetchFullWikiHistory(lang) {
  const revs = await fetchRevisions(lang);
  const logs = await fetchLogEvents(lang);
  const combined = [...revs, ...logs];

  console.log(`[fetch-history] ['${lang}'] Saving ${combined.length} historical entries to store...`);
  store.appendChanges(lang, combined);
  store.rebuildIndex(lang);

  const base = exporter.buildLanguageBase(lang);
  const total = base ? base.count : 0;
  console.log(`[fetch-history] ['${lang}'] Complete! Total entries in base/${lang}.json: ${total}`);
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
