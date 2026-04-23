"""Idempotent photo downloader for Transfermarkt player images.

Reads a JSONL file produced by the dcaribou/transfermarkt-scraper `players` spider
and downloads each player's `image_url` to <output_dir>/<player_id>.jpg.

Resilience:
- Skip if the final file already exists.
- Download to <id>.jpg.partial first, then atomic rename — a kill mid-download
  leaves a .partial that the next run will overwrite. Final files are never half-written.
- Tail mode (--follow): keep reading new lines from the input file (useful while
  the scraper is still running on the server).

Usage:
    python -m pipelines.photos --input data/raw/players.jsonl --output data/photos
    python -m pipelines.photos --input data/raw/players.jsonl --output data/photos --follow
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Iterator

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


log = logging.getLogger("photos")

USER_AGENT = "players-game-photo-fetcher/0.1 (+contact: dev@example.com)"
REQUEST_TIMEOUT = 30.0
THROTTLE_SECONDS = 0.2  # ~5 req/sec


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True, help="players.jsonl path")
    p.add_argument("--output", type=Path, required=True, help="directory for <id>.jpg files")
    p.add_argument(
        "--follow",
        action="store_true",
        help="keep reading new lines as the scraper appends them (tail -f style)",
    )
    p.add_argument("--throttle", type=float, default=THROTTLE_SECONDS)
    return p.parse_args()


def iter_jsonl(path: Path, follow: bool) -> Iterator[dict]:
    """Yield parsed JSON objects from a JSONL file. If follow=True, blocks for new lines."""
    with path.open("r", encoding="utf-8") as f:
        while True:
            line = f.readline()
            if not line:
                if not follow:
                    return
                time.sleep(2.0)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as err:
                log.warning("skip malformed line: %s", err)


def derive_player_id(record: dict) -> str | None:
    """Extract a stable id from the scraper record. Falls back to last URL segment."""
    pid = record.get("player_id") or record.get("id") or record.get("tm_id")
    if pid is not None:
        return str(pid)
    href = record.get("href") or record.get("url") or ""
    if href:
        # e.g. /lionel-messi/profil/spieler/28003 -> 28003
        parts = [p for p in href.strip("/").split("/") if p]
        if parts and parts[-1].isdigit():
            return parts[-1]
    return None


@retry(
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
    reraise=True,
)
def download(client: httpx.Client, url: str, dest_partial: Path) -> None:
    with client.stream("GET", url, timeout=REQUEST_TIMEOUT) as resp:
        resp.raise_for_status()
        with dest_partial.open("wb") as f:
            for chunk in resp.iter_bytes(chunk_size=64 * 1024):
                f.write(chunk)


def process_record(client: httpx.Client, record: dict, output: Path) -> str:
    """Returns one of: 'skip' | 'download' | 'no-url' | 'no-id' | 'error:<reason>'."""
    pid = derive_player_id(record)
    if not pid:
        return "no-id"

    url = record.get("image_url") or record.get("photo_url")
    if not url:
        return "no-url"

    final = output / f"{pid}.jpg"
    if final.exists() and final.stat().st_size > 0:
        return "skip"

    partial = output / f"{pid}.jpg.partial"
    try:
        download(client, url, partial)
    except httpx.HTTPStatusError as e:
        if partial.exists():
            partial.unlink(missing_ok=True)
        return f"error:status-{e.response.status_code}"
    except Exception as e:
        if partial.exists():
            partial.unlink(missing_ok=True)
        return f"error:{type(e).__name__}"

    if partial.stat().st_size == 0:
        partial.unlink(missing_ok=True)
        return "error:empty-body"

    os.replace(partial, final)  # atomic rename on POSIX
    return "download"


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    counters = {"skip": 0, "download": 0, "no-url": 0, "no-id": 0, "error": 0}

    headers = {"User-Agent": USER_AGENT, "Accept": "image/*"}
    with httpx.Client(headers=headers, follow_redirects=True) as client:
        for record in iter_jsonl(args.input, follow=args.follow):
            outcome = process_record(client, record, args.output)
            bucket = "error" if outcome.startswith("error:") else outcome
            counters[bucket] = counters.get(bucket, 0) + 1
            if outcome == "download":
                time.sleep(args.throttle)

            if sum(counters.values()) % 100 == 0:
                log.info("progress: %s", counters)

    log.info("final: %s", counters)
    return 0


if __name__ == "__main__":
    sys.exit(main())
