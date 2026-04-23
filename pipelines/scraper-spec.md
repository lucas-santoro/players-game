# Transfermarkt Scraper — Spec (from-scratch implementation)

> **Audience**: an agent (or human) building this in parallel to MVP development.
> **Status**: green-field. Replaces an attempt to use [`dcaribou/transfermarkt-scraper`](https://github.com/dcaribou/transfermarkt-scraper) which has unresolved issues with its Crawlee-based autoscaled pool (see "Why not dcaribou" below).
> **Owner**: background agent. Output integrates with the main game project at the migration step (Phase 5).

---

## 1. Goal

Produce a **complete, resumable, reproducible** dataset of Transfermarkt entities — competitions, clubs, players, transfers, appearances, photos — extractable on a home server over weeks of unattended runtime, surviving power loss and bot-detection.

The deliverable is a directory of JSON Lines files plus an SQLite crawl-state DB,
ready for ingestion into the main project's Postgres via a separate ETL step.

### Scope

Everything in [`dcaribou/transfermarkt-scraper`](https://github.com/dcaribou/transfermarkt-scraper)'s
output: `confederations`, `competitions`, `countries`, `clubs`, `players`,
`national_teams`, `appearances`, `tournament_editions`, `games`, `game_lineups`.
Plus **player photos** (separate phase). Plus **player market value time series**.

### Out of scope

- Real-time updates / change detection (initial dump only)
- Filling the Postgres database directly (that's the main project's ETL)
- Hosting an API on top of the data

---

## 2. Why not dcaribou

We tried to use `dcaribou/transfermarkt-scraper@0.5.0` and hit:

1. **Autoscaled pool starvation** in `crawlee-python`'s `ParselCrawler`: first request succeeds (after a 22s delay), then `current_concurrency` drops to 0 with 20 pending requests, no failed requests, no log output, indefinitely. Reproduces on WSL2/Ubuntu. Direct `curl` to the same TM URL returns 200 immediately — so it's not bot detection.
2. **No documented resume mechanism** for the new architecture (storage dir behavior is unclear; we couldn't verify whether resume preserves state across restarts).
3. **High coupling to a specific Crawlee version**, with bugs that need either upstream fixes or a fork — not a path we can promise to support.
4. **HTTP-only crawling** (Parsel) doesn't render JS and is more vulnerable to TM's evolving anti-bot.

So: build our own, with simpler/older mechanics we can fully understand and operate.

---

## 3. Stack decisions

| Concern | Pick | Rationale |
|---|---|---|
| Browser automation | **Playwright** for Python, with **Patchright** patches for stealth | TM increasingly serves anti-bot challenges. Real browser bypasses 99% of them. |
| HTTP client (image downloads) | `httpx` | Async, modern, plays nicely with `asyncio`. |
| Concurrency | `asyncio` with bounded `Semaphore` | Simpler than a full async framework; we control the dispatch loop directly. |
| State store | **SQLite** (via `aiosqlite`) | One file, zero ops, atomic via WAL, perfectly idempotent. No separate service to babysit. |
| Output format | **JSON Lines** (one file per asset kind) | Streams cleanly, append-friendly, dedupable with `jq`/`sort -u`. |
| Process supervision (server) | `systemd --user` units | Reboots gracefully, restarts on failure, integrates with `journalctl`. |
| Packaging | `uv` + `pyproject.toml` | Matches the rest of the project. Fast. |
| Python | 3.13 | Matches `pipelines/Dockerfile`. |

**Anti-pattern we explicitly avoid**: any Crawlee-based or Scrapy-based framework.
The autoscaled pool / event-driven dispatch model has been the source of every
problem we've seen. We dispatch our own work loop; it's ~80 LoC and bulletproof.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        scrape orchestrator                       │
│                                                                  │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ url_queue  │───▶│  worker_pool │───▶│  per-kind extractors │  │
│  │ (SQLite)   │◀───│   (asyncio)  │◀───│  (parse HTML → dict) │  │
│  └────────────┘    └──────────────┘    └──────────────────────┘  │
│         │                                          │              │
│         │                                          ▼              │
│         │                              ┌──────────────────────┐   │
│         │                              │  output/<kind>.jsonl │   │
│         │                              │   (append-only)      │   │
│         │                              └──────────────────────┘   │
│         ▼                                                         │
│   discovery: each extractor enqueues child URLs (e.g.             │
│   competition → clubs URLs) with a `kind` tag.                    │
└──────────────────────────────────────────────────────────────────┘
```

### Components

- **`url_queue`** — SQLite table:
  ```sql
  CREATE TABLE url_queue (
      url TEXT PRIMARY KEY,
      kind TEXT NOT NULL,           -- 'competition', 'club', 'player', etc.
      status TEXT NOT NULL,         -- 'pending', 'in_progress', 'done', 'failed'
      attempt_count INTEGER NOT NULL DEFAULT 0,
      enqueued_at INTEGER NOT NULL, -- unix ms
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      parent_url TEXT,              -- nullable; for traceability
      season INTEGER                -- nullable; for season-scoped pages
  );
  CREATE INDEX idx_status ON url_queue(status, kind);
  ```
  The queue is the single source of truth. All workers read/write through it under a small set of stored procedures (`pop_one(kind)`, `mark_done(url, item_id)`, `mark_failed(url, error)`, `enqueue(url, kind, parent_url, season)`).

- **`worker_pool`** — bounded `asyncio.Semaphore` (configurable, default 4 workers). Each worker loops:
  1. `pop_one(any kind)` returns a URL or sleeps if empty
  2. fetch the page (Playwright context, see below)
  3. dispatch to the per-kind extractor
  4. extractor returns `(item: dict, child_urls: list[(url, kind)])`
  5. write item to `output/<kind>.jsonl` (append, fsync every N items)
  6. enqueue children
  7. `mark_done(url)`

- **per-kind extractors** — pure functions: `(html_or_page) -> (item, children)`.
  Implemented as `extractors/<kind>.py`. Easy to test in isolation with saved HTML samples.

- **stale-sweep job** — every 5 min, re-marks `in_progress` URLs older than `STUCK_THRESHOLD` (default 10 min) as `pending`. Handles workers that died without cleanup.

### Browser pool

- One `Playwright` instance, one `BrowserContext` per worker (sharing cookies within a worker, isolating across workers — TM uses session cookies).
- After every N requests per context (default 50), recycle the context to avoid long-lived fingerprint accumulation.
- Use `patchright` (or `playwright-stealth`) to remove `webdriver`/`navigator.webdriver` hints and other Playwright fingerprints.

---

## 5. Data model — output JSONL schemas

These map directly to the main project's Drizzle schema at
`apps/web/drizzle/schema.ts` (already defined). Keep field names aligned to
make ETL trivial.

### `competitions.jsonl`
```json
{
  "tm_id": "GB1",
  "name": "Premier League",
  "country_id": "189",
  "country_name": "England",
  "tier": "first_tier",
  "is_top5_european": true,
  "href": "/premier-league/startseite/wettbewerb/GB1",
  "scraped_at": 1714512000
}
```

### `clubs.jsonl`
```json
{
  "tm_id": 281,
  "name": "Manchester City",
  "competition_id": "GB1",
  "country_id": "189",
  "stadium": "Etihad Stadium",
  "stadium_seats": 53400,
  "founding_year": 1880,
  "coach_name": "Pep Guardiola",
  "href": "/manchester-city/startseite/verein/281",
  "scraped_at": 1714512000
}
```

### `players.jsonl`
```json
{
  "tm_id": 28003,
  "name": "Lionel Messi",
  "slug": "lionel-messi",
  "dob": "1987-06-24",
  "height_cm": 170,
  "foot": "left",
  "primary_position": "RW",
  "generic_position": "FWD",
  "current_club_id": 583,
  "current_jersey_number": 10,
  "market_value_eur": 30000000,
  "country_id": "5",
  "country_name": "Argentina",
  "is_active": true,
  "image_url": "https://img.a.transfermarkt.technology/portrait/header/28003-1710080339.jpg",
  "href": "/lionel-messi/profil/spieler/28003",
  "scraped_at": 1714512000
}
```

### `transfers.jsonl`
```json
{
  "player_tm_id": 28003,
  "from_club_tm_id": 131,
  "to_club_tm_id": 583,
  "season": 2023,
  "transfer_date": "2023-07-15",
  "fee_eur": 0,
  "transfer_type": "free",
  "scraped_at": 1714512000
}
```

### `market_values.jsonl`
```json
{
  "player_tm_id": 28003,
  "as_of": "2024-09-01",
  "value_eur": 25000000,
  "club_tm_id": 583,
  "scraped_at": 1714512000
}
```

### `trophies.jsonl`
```json
{
  "player_tm_id": 28003,
  "trophy_name": "UEFA Champions League",
  "trophy_scope": "uefa",
  "year": 2015,
  "club_tm_id": 131,
  "scraped_at": 1714512000
}
```

### `appearances.jsonl`
```json
{
  "player_tm_id": 28003,
  "game_tm_id": 4123456,
  "competition_tm_id": "GB1",
  "season": 2023,
  "minutes": 87,
  "goals": 1,
  "assists": 2,
  "yellow": 0,
  "red": 0,
  "scraped_at": 1714512000
}
```

### `games.jsonl`
```json
{
  "tm_id": 4123456,
  "competition_tm_id": "GB1",
  "season": 2023,
  "matchday": 1,
  "kickoff": "2024-08-17T16:30:00Z",
  "home_club_tm_id": 281,
  "away_club_tm_id": 985,
  "home_goals": 2,
  "away_goals": 0,
  "venue": "Etihad Stadium",
  "attendance": 53210,
  "scraped_at": 1714512000
}
```

(`countries.jsonl`, `national_teams.jsonl`, `confederations.jsonl`, `tournament_editions.jsonl`,
`game_lineups.jsonl` follow the same pattern — model after the dcaribou samples
in their `samples/` directory but keep these field names where they overlap.)

---

## 6. Crawl strategy & traversal

Two parallel hierarchies, mirroring TM's site structure:

### Club football
```
Confederations → Competitions → Clubs → Players → Appearances
                              → Games  → Game Lineups
                              → Tournament Editions → Games
```

### International football
```
Confederations → Countries → National Teams → Players → Appearances
              → Competitions (national-team comps: World Cup, Euros)
```

### Seed URLs
Bootstrap with these (no external dependencies):
- `https://www.transfermarkt.co.uk/wettbewerbe/europa`
- `https://www.transfermarkt.co.uk/wettbewerbe/amerika`
- `https://www.transfermarkt.co.uk/wettbewerbe/asien`
- `https://www.transfermarkt.co.uk/wettbewerbe/afrika`
- `https://www.transfermarkt.co.uk/wettbewerbe/fifa`

Each yields competitions, which fan out to clubs, etc.

### Historical seasons

For `clubs`, we want **all historical squads** (not just current) to capture
full transfer history and player-club relationships across time. Append
`?saison_id={year}` to each club URL for years 1990..current. Mark the URL with
`season` field in the queue. Cap historical depth: 1990 onwards is plenty; older
TM data is sparse anyway.

### URL canonicalization

Strip tracking params, normalize trailing slashes, lowercase domain. Prevents
duplicate enqueuing of the same logical URL.

---

## 7. Anti-bot strategy

Transfermarkt uses Cloudflare + custom challenges. Strategy:

1. **Use Playwright with patchright stealth patches**. Real Chromium engine bypasses
   most JS-based challenges out of the box.

2. **Realistic User-Agent rotation** — pool of 5-10 modern Chrome UAs. Rotate per context, not per request.

3. **Random delays**: 2-5s between requests within a worker (`random.uniform(2, 5)`).
   Combined with 4 workers = effective ~1 req/sec aggregate, well within TM's tolerance.

4. **Respect 429 / 503 responses**: exponential backoff. After 3 consecutive 429s, pause that worker for 10 minutes.

5. **No Accept-Language=en-US,en;q=0.9 only** — vary slightly. TM serves localized content; matching `en-US` consistently is fine.

6. **Don't crawl `/search`, `/leistungsdaten`** without need — these are heavier endpoints. We only hit player profile + transfers + appearances pages.

7. **Cookies**: accept all on first page load (TM cookie consent banner). After that, the browser context handles them naturally.

8. **If banned**: pivot to residential proxies (Bright Data, Smartproxy, ~$50/mo for unlimited bandwidth). Implementation hook: each `BrowserContext` accepts a `proxy={...}` arg. Don't add proxies prematurely — only if the IP-only approach fails.

### How we know we're being blocked

- Repeated 429 / 503 / 403 status codes
- HTML body containing "Just a moment" / "Cloudflare" / "Verify you are human"
- Captcha images served instead of content

The crawler should detect these and:
- Decrement worker concurrency
- Increase delay
- Open a fresh browser context (new fingerprint)
- After 30 minutes of consistent blocking, **pause and email/notify** rather than burn IP reputation indefinitely

---

## 8. Resume / resilience

This is the **most important** non-functional requirement. The home server
will reboot, the SSD might hiccup, the network might flap. Resume must be bulletproof.

### Resume mechanism

1. **All state in SQLite (`crawl_state.db`).** Workers read/write under transactions.
   On crash, the file is consistent (WAL mode).

2. **Output JSONL writes are append-only with `fsync` per write.**
   Crash mid-write at worst leaves a partial line, which we drop on next read
   via a `try: json.loads(line) except: skip`.

3. **Stale-sweep**: a separate task wakes every 5 min, queries
   `SELECT url FROM url_queue WHERE status='in_progress' AND started_at < now() - 600000`
   and resets them to `pending`.

4. **Idempotent extractors**: an extractor must produce the same `(item, children)`
   for the same URL+season combination. Re-running an item appends it to JSONL —
   we dedupe at ETL time via `(kind, tm_id)` (or `(player_tm_id, as_of)` for
   timeseries). Don't try to dedupe in JSONL during crawling; it adds complexity
   for no gain.

5. **Process supervision via systemd**: see Section 12.

### Failure semantics

- A URL that fails 5 times (`attempt_count >= 5`) is marked `failed` and skipped.
  A separate report lists failed URLs at end-of-run for human inspection.
- A URL that hits a `404 Not Found` is marked `done` with empty output (no item).
  Don't retry permanent failures.

---

## 9. Storage layout

```
~/scrapes/tm/                           # on the home server
├── crawl_state.db                      # SQLite: url_queue, run_metadata
├── crawl_state.db-wal                  # WAL files
├── crawl_state.db-shm
├── output/
│   ├── confederations.jsonl
│   ├── competitions.jsonl
│   ├── countries.jsonl
│   ├── clubs.jsonl
│   ├── national_teams.jsonl
│   ├── tournament_editions.jsonl
│   ├── games.jsonl
│   ├── game_lineups.jsonl
│   ├── players.jsonl
│   ├── transfers.jsonl
│   ├── market_values.jsonl
│   ├── trophies.jsonl
│   └── appearances.jsonl
├── photos/
│   ├── 28003.jpg                       # by tm_id
│   ├── 12345.jpg
│   └── ...
├── logs/
│   ├── orchestrator.log
│   └── ...
└── samples/                            # saved HTML for offline parser tests
    ├── player-28003.html
    ├── club-281.html
    └── ...
```

### Disk budget

- `crawl_state.db`: ~500 MB at full scale (1M players, ~5M URLs total)
- `output/` JSONL: 10-15 GB without appearances; 50-80 GB with
- `photos/`: ~50 GB at 50 KB avg × 1M
- **Total**: ~120 GB peak, fits in the 100+ GB the user has allocated *if*
  appearances or photos are ingested in chunks rather than dumped all at once.

---

## 10. Project layout (the scraper itself)

```
pipelines/
└── scraper/                            # NEW — built by background agent
    ├── pyproject.toml
    ├── README.md                       # how to run locally and on server
    ├── src/
    │   └── tm_scraper/
    │       ├── __init__.py
    │       ├── __main__.py             # CLI entry: `python -m tm_scraper run`
    │       ├── config.py               # tunables (concurrency, delays, paths)
    │       ├── queue.py                # SQLite-backed work queue
    │       ├── browser.py              # Playwright pool with stealth patches
    │       ├── orchestrator.py         # main loop
    │       ├── stale_sweep.py
    │       ├── photos.py               # photo-download phase (separate command)
    │       ├── extractors/
    │       │   ├── __init__.py
    │       │   ├── confederations.py
    │       │   ├── competitions.py
    │       │   ├── countries.py
    │       │   ├── clubs.py
    │       │   ├── national_teams.py
    │       │   ├── players.py
    │       │   ├── transfers.py        # parsed off the player profile
    │       │   ├── market_values.py    # parsed off the player profile
    │       │   ├── trophies.py         # parsed off the player profile
    │       │   ├── tournament_editions.py
    │       │   ├── games.py
    │       │   ├── game_lineups.py
    │       │   └── appearances.py
    │       └── utils.py
    ├── tests/
    │   ├── samples/
    │   │   ├── player-28003.html
    │   │   ├── club-281.html
    │   │   └── ... (saved HTML, ~5-10 per kind)
    │   ├── test_extractors_players.py
    │   ├── test_extractors_clubs.py
    │   ├── test_queue.py
    │   └── test_resume.py              # integration: kill mid-run, restart, assert no dupes
    └── deployment/
        ├── tm-scraper.service          # systemd user unit
        └── README.md
```

---

## 11. CLI surface

```bash
# Initialize a fresh crawl (creates DB, seeds confederations URLs).
python -m tm_scraper init --output ~/scrapes/tm

# Run the crawl (blocks; resumes if state already exists).
python -m tm_scraper run --output ~/scrapes/tm --workers 4

# Run a single kind only (useful to backfill).
python -m tm_scraper run --output ~/scrapes/tm --only-kind players

# Status: print queue stats by kind/status.
python -m tm_scraper status --output ~/scrapes/tm

# Re-queue all 'failed' URLs for another attempt.
python -m tm_scraper retry --output ~/scrapes/tm

# Photo download phase (after main crawl is mostly done).
python -m tm_scraper photos --output ~/scrapes/tm --workers 8 --rate 5

# Reparse: re-extract from cached HTML if extractors changed (fast, no network).
python -m tm_scraper reparse --output ~/scrapes/tm --kind players

# Smoke-test against TM with 1 known URL (e.g. Lionel Messi).
python -m tm_scraper test-fetch --url https://www.transfermarkt.co.uk/lionel-messi/profil/spieler/28003
```

---

## 12. Server deployment

### Prereqs
```bash
sudo apt install -y python3.13 python3.13-venv git
curl -LsSf https://astral.sh/uv/install.sh | sh
loginctl enable-linger $USER
```

### Setup
```bash
git clone <our project> ~/projects/players-game
cd ~/projects/players-game/pipelines/scraper
uv sync
uv run playwright install chromium

mkdir -p ~/scrapes/tm
uv run python -m tm_scraper init --output ~/scrapes/tm
```

### systemd user unit (`~/.config/systemd/user/tm-scraper.service`)
```ini
[Unit]
Description=Transfermarkt scraper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/projects/players-game/pipelines/scraper
Environment="HOME=%h"
ExecStart=%h/projects/players-game/pipelines/scraper/.venv/bin/python -m tm_scraper run \
    --output %h/scrapes/tm \
    --workers 4
Restart=always
RestartSec=60

# Resource limits — be a good citizen.
MemoryMax=4G
CPUQuota=80%

# Logging to journal.
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tm-scraper

[Install]
WantedBy=default.target
```

Enable:
```bash
systemctl --user daemon-reload
systemctl --user enable --now tm-scraper.service
journalctl --user -u tm-scraper.service -f      # live logs
```

A second unit `tm-scraper-photos.service` mirrors this for the photo-download phase, gated by an `After=` on the main scraper having reached a stable state (or run manually after).

---

## 13. Testing strategy

### Unit (fast, offline)
- Each extractor parses a saved HTML sample → asserts every output field present
  and well-typed.
- Run on every PR / pre-commit. < 1s total.

### Integration (slow, online)
- `test-fetch` against 5 known URLs (1 per kind). Asserts the live extractor
  output matches a frozen golden fixture (modulo `scraped_at`). Run weekly to
  catch TM HTML schema drift.

### Resume test (medium, online)
- Run the orchestrator with workers=2 against 1 confederation, kill -9 it
  after ~30s, restart, assert: no duplicate items in JSONL when deduped by
  `(kind, tm_id)`, and `done` count grows monotonically.

### Anti-bot test
- Crawl 100 player URLs in a row at low concurrency. Assert 0 / very few `failed`.
  If TM starts blocking aggressively, this test catches it before a 2-week run does.

---

## 14. Build plan (phases)

> Each phase ends with a runnable, testable artifact. **Don't move to the next
> phase until the previous one's tests pass.**

### Phase 1 — skeleton + queue
- Project scaffold, `pyproject.toml`, `uv sync`.
- `queue.py` with full schema, transactions, `pop_one`, `enqueue`,
  `mark_done`, `mark_failed`.
- `tests/test_queue.py` covering concurrent enqueue/pop with multiple async tasks.
- CLI: `init` and `status` commands work.

### Phase 2 — browser + first extractor
- `browser.py` with patchright. Returns a `BrowserContext` factory.
- `extractors/confederations.py` — extracts the 5 confederations from `/wettbewerbe/europa` and friends.
- Test: `test-fetch` against the live page, save HTML sample, assert 5 items.

### Phase 3 — orchestrator + 1 hierarchy depth
- `orchestrator.py`: main async loop, worker pool, dispatch by kind.
- Run end-to-end: confederations → competitions. Should produce
  ~200 competitions in `output/competitions.jsonl`.
- Resume test passes for this scope.

### Phase 4 — full club-football tree
- Add extractors for `clubs`, `players`, `transfers`, `market_values`, `trophies`.
- Run scoped to Premier League only (1 competition). Should produce
  ~20 clubs, ~500 players, ~5000 transfers.
- All unit tests + resume test pass.

### Phase 5 — international + games + appearances
- Add `countries`, `national_teams`, `tournament_editions`, `games`,
  `game_lineups`, `appearances`.
- Run scoped to UEFA Euro 2024 + Premier League 2023/24. Spot-check counts
  vs Transfermarkt's published totals.

### Phase 6 — photos
- `photos.py` standalone command. Reads `players.jsonl`, downloads each
  `image_url` to `photos/<tm_id>.jpg` with atomic rename.
- Idempotent: re-run skips existing files.

### Phase 7 — server deployment
- Write systemd units, README for the server.
- Smoke test on the home server: 24h run, monitor `journalctl`, confirm
  `done` count grows linearly without stalls.

### Phase 8 — full production run
- Kick off the full multi-week run. Monitor weekly.
- Final deliverable: complete `output/` directory + `photos/` directory.

---

## 15. Migration path back into the main project

When the scrape is **stable and producing data**, but **before completion**, the
main project's data team (us) writes:

`pipelines/src/pipelines/ingest_tm.py`

It:
1. Reads each `<kind>.jsonl` from a configurable input dir (rsync from server).
2. Dedupes by natural key per kind (`tm_id`, or composite for timeseries).
3. Upserts into the existing Postgres schema (`apps/web/drizzle/schema.ts`)
   with `INSERT ... ON CONFLICT DO UPDATE`.
4. Builds the `player_teammates` table from `transfers` (this is project-side,
   not scraper-side).
5. Idempotent — re-running with newer JSONL just updates changed fields.

This is a separate work item and **lives in the main project**, not in the scraper.

---

## 16. Definition of done

The scraper is "done enough to ship to the server" when:

- [x] All extractors implemented (Phase 5 complete).
- [x] Resume test passes consistently after kill -9.
- [x] 24h dry run on dev machine: ≥ 80k items completed, < 1% `failed`.
- [x] systemd unit boots, restarts, survives a manual reboot of the dev VM.
- [x] Photo downloader idempotent test passes.
- [x] README documents: install, init, run, status, retry, photos, troubleshooting.

The scraper is "done at production scale" when:

- [x] Full club-football hierarchy completed on server (~5M URLs).
- [x] Full international hierarchy completed.
- [x] Player photos downloaded for ≥ 90% of `players.jsonl`.
- [x] All `failed` URLs reviewed; no systemic extractor bugs.
- [x] `output/` rsync'd to dev machine and ingested via main project's ETL.

---

## 17. Open questions / future improvements

- **Browser headless mode**: start with `headless=True` for speed. Switch to
  `headless=False + xvfb` if anti-bot pressure increases.
- **Proxy rotation**: not needed initially. Implementation hook ready in `browser.py`.
- **Snapshot-based resume**: take a btrfs/zfs snapshot of `~/scrapes/tm/` daily.
  Cheap insurance if the SQLite ever corrupts.
- **Notification on stall**: ping a Discord webhook if `requests_per_minute`
  drops below threshold for > 30 min. Useful since the run is multi-week.
- **Re-scrape policy**: post-MVP, decide cadence for refresh (player market
  values change weekly; transfers happen daily during windows). Not in scope here.

---

## 18. Notes on the abandoned dcaribou attempt

Lessons preserved for future consideration:

- `crawlee-python`'s `ParselCrawler` autoscaled pool can starve silently — no log,
  no error, just `current_concurrency = 0` indefinitely. Reproduced on multiple
  Linux distros (Ubuntu 24, WSL2). Filed: not yet.
- Their `samples/competitions.json` uses `country_code` for the league id (e.g.
  `"country_code": "GB1"`), not `competition_code`. Worth knowing if anyone
  goes back to that codebase.
- Their refactor from Scrapy to Crawlee is recent and not yet stable. If
  picked up again, pin to a known-good earlier version (Scrapy-based, pre-0.5.0).
