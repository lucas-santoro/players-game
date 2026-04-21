# Kaggle dataset drop folder

Drop the CSVs from
[davidcariboo/player-scores](https://www.kaggle.com/datasets/davidcariboo/player-scores)
into this directory.

## Required files (for the MVP ingest path)

- `competitions.csv`
- `clubs.csv`
- `players.csv`
- `transfers.csv`

## Optional (not yet ingested)

- `appearances.csv` — per-game stats per player. Heavy (~300 MB). Used later
  for tightening "era" and "played-together" attributes if we want them
  derived from match minutes rather than transfer windows.
- `player_valuations.csv` — market value time series. Useful for analytics.
- `games.csv`, `game_lineups.csv`, `game_events.csv`, `club_games.csv` — match
  detail. Out of scope for the MVP.

## How to download

### Option A — Manual (simplest)

1. Sign in at https://www.kaggle.com.
2. Go to https://www.kaggle.com/datasets/davidcariboo/player-scores.
3. Click **Download** (top right) → get a `archive.zip`.
4. Extract into this folder. The CSVs should sit directly here, not in a
   subfolder.

### Option B — Kaggle CLI inside the pipelines container

Once you have a Kaggle API token at `~/.kaggle/kaggle.json` (created from
your Kaggle account → Settings → Create New Token):

```bash
docker compose exec pipelines bash -lc '
  pip install kaggle &&
  mkdir -p ~/.kaggle &&
  echo "$KAGGLE_JSON" > ~/.kaggle/kaggle.json &&
  chmod 600 ~/.kaggle/kaggle.json &&
  kaggle datasets download -d davidcariboo/player-scores \
    --unzip -p /repo/pipelines/data/kaggle
'
```

(`KAGGLE_JSON` env var would need to be exported on the host, with the
contents of your `kaggle.json`.)
