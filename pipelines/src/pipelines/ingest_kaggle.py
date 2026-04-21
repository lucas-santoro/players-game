"""Load the davidcariboo/player-scores Kaggle dataset into Postgres.

Usage (inside the pipelines docker container):

    uv run python -m pipelines.ingest_kaggle --dir /repo/pipelines/data/kaggle

Expected files in --dir:
    competitions.csv
    clubs.csv
    players.csv
    transfers.csv

Idempotent — re-running upserts on natural keys (tm_id), so it's safe to
re-run after schema tweaks or partial failures.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import polars as pl
from rich.console import Console

from .db import connection

console = Console()
log = logging.getLogger("ingest_kaggle")

EXPECTED_FILES = ("competitions.csv", "clubs.csv", "players.csv", "transfers.csv")
DEFAULT_DIR = Path("/repo/pipelines/data/kaggle")
TOP5_TM_IDS = {"GB1", "ES1", "IT1", "L1", "FR1"}

# Manual fallbacks for country names where pycountry-convert struggles.
# Football associations don't always match ISO political entities.
COUNTRY_OVERRIDES: dict[str, str] = {
    "England": "europe",
    "Scotland": "europe",
    "Wales": "europe",
    "Northern Ireland": "europe",
    "Faroe Islands": "europe",
    "Gibraltar": "europe",
    "Kosovo": "europe",
    "Korea, South": "asia",
    "Korea, North": "asia",
    "South Korea": "asia",
    "North Korea": "asia",
    "Macedonia": "europe",
    "Cape Verde": "africa",
    "Curacao": "north_america",
    "Curaçao": "north_america",
    "Trinidad and Tobago": "north_america",
    "St. Kitts & Nevis": "north_america",
    "Saint Kitts and Nevis": "north_america",
    "Bosnia-Herzegovina": "europe",
    "Bosnia and Herzegovina": "europe",
    "DR Congo": "africa",
    "Congo": "africa",
    "Ivory Coast": "africa",
    "Cote d'Ivoire": "africa",
    "Côte d'Ivoire": "africa",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    p.add_argument(
        "--limit-players",
        type=int,
        default=None,
        help="dev: ingest only the first N players for a fast smoke test",
    )
    p.add_argument(
        "--skip-transfers",
        action="store_true",
        help="skip the transfers table (largest of the four)",
    )
    return p.parse_args()


def country_to_continent(name: str | None) -> str:
    """Best-effort country name → our continent enum. Defaults to 'europe'
    (most common in football) when unknown — country itself still gets stored,
    only the continent is approximate."""
    if not name:
        return "europe"
    if name in COUNTRY_OVERRIDES:
        return COUNTRY_OVERRIDES[name]
    try:
        import pycountry_convert as pc

        alpha2 = pc.country_name_to_country_alpha2(name, cn_name_format="default")
        code = pc.country_alpha2_to_continent_code(alpha2)
        return {
            "AF": "africa",
            "AS": "asia",
            "EU": "europe",
            "NA": "north_america",
            "OC": "oceania",
            "SA": "south_america",
        }.get(code, "europe")
    except (KeyError, LookupError, AttributeError):
        log.debug("country_to_continent fallback for %r", name)
        return "europe"


def collect_country_records(
    df_competitions: pl.DataFrame, df_players: pl.DataFrame
) -> list[dict[str, Any]]:
    """Distinct countries from competitions + players. Carries tm_id when
    we have one (from competitions.country_id)."""
    out: dict[str, dict[str, Any]] = {}

    for row in df_competitions.select(["country_id", "country_name"]).iter_rows(named=True):
        name = row.get("country_name")
        if not name:
            continue
        out.setdefault(
            name,
            {
                "tm_id": str(row["country_id"]) if row.get("country_id") is not None else None,
                "name": name,
                "continent": country_to_continent(name),
            },
        )

    for col in ("country_of_birth", "country_of_citizenship"):
        if col not in df_players.columns:
            continue
        for name in df_players[col].drop_nulls().unique().to_list():
            if not name:
                continue
            out.setdefault(
                name,
                {
                    "tm_id": None,
                    "name": name,
                    "continent": country_to_continent(name),
                },
            )

    return list(out.values())


def insert_countries(conn, records: list[dict[str, Any]]) -> int:
    if not records:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO countries (tm_id, name, continent)
            VALUES (%(tm_id)s, %(name)s, %(continent)s::continent)
            ON CONFLICT (name) DO UPDATE
                SET tm_id = COALESCE(EXCLUDED.tm_id, countries.tm_id),
                    continent = EXCLUDED.continent
            """,
            records,
        )
    conn.commit()
    return len(records)


