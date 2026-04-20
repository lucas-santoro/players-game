"""Smoke-test entry point: verifies the DB is reachable and prints player count."""

from __future__ import annotations

from rich import print

from .db import connection


def main() -> None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM players")
            (count,) = cur.fetchone()
    print(f"[bold green]OK[/] — players in DB: [bold]{count}[/]")


if __name__ == "__main__":
    main()
