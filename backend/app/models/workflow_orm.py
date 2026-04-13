"""
Workflow ORM model
==================
Stores a complete workflow (React Flow graph) as a PostgreSQL row.
Nodes and edges are stored in JSONB columns for flexible querying
without a rigid relational schema.

Table: workflows
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class WorkflowORM(Base):
    __tablename__ = "workflows"

    # ── Primary key ────────────────────────────────────────────────────────────
    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # ── Identity ───────────────────────────────────────────────────────────────
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)

    # ── React Flow graph — stored as JSONB ─────────────────────────────────────
    # Each node: { id, type, position: {x,y}, data: {agentName, role, model, …} }
    nodes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Each edge: { id, source, target, animated, label, style }
    edges: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # ── Execution config ───────────────────────────────────────────────────────
    max_iterations: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    # ── Timestamps — set by DB, not application ────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Workflow id={self.id!r} name={self.name!r} nodes={len(self.nodes or [])}>"
