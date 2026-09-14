'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT, LANGUAGES } = require('./src/config');
const store = require('./src/store');
const { addSubscriber, clientCount } = require('./src/live');
const poller = require('./src/poller');
const exporter = require('./src/export');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

const zlib = require('zlib');

function sendJSON(req, res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const acceptEncoding = (req && req.headers && req.headers['accept-encoding']) || '';

  if (acceptEncoding.includes('gzip')) {
    zlib.gzip(body, (err, compressed) => {
      if (err) {
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'public, max-age=15'
        });
        return res.end(body);
      }
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.length,
        'Cache-Control': 'public, max-age=15'
      });
      res.end(compressed);
    });
  } else {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=15'
    });
    res.end(body);
  }
}

function sendFile(req, res, filePath) {
  fs.stat(filePath, (statErr, stat) => {
    if (statErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const lastModified = stat.mtime.toUTCString();

    // no-cache: browsers/CDN must revalidate (cheap thanks to Last-Modified/304).
    // This prevents stale assets (e.g. app.js) being served for hours after a deploy.
    const cacheHeaders = { 'Cache-Control': 'no-cache, must-revalidate', 'Last-Modified': lastModified };

    const ims = req && req.headers && req.headers['if-modified-since'];
    if (ims && Date.parse(ims) >= Math.floor(stat.mtimeMs) - 1000) {
      res.writeHead(304, cacheHeaders);
      return res.end();
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        ...cacheHeaders,
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': data.length
      });
      res.end(data);
    });
  });
}

const LANG_CODES = new Set(LANGUAGES.map((l) => l.code));
const isLang = (code) => LANG_CODES.has(code);

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const parts = pathname.split('/').filter(Boolean);

  try {
    // Main page
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    }

    // API
    if (req.method === 'GET' && parts[0] === 'api') {
      // /api/languages
      if (parts[1] === 'languages') {
        return sendJSON(req, res, 200, { languages: LANGUAGES });
      }

      // /api/changes/:lang[/:date]
      if (parts[1] === 'changes' && parts[2]) {
        const lang = parts[2];
        if (!isLang(lang)) return sendJSON(req, res, 404, { error: 'unknown language' });
        if (parts[3]) {
          const date = parts[3];
          const day = store.getDay(lang, date);
          return sendJSON(req, res, 200, { lang, date, count: day.length, changes: day });
        }
        const idx = store.getIndex(lang);
        return sendJSON(req, res, 200, {
          lang,
          lastTimestamp: idx.lastTimestamp,
          lastPoll: idx.lastPoll,
          days: idx.days
        });
      }

      // /api/raw/:lang/:date  (download the raw JSON for a given day)
      if (parts[1] === 'raw' && parts[2] && parts[3]) {
        const lang = parts[2];
        const date = parts[3];
        if (!isLang(lang)) return sendJSON(req, res, 404, { error: 'unknown language' });
        const day = store.getDay(lang, date);
        const body = JSON.stringify(day, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="tarkov-wiki-${lang}-${date}.json"`
        });
        return res.end(body);
      }

      // /api/seed-history[/:lang] -> Trigger full history fetch from MediaWiki API
      if (parts[1] === 'seed-history') {
        const { fetchFullWikiHistory, main: fetchAll } = require('./fetch-history');
        if (parts[2]) {
          const lang = parts[2];
          if (!isLang(lang)) return sendJSON(req, res, 404, { error: 'unknown language' });
          fetchFullWikiHistory(lang).catch((e) => console.error('[seed-history] error:', e));
          return sendJSON(req, res, 200, { ok: true, message: `Full history seed started for ${lang}` });
        }
        fetchAll().catch((e) => console.error('[seed-history] error:', e));
        return sendJSON(req, res, 200, { ok: true, message: 'Full history seed started for all 10 wikis' });
      }

      // /api/export            -> rebuild + report every base/<lang>.json
      if (parts[1] === 'export' && !parts[2]) {
        const results = exporter.buildAll(LANGUAGES.map((l) => l.code));
        return sendJSON(req, res, 200, { ok: true, generatedAt: new Date().toISOString(), wikis: results });
      }
      // /api/export/:lang      -> rebuild + download one base file
      if (parts[1] === 'export' && parts[2]) {
        const lang = parts[2];
        if (!isLang(lang)) return sendJSON(req, res, 404, { error: 'unknown language' });
        const base = exporter.buildLanguageBase(lang) || { lang, generatedAt: null, count: 0, changes: [] };
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="base-${lang}.json"`
        });
        return res.end(JSON.stringify(base, null, 2));
      }

      // /api/live/:lang  (SSE live stream)
      if (parts[1] === 'live' && parts[2]) {
        const lang = parts[2];
        if (!isLang(lang)) {
          res.writeHead(404);
          return res.end('unknown language');
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write('retry: 3000\n\n');

        const idx = store.getIndex(lang);
        res.write(
          `data: ${JSON.stringify({
            type: 'snapshot',
            lang,
            lastTimestamp: idx.lastTimestamp,
            lastPoll: idx.lastPoll,
            days: idx.days,
            clients: clientCount(lang)
          })}\n\n`
        );

        const unsub = addSubscriber(lang, res);
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch (_) {
            /* ignore */
          }
        }, 25000);

        req.on('close', () => {
          clearInterval(ping);
          unsub();
        });
        return;
      }

      return sendJSON(req, res, 404, { error: 'unknown endpoint' });
    }

    // Static files (public/)
    if (req.method === 'GET') {
      const filePath = path.join(PUBLIC_DIR, pathname);
      const rel = path.relative(PUBLIC_DIR, filePath);
      if (!rel.startsWith('..') && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return sendFile(req, res, filePath);
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    console.error('[server] error', e);
    if (!res.headersSent) sendJSON(req, res, 500, { error: String(e && e.message) });
    else res.end();
  }
});

server.listen(PORT, () => {
  if (!global.fetch) {
    console.log('[server] ATTENTION : Node < 18 (fetch global absent). Mettez a jour Node.');
  }
  console.log(`Tarkov Wiki Changes -> http://localhost:${PORT}`);
  poller.start().catch((e) => console.error('[poller] startup failed:', e));
});

function shutdown() {
  console.log('\n[server] shutting down...');
  poller.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = server;
