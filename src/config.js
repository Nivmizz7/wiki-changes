'use strict';

const path = require('path');

// Monitored languages (verified Fandom path codes: escapefromtarkov.fandom.com/<code>/api.php)
const LANGUAGES = [
  { code: 'en',    label: 'English' },
  { code: 'cs',    label: 'Čeština' },
  { code: 'de',    label: 'Deutsch' },
  { code: 'es',    label: 'Español' },
  { code: 'fr',    label: 'Français' },
  { code: 'ko',    label: '한국어' },
  { code: 'pl',    label: 'Polski' },
  { code: 'pt-br', label: 'Português do Brasil' },
  { code: 'ru',    label: 'Русский' },
  { code: 'zh',    label: '中文' }
];

const FANDOM_BASE = 'https://escapefromtarkov.fandom.com';

// Poll interval (ms) — 5 minutes
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 300000;

// Initial history fetched at startup (in days) to backfill the timeline
const INITIAL_LOOKBACK_DAYS = Number(process.env.INITIAL_LOOKBACK_DAYS) || 30;

// Max changes fetched at startup (per wiki) to avoid flooding
const MAX_SEED_CHANGES = Number(process.env.MAX_SEED_CHANGES) || 4000;

const PORT = Number(process.env.PORT) || 3000;

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

// Exported per-wiki dumps committed to GitHub (base/<lang>.json)
const BASE_DIR = process.env.BASE_DIR
  ? path.resolve(process.env.BASE_DIR)
  : path.join(__dirname, '..', 'base');

// Polite User-Agent for the Fandom API
const USER_AGENT = process.env.USER_AGENT || 'TarkovWikiChanges/1.0 (wiki activity monitor; contact: local)';

module.exports = {
  LANGUAGES,
  FANDOM_BASE,
  POLL_INTERVAL_MS,
  INITIAL_LOOKBACK_DAYS,
  MAX_SEED_CHANGES,
  PORT,
  DATA_DIR,
  BASE_DIR,
  USER_AGENT
};
