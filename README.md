# Wiki-changes

> Real-time activity monitor for the ten language editions of the **Escape from Tarkov** Fandom wiki.

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-2e7d32)
![Dependencies](https://img.shields.io/badge/Dependencies-Zero-1976d2)
![Language](https://img.shields.io/badge/Language-JavaScript-f1e05a)
![Data source](https://img.shields.io/badge/Data%20source-Fandom%20MediaWiki%20API-6a5acd)
![License](https://img.shields.io/badge/License-MIT-444444)

The Fandom `recentchanges` feed of every language edition is polled continuously and
persisted locally. The web UI shows **one line per tracked day** (total changes, breakdown
by change type, activity bar) and a **detailed page per day** grouped by change type, with
author, page name and byte diff. New changes stream to the open page in real time.

## Supported wikis

| Code  | Language             |
|-------|----------------------|
| `en`  | English              |
| `cs`  | Čeština              |
| `de`  | Deutsch              |
| `es`  | Español              |
| `fr`  | Français             |
| `ko`  | 한국어                |
| `pl`  | Polski               |
| `pt-br` | Português do Brasil |
| `ru`  | Русский              |
| `zh`  | 中文                 |

## Features

- **One tab per wiki** — ten tabs, one per language edition, each with a live activity badge.
- **One line per day** — weekday, day number, month, change count, color-coded type chips
  (Edits, Created, Deletions, Patrols, Uploads…) and a proportional activity bar.
  Grouped by month, newest first. Today is highlighted.
- **Day detail page** — clicking a line opens the day: changes grouped by type with author,
  page link, byte diff (`+`/`−`), minor-edit flag and edit comment.
- **Live updates** — new changes are pushed over **SSE** (`/api/live/<lang>`); the affected
  day line flashes and any open detail view refreshes.
- **Raw data export** — one click downloads the full day's JSON (`/api/raw/:lang/:date`).
- **Zero dependencies** — only Node.js built-ins (`http`, `fs`); nothing to install.

## Quick start

```bash
node server.js
# → http://localhost:3000
```

Requires **Node.js ≥ 18** (global `fetch`). On first start the app backfills recent
history for all ten wikis, then polls every 5 minutes (300 000 ms).
## Configuration

All settings are environment variables (all optional).

| Variable               | Default   | Description                                        |
|------------------------|-----------|----------------------------------------------------|
| `PORT`                 | `3000`    | HTTP port                                          |
| `POLL_INTERVAL_MS`     | `300000`  | Polling interval in milliseconds (5 minutes)       |
| `INITIAL_LOOKBACK_DAYS`| `30`      | History backfilled on first start (days)           |
| `MAX_SEED_CHANGES`     | `4000`    | Backfill cap per wiki (entries)                    |
| `DATA_DIR`             | `./data`  | Where JSON storage lives                            |

## Storage

Plain local **JSON** — no database, no external service, no API keys. The backfill and the
poller append to it continuously (changes are deduplicated by `rcid`).

```
data/<lang>/index.json          → per-day summary  { date: {count, byType} }
data/<lang>/<YYYY-MM-DD>.json   → the day's normalized changes
```

The `data/` directory is git-ignored.

> **Production tip**: mount a persistent volume on `DATA_DIR` (default `./data`,
> i.e. `/app/data` in a typical Coolify deploy). Without it, every redeploy starts
> from an empty store and the full history (since 2015) has to be re-fetched from
> the MediaWiki API. The fetch is incremental (days reappear progressively), but a
> volume keeps history instantly available across restarts.

## API

| Endpoint                          | Description                                   |
|-----------------------------------|-----------------------------------------------|
| `GET /api/languages`              | List of monitored wikis                       |
| `GET /api/changes/<lang>`         | Calendar summary (per-day counts + byType)    |
| `GET /api/changes/<lang>/<date>`  | Detailed changes for one day                  |
| `GET /api/raw/<lang>/<date>`      | Download the day's raw JSON                   |
| `GET /api/live/<lang>`            | SSE stream (real-time changes)                |

## Data model

A stored change looks like this:

```json
{
  "rcid": 426740,
  "type": "edit",
  "category": "edit",
  "title": "To the Light - False Call",
  "ns": 0,
  "user": "VictoriousLion975",
  "timestamp": "2026-09-13T03:09:48Z",
  "date": "2026-09-13",
  "oldlen": 4925,
  "newlen": 4828,
  "diff": -97,
  "minor": false,
  "bot": false,
  "comment": "updated task requirements...",
  "pageUrl": "https://escapefromtarkov.fandom.com/en/wiki/To_the_Light_-_False_Call",
  "diffUrl": "https://escapefromtarkov.fandom.com/en/wiki/To_the_Light_-_False_Call?oldid=358911"
}
```

`category` maps the MediaWiki change types (`edit`, `new`, logs…) onto display buckets:
`edit`, `creation`, `deletion`, `upload`, `move`, `patrol`, `protection`, `block`,
`rights`, `merge`, `newusers`, `import`, `log`, `other`.

## Project structure

```
server.js            HTTP server, REST API + SSE
src/config.js        monitored languages, tunables
src/fetcher.js       Fandom recentchanges client (with timeout)
src/store.js         JSON storage layer
src/poller.js        polling loop (backfill + incremental)
src/live.js          SSE subscriber management
public/              web UI (HTML/CSS/JS, no framework)
data/                generated JSON storage (git-ignored)
```

## License

[MIT](./LICENSE)

## Disclaimer

Not affiliated with Fandom, Inc. or Battlestate Games. Data comes from the public
MediaWiki `recentchanges` API. Poll politely.
