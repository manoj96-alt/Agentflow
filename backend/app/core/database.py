"""
Database connection module
==========================

Provides:
  - Async SQLAlchemy engine (asyncpg driver)
  - AsyncSession factory
  - Base declarative class for ORM models
  - FastAPI dependency: get_db() → AsyncSession
  - connect() / disconnect() called from main.py lifespan

Environment variables
---------------------
DATABASE_URL      async URL  e.g. postgresql+asyncpg://user:pass@host:5432/db
"""

from __future__ import annotations

import logging
import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://flowforge:secret@localhost:5432/flowforge",
)

# ─── Engine ───────────────────────────────────────────────────────────────────

engine = create_async_engine(
    DATABASE_URL,
    echo=os.getenv("APP_ENV") == "development",  # SQL logging in dev
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,    # verify connections before use
    pool_recycle=3600,     # recycle after 1 h
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


# ─── Base model ───────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """All ORM models inherit from this."""
    pass


# ─── Lifecycle ────────────────────────────────────────────────────────────────

async def connect() -> None:
    """
    Called during FastAPI startup.
    Creates all tables that don't yet exist (dev convenience).
    In production, use Alembic migrations instead.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("PostgreSQL connected: %s", DATABASE_URL.split("@")[-1])


async def disconnect() -> None:
    """Called during FastAPI shutdown."""
    await engine.dispose()
    logger.info("PostgreSQL connection pool disposed")


# ─── FastAPI dependency ───────────────────────────────────────────────────────

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yields a transactional AsyncSession per request.
    Commits on success, rolls back on any exception.

    Usage in a router:
        async def my_route(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
