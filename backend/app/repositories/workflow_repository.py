"""
WorkflowRepository
==================
Data-access layer for the workflows table.
All methods accept an AsyncSession injected by FastAPI's Depends(get_db).

Keeps SQL out of the router and service layers.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow_orm import WorkflowORM
from app.models.workflow import WorkflowCreate, WorkflowUpdate

logger = logging.getLogger(__name__)


class WorkflowRepository:

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_by_id(
        self, db: AsyncSession, workflow_id: str
    ) -> WorkflowORM | None:
        result = await db.execute(
            select(WorkflowORM).where(WorkflowORM.id == workflow_id)
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        db: AsyncSession,
        *,
        tag: str | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[WorkflowORM], int]:
        """
        Return (rows, total_count) with optional filtering.

        tag:    filter by tag membership (JSONB contains)
        search: case-insensitive substring match on name or description
        """
        base_q = select(WorkflowORM)

        if tag:
            # JSONB @> operator — tags array contains this value
            base_q = base_q.where(
                WorkflowORM.tags.contains([tag])  # type: ignore[attr-defined]
            )
        if search:
            pattern = f"%{search}%"
            base_q = base_q.where(
                WorkflowORM.name.ilike(pattern)
                | WorkflowORM.description.ilike(pattern)
            )

        # Total count (before pagination)
        count_result = await db.execute(
            select(func.count()).select_from(base_q.subquery())
        )
        total = count_result.scalar_one()

        # Paginated rows
        rows_result = await db.execute(
            base_q.order_by(WorkflowORM.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return rows_result.scalars().all(), total

    # ── Write ─────────────────────────────────────────────────────────────────

    async def create(
        self, db: AsyncSession, data: WorkflowCreate
    ) -> WorkflowORM:
        workflow = WorkflowORM(
            id=str(uuid.uuid4()),
            name=data.name,
            description=data.description,
            tags=data.tags,
            nodes=[n.model_dump() for n in data.nodes],
            edges=[e.model_dump() for e in data.edges],
            max_iterations=data.max_iterations,
        )
        db.add(workflow)
        await db.flush()   # assigns created_at / updated_at from server
        await db.refresh(workflow)
        logger.info("Created workflow id=%s name=%r", workflow.id, workflow.name)
        return workflow

    async def update(
        self,
        db: AsyncSession,
        workflow_id: str,
        data: WorkflowUpdate,
    ) -> WorkflowORM | None:
        workflow = await self.get_by_id(db, workflow_id)
        if workflow is None:
            return None

        patch = data.model_dump(exclude_unset=True)

        # Serialise Pydantic node/edge objects to plain dicts
        if "nodes" in patch and patch["nodes"] is not None:
            patch["nodes"] = [
                n.model_dump() if hasattr(n, "model_dump") else n
                for n in patch["nodes"]
            ]
        if "edges" in patch and patch["edges"] is not None:
            patch["edges"] = [
                e.model_dump() if hasattr(e, "model_dump") else e
                for e in patch["edges"]
            ]

        for field, value in patch.items():
            setattr(workflow, field, value)

        # Force updated_at refresh (SQLAlchemy onupdate doesn't fire on setattr)
        workflow.updated_at = datetime.now(timezone.utc)

        await db.flush()
        await db.refresh(workflow)
        logger.info("Updated workflow id=%s", workflow_id)
        return workflow

    async def delete(self, db: AsyncSession, workflow_id: str) -> bool:
        result = await db.execute(
            delete(WorkflowORM).where(WorkflowORM.id == workflow_id)
        )
        deleted = result.rowcount > 0
        if deleted:
            logger.info("Deleted workflow id=%s", workflow_id)
        return deleted


workflow_repo = WorkflowRepository()