def slug_to_display_name(slug: str | None) -> str | None:
    """Kaggle's competitions.csv stores league names as kebab-case slugs
    (e.g. 'premier-league', 'laliga'). Convert to a presentable form."""
    if not slug:
        return None
    # Special cases where naive title-case is wrong.
    overrides = {
        "laliga": "LaLiga",
        "premier-league": "Premier League",
        "serie-a": "Serie A",
        "bundesliga": "Bundesliga",
        "ligue-1": "Ligue 1",
        "j1-league": "J1 League",
        "k-league-1": "K League 1",
        "mls": "MLS",
        "major-league-soccer": "Major League Soccer",
    }
    if slug in overrides:
        return overrides[slug]
    return slug.replace("-", " ").title()


def insert_leagues(conn, df: pl.DataFrame) -> int:
    records = []
    for row in df.iter_rows(named=True):
        comp_type = (row.get("type") or "").strip()
        records.append(
            {
                "tm_id": row["competition_id"],
                "name": slug_to_display_name(row["name"]),
                "country_name": row.get("country_name"),
                "tier": 1 if comp_type in ("first_tier", "domestic_league") else 2,
                "is_top5_european": row["competition_id"] in TOP5_TM_IDS,
            }
        )
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO leagues (tm_id, name, country_id, tier, is_top5_european)
            VALUES (
                %(tm_id)s,
                %(name)s,
                (SELECT id FROM countries WHERE name = %(country_name)s),
                %(tier)s,
                %(is_top5_european)s
            )
            ON CONFLICT (tm_id) DO UPDATE
                SET name = EXCLUDED.name,
                    country_id = EXCLUDED.country_id,
                    tier = EXCLUDED.tier,
                    is_top5_european = EXCLUDED.is_top5_european
            """,
            records,
        )
    conn.commit()
    return len(records)


def insert_clubs(conn, df: pl.DataFrame) -> int:
    records = []
    for row in df.iter_rows(named=True):
        records.append(
            {
                "tm_id": row["club_id"],
                "name": row["name"],
                "league_tm_id": row.get("domestic_competition_id"),
            }
        )
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO clubs (tm_id, name, league_id, country_id)
            VALUES (
                %(tm_id)s,
                %(name)s,
                (SELECT id FROM leagues WHERE tm_id = %(league_tm_id)s),
                (
                    SELECT country_id FROM leagues WHERE tm_id = %(league_tm_id)s
                )
            )
            ON CONFLICT (tm_id) DO UPDATE
                SET name = EXCLUDED.name,
                    league_id = EXCLUDED.league_id,
                    country_id = EXCLUDED.country_id
            """,
            records,
        )
    conn.commit()
    return len(records)


def normalize_foot(value: Any) -> str:
    if value is None:
        return "unknown"
    v = str(value).strip().lower()
    if v in ("left", "right", "both"):
        return v
    return "unknown"


def parse_season(value: Any) -> int | None:
    """Kaggle's transfer_season is 2-digit format like '00/01' or '23/24'.
    Convention: years 0-49 -> 2000s, 50-99 -> 1900s. 4-digit years pass through."""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    head = raw.split("/")[0].strip()
    try:
        year = int(head)
    except ValueError:
        return None
    if year < 50:
        return 2000 + year
    if year < 100:
        return 1900 + year
    return year


def to_iso_date(value: Any) -> str | None:
    """Strip timestamp suffix from values like '1978-06-09 00:00:00' so the
    Postgres ::date cast works regardless of whether polars parsed as
    String, Datetime, or Date."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in ("nan", "nat", "none"):
        return None
    return s.split(" ")[0][:10]


def insert_players(conn, df: pl.DataFrame, *, limit: int | None) -> int:
    if limit is not None:
        df = df.head(limit)

    records = []
    for row in df.iter_rows(named=True):
        # Slug is unique-constrained, but Kaggle's player_code is not (collisions
        # exist between players with the same Latin transliteration). Combine
        # with the numeric tm_id for guaranteed uniqueness.
        code = (row.get("player_code") or "").strip().lower() or str(row["player_id"])
        records.append(
            {
                "tm_id": row["player_id"],
                "name": row["name"],
                "slug": f"{code}-{row['player_id']}",
                "dob": to_iso_date(row.get("date_of_birth")),
                "height_cm": row.get("height_in_cm") or None,
                "foot": normalize_foot(row.get("foot")),
                "primary_position": row.get("sub_position") or None,
                "generic_position": row.get("position") or None,
                "current_club_tm_id": row.get("current_club_id"),
                "market_value_eur": row.get("market_value_in_eur"),
                "country_of_birth": row.get("country_of_birth"),
                "country_of_citizenship": row.get("country_of_citizenship"),
                "is_active": (row.get("last_season") or 0) >= 2023,
                "last_season": row.get("last_season") or None,
                "photo_url": row.get("image_url"),
            }
        )

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO players (
                tm_id, name, slug, dob, height_cm, foot,
                primary_position, generic_position,
                current_club_id, market_value_eur,
                country_of_citizenship_id, country_of_birth_id,
                is_active, last_season, photo_url
            )
            VALUES (
                %(tm_id)s,
                %(name)s,
                %(slug)s,
                NULLIF(%(dob)s, '')::date,
                %(height_cm)s,
                %(foot)s::foot,
                %(primary_position)s,
                %(generic_position)s,
                (SELECT id FROM clubs WHERE tm_id = %(current_club_tm_id)s),
                %(market_value_eur)s,
                (SELECT id FROM countries WHERE name = %(country_of_citizenship)s),
                (SELECT id FROM countries WHERE name = %(country_of_birth)s),
                %(is_active)s,
                %(last_season)s,
                %(photo_url)s
            )
            ON CONFLICT (tm_id) DO UPDATE SET
                name = EXCLUDED.name,
                slug = EXCLUDED.slug,
                dob = EXCLUDED.dob,
                height_cm = EXCLUDED.height_cm,
                foot = EXCLUDED.foot,
                primary_position = EXCLUDED.primary_position,
                generic_position = EXCLUDED.generic_position,
                current_club_id = EXCLUDED.current_club_id,
                market_value_eur = EXCLUDED.market_value_eur,
                country_of_citizenship_id = EXCLUDED.country_of_citizenship_id,
                country_of_birth_id = EXCLUDED.country_of_birth_id,
                is_active = EXCLUDED.is_active,
                last_season = EXCLUDED.last_season,
                photo_url = EXCLUDED.photo_url
            """,
            records,
        )
    conn.commit()
    return len(records)


