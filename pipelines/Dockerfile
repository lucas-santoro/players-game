FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.13 /uv /usr/local/bin/uv

WORKDIR /repo/pipelines

COPY pipelines/pyproject.toml pipelines/uv.lock* ./

RUN uv sync --frozen --no-install-project || uv sync --no-install-project

COPY pipelines/ ./

RUN uv sync --frozen || uv sync

ENV PATH="/opt/venv/bin:$PATH"

CMD ["sleep", "infinity"]
