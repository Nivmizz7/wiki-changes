'use strict';

// SSE (Server-Sent Events) subscriber management, per wiki language.
// Each client opens an EventSource on /api/live/<lang>; we push new
// changes to them in real time.

const subscribers = Object.create(null); // lang -> Set<ServerResponse>

function addSubscriber(lang, res) {
  if (!subscribers[lang]) subscribers[lang] = new Set();
  subscribers[lang].add(res);
  return function remove() {
    const set = subscribers[lang];
    if (set) set.delete(res);
  };
}

function broadcast(lang, event) {
  const set = subscribers[lang];
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (_) {
      /* ignore broken pipe */
    }
  }
}

function clientCount(lang) {
  return subscribers[lang] ? subscribers[lang].size : 0;
}

module.exports = { addSubscriber, broadcast, clientCount };