def insert_transfers(conn, df: pl.DataFrame) -> int:
    records = []
    for row in df.iter_rows(named=True):
        records.append(
            {
                "player_tm_id": row["player_id"],
                "from_club_tm_id": row.get("from_club_id"),
                "to_club_tm_id": row.get("to_club_id"),
                "season": parse_season(row.get("transfer_season")),
                "transfer_date": to_iso_date(row.get("transfer_date")),
                "fee_eur": row.get("transfer_fee"),
                "market_value_eur": row.get("market_value_in_eur"),
            }
        )

    # Skip rows where we can't resolve the player or season — they'd hit FK error.
    records = [r for r in records if r["season"] is not None]

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO transfers (
                player_id, from_club_id, to_club_id,
                season, transfer_date, fee_eur, market_value_eur
            )
            SELECT
                p.id,
                fc.id,
                tc.id,
                %(season)s,
                NULLIF(%(transfer_date)s, '')::date,
                %(fee_eur)s,
                %(market_value_eur)s
            FROM players p
            LEFT JOIN clubs fc ON fc.tm_id = %(from_club_tm_id)s
            LEFT JOIN clubs tc ON tc.tm_id = %(to_club_tm_id)s
            WHERE p.tm_id = %(player_tm_id)s
            """,
            records,
        )
    conn.commit()
    return len(records)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    args = parse_args()

    if not args.dir.exists():
        console.print(f"[red]ERROR[/]: directory does not exist: {args.dir}")
        console.print(
            "Download the dataset from "
            "https://www.kaggle.com/datasets/davidcariboo/player-scores"
        )
        console.print(f"and extract the CSVs into {args.dir}.")
        return 1

    missing = [f for f in EXPECTED_FILES if not (args.dir / f).exists()]
    if missing:
        console.print(f"[red]ERROR[/]: missing files in {args.dir}: {missing}")
        return 1

    console.print(f"[green]Loading CSVs from[/] {args.dir}")

    df_competitions = pl.read_csv(args.dir / "competitions.csv")
    df_clubs = pl.read_csv(args.dir / "clubs.csv")
    df_players = pl.read_csv(args.dir / "players.csv")

    console.print(f"  competitions: {df_competitions.height}")
    console.print(f"  clubs:        {df_clubs.height}")
    console.print(f"  players:      {df_players.height}")

    df_transfers: pl.DataFrame | None = None
    if not args.skip_transfers:
        df_transfers = pl.read_csv(args.dir / "transfers.csv")
        console.print(f"  transfers:    {df_transfers.height}")

    with connection() as conn:
        country_records = collect_country_records(df_competitions, df_players)
        n = insert_countries(conn, country_records)
        console.print(f"  [bold]countries[/] upserted: {n}")

        n = insert_leagues(conn, df_competitions)
        console.print(f"  [bold]leagues[/]   upserted: {n}")

        n = insert_clubs(conn, df_clubs)
        console.print(f"  [bold]clubs[/]     upserted: {n}")

        n = insert_players(conn, df_players, limit=args.limit_players)
        console.print(f"  [bold]players[/]   upserted: {n}")

        if df_transfers is not None:
            n = insert_transfers(conn, df_transfers)
            console.print(f"  [bold]transfers[/] inserted: {n}")

    console.print("[bold green]Done.[/]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
