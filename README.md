# Players Game

Wordle-style game with football players. Daily target, similarity scoring breakdown per guess.

See the [design doc](C:\Users\lucas\.claude\plans\fa-a-um-brainstorm-comigo-compressed-sketch.md) for full context.

## Quick start (Docker, inside WSL2)

```bash
cp .env.example .env
docker compose up
```

- Web: http://localhost:3000
- Postgres: localhost:5432 (postgres / postgres)

## Project layout

```
apps/web/         Next.js (App Router) + Tailwind + Drizzle
pipelines/        Python (uv) — offline ETL/scrape jobs
docker-compose.yml
vercel.ts
```

## Common commands

```bash
docker compose up                       # start everything
docker compose exec web pnpm dev        # already running by default
docker compose exec web pnpm db:push    # apply schema to DB
docker compose exec web pnpm db:seed    # insert minimal fake players
docker compose exec pipelines uv run python -m pipelines.ingest_kaggle
```
