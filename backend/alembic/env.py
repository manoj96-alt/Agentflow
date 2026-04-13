"""
Alembic env.py — configured for:
  - Async engine (asyncpg) for the application
  - Sync engine (psycopg2) for migrations (Alembic requires sync)
  - Auto-imports all ORM models so autogenerate can diff them

Run migrations:
    alembic upgrade head
    alembic downgrade -1
    alembic revision --autogenerate -m "describe change"
"""

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool, engine_from_config
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from alembic import context

# ── Load ORM metadata ─────────────────────────────────────────────────────────
# Import ALL models here so Alembic sees them during autogenerate
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import Base  # noqa: E402
from app.models.workflow_orm import WorkflowORM  # noqa: E402 — registers the table

target_metadata = Base.metadata

# ── Alembic config ────────────────────────────────────────────────────────────
config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from environment (psycopg2 sync URL for migrations)
SYNC_URL = os.getenv(
    "DATABASE_SYNC_URL",
    "postgresql+psycopg2://flowforge:secret@localhost:5432/flowforge",
)
config.set_main_option("sqlalchemy.url", SYNC_URL)


# ── Offline mode (no live DB needed — generates SQL script) ───────────────────
def run_migrations_offline() -> None:
    context.configure(
        url=SYNC_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (connects to DB) ──────────────────────────────────────────────
def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
