'use strict';
// Manual per-wiki base export — run:  node export.js
// Writes the complete history of every wiki to base/<lang>.json so it can
// be committed to GitHub.
const { LANGUAGES } = require('./src/config');
const { buildAll } = require('./src/export');

const results = buildAll(LANGUAGES.map((l) => l.code));
for (const r of results) {
  console.log(`base/${r.lang}.json  —  ${r.count} changes`);
}
console.log('done.');