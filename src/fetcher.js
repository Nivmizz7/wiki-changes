'use strict';

const { FANDOM_BASE, USER_AGENT } = require('./config');

// recentchanges properties fetched (fields useful for the detail view).
const RC_PROPS = 'title|ids|user|timestamp|sizes|flags|loginfo|comment';

// Per-request timeout (prevents a slow wiki from blocking the poller forever).
const FETCH_TIMEOUT_MS = 12000;

function buildUrl(lang, params) {
  const qs = new URLSearchParams(params);
  return `${FANDOM_BASE}/${lang}/api.php?${qs.toString()}`;
}

async function getJSON(url, lang) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Fandom API ${res.status} pour ${lang}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Fetches the latest changes of a wiki (newest first),
// paginating until `max` entries have been collected.
async function fetchLatest(lang, max) {
  const collected = [];
  let rccontinue = null;
  let guard = 0;

  while (collected.length < max && guard < 100) {
    const params = {
      action: 'query',
      list: 'recentchanges',
      format: 'json',
      rcdir: 'older',
      rclimit: 500,
      rcprop: RC_PROPS
    };
    if (rccontinue) params.rccontinue = rccontinue;

    const data = await getJSON(buildUrl(lang, params), lang);
    const rcs = (data.query && data.query.recentchanges) || [];
    collected.push(...rcs);
    if (data.continue && data.continue.rccontinue) {
      rccontinue = data.continue.rccontinue;
    } else {
      break;
    }
    guard++;
  }
  return collected;
}

// Fetches changes newer than `sinceISO` (chronological order).
async function fetchNewerThan(lang, sinceISO, max) {
  const collected = [];
  let rccontinue = null;
  let guard = 0;

  while (collected.length < max && guard < 100) {
    const params = {
      action: 'query',
      list: 'recentchanges',
      format: 'json',
      rcdir: 'newer',
      rcstart: sinceISO,
      rclimit: 500,
      rcprop: RC_PROPS
    };
    if (rccontinue) params.rccontinue = rccontinue;

    const data = await getJSON(buildUrl(lang, params), lang);
    const rcs = (data.query && data.query.recentchanges) || [];
    collected.push(...rcs);
    if (data.continue && data.continue.rccontinue) {
      rccontinue = data.continue.rccontinue;
    } else {
      break;
    }
    guard++;
  }
  return collected;
}

function categoryOf(rc) {
  if (rc.type === 'new') return 'creation';
  if (rc.type === 'log') {
    switch (rc.logtype) {
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
  return rc.type === 'edit' ? 'edit' : 'other';
}

function normalize(lang, rc) {
  const ts = rc.timestamp || '';
  const date = ts.slice(0, 10); // jour UTC YYYY-MM-DD
  const category = categoryOf(rc);

  const oldlen = typeof rc.oldlen === 'number' ? rc.oldlen : null;
  const newlen = typeof rc.newlen === 'number' ? rc.newlen : null;
  const diff = oldlen !== null && newlen !== null ? newlen - oldlen : null;

  const title = rc.title || '';
  const pageUrl = `${FANDOM_BASE}/${lang}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const diffUrl = rc.revid ? `${pageUrl}?oldid=${rc.revid}` : null;

  return {
    rcid: rc.rcid,
    type: rc.type,
    category,
    title,
    ns: rc.ns,
    user: rc.user,
    timestamp: ts,
    date,
    oldlen,
    newlen,
    diff,
    minor: !!rc.minor,
    bot: !!rc.bot,
    logtype: rc.logtype || null,
    logaction: rc.logaction || null,
    revid: rc.revid || null,
    old_revid: rc.old_revid || null,
    pageid: rc.pageid || null,
    comment: rc.comment || null,
    pageUrl,
    diffUrl
  };
}

module.exports = { fetchLatest, fetchNewerThan, normalize };
