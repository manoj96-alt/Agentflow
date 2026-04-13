"""
ExecutionRun ORM model
======================
Stores a complete workflow execution snapshot in PostgreSQL.

Table: execution_runs
- id           UUID PK
- workflow_id  FK reference (optional — may be an ad-hoc run)
- flow_name    snapshot of the workflow name at execution time
- status       pending | running | success | partial | error
- nodes        JSONB  — node graph snapshot (positions + data)
- edges        JSONB  — edge graph snapshot (including conditions)
- logs         JSONB  — array of ExecutionLog entries (full step-by-step)
- final_state  JSONB  — shared state after all nodes completed
- summary      JSONB  — { totalSteps, durationMs, loopsDetected, … }
- created_at   TIMESTAMPTZ
- completed_at TIMESTAMPTZ (null while running)
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExecutionRunORM(Base):
    __tablename__ = "execution_runs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # ── Workflow reference ─────────────────────────────────────────────────────
    workflow_id:  Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    flow_name:    Mapped[str]        = mapped_column(String(200), nullable=False)

    # ── Status ─────────────────────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)

    # ── Graph snapshot (what was executed) ────────────────────────────────────
    nodes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    edges: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # ── Execution data ─────────────────────────────────────────────────────────
    logs:        Mapped[list]         = mapped_column(JSONB, nullable=False, default=list)
    final_state: Mapped[dict]         = mapped_column(JSONB, nullable=False, default=dict)
    summary:     Mapped[dict]         = mapped_column(JSONB, nullable=False, default=dict)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    def __repr__(self) -> str:
        return f"<ExecutionRun id={self.id!r} flow={self.flow_name!r} status={self.status!r}>"
