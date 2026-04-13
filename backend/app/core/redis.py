"""
Redis connection management.

Uses a module-level client created once at startup via the FastAPI lifespan hook.
Falls back to a mock in-memory store when Redis is unreachable (dev/test convenience).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import redis.asyncio as aioredis
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

logger = logging.getLogger(__name__)

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RUN_TTL: int = int(os.getenv("REDIS_RUN_TTL_SECONDS", "86400"))  # 24 h default

# Module-level client — set by startup, cleared by shutdown
_client: Redis | None = None


# ─── Fallback in-memory mock (no Redis required for local dev) ────────────────

class _MemoryStore:
    """Minimal Redis-compatible shim for local development without Redis."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._store[key] = value

    async def delete(self, *keys: str) -> None:
        for k in keys:
            self._store.pop(k, None)

    async def keys(self, pattern: str) -> list[str]:
        import fnmatch
        return [k for k in self._store if fnmatch.fnmatch(k, pattern)]

    async def expire(self, key: str, seconds: int) -> None:
        pass  # no-op in mock

    async def exists(self, *keys: str) -> int:
        return sum(1 for k in keys if k in self._store)

    async def aclose(self) -> None:
        pass


_mock: _MemoryStore | None = None


# ─── Lifecycle ────────────────────────────────────────────────────────────────

async def connect() -> None:
    """Called during FastAPI startup."""
    global _client, _mock
    try:
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        await client.ping()
        _client = client
        logger.info("Redis connected: %s", REDIS_URL)
    except (RedisConnectionError, OSError) as exc:
        logger.warning(
            "Redis unavailable (%s) — using in-memory fallback store. "
            "State will not persist across restarts.",
            exc,
        )
        _mock = _MemoryStore()


async def disconnect() -> None:
    """Called during FastAPI shutdown."""
    global _client, _mock
    if _client:
        await _client.aclose()
        _client = None
    _mock = None


def get_client() -> Redis | _MemoryStore:
    """Return the active Redis client or the in-memory fallback."""
    if _client is not None:
        return _client
    if _mock is not None:
        return _mock
    raise RuntimeError("Redis not initialised — call connect() first")


def is_redis_live() -> bool:
    return _client is not None


# ─── Low-level key helpers ────────────────────────────────────────────────────

def _run_key(run_id: str) -> str:
    return f"run:{run_id}:state"


def _meta_key(run_id: str) -> str:
    return f"run:{run_id}:meta"


# ─── State helpers used by the service ───────────────────────────────────────

async def load_state(run_id: str) -> dict[str, Any] | None:
    raw = await get_client().get(_run_key(run_id))
    if raw is None:
        return None
    return json.loads(raw)


async def save_state(run_id: str, state: dict[str, Any]) -> None:
    await get_client().set(_run_key(run_id), json.dumps(state), ex=RUN_TTL)


async def load_meta(run_id: str) -> dict[str, Any] | None:
    raw = await get_client().get(_meta_key(run_id))
    if raw is None:
        return None
    return json.loads(raw)


async def save_meta(run_id: str, meta: dict[str, Any]) -> None:
    await get_client().set(_meta_key(run_id), json.dumps(meta), ex=RUN_TTL)


async def delete_run(run_id: str) -> None:
    await get_client().delete(_run_key(run_id), _meta_key(run_id))


async def list_run_ids() -> list[str]:
    client = get_client()
    keys = await client.keys("run:*:meta")
    # Extract run_id from "run:<id>:meta"
    return [k.split(":")[1] for k in keys]
