"""
ExecutionRunRepository
======================
All database operations for execution_runs table.
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.execution_run_orm import ExecutionRunORM

logger = logging.getLogger(__name__)


class ExecutionRunRepository:

    async def create(
        self,
        db: AsyncSession,
        *,
        flow_name: str,
        workflow_id: str | None,
        nodes: list[dict],
        edges: list[dict],
        status: str = "running",
    ) -> ExecutionRunORM:
        run = ExecutionRunORM(
            id=str(uuid.uuid4()),
            flow_name=flow_name,
            workflow_id=workflow_id,
            nodes=nodes,
            edges=edges,
            logs=[],
            final_state={},
            summary={},
            status=status,
        )
        db.add(run)
        await db.flush()
        await db.refresh(run)
        logger.info("Created execution run id=%s flow=%r", run.id, flow_name)
        return run

    async def get_by_id(self, db: AsyncSession, run_id: str) -> ExecutionRunORM | None:
        result = await db.execute(
            select(ExecutionRunORM).where(ExecutionRunORM.id == run_id)
        )
        return result.scalar_one_or_none()

    async def list_runs(
        self,
        db: AsyncSession,
        *,
        workflow_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ExecutionRunORM], int]:
        q = select(ExecutionRunORM)
        if workflow_id:
            q = q.where(ExecutionRunORM.workflow_id == workflow_id)
        q = q.order_by(desc(ExecutionRunORM.created_at))

        count_result = await db.execute(select(func.count()).select_from(q.subquery()))
        total = count_result.scalar_one()

        rows = await db.execute(q.limit(limit).offset(offset))
        return rows.scalars().all(), total

    async def append_log(
        self,
        db: AsyncSession,
        run_id: str,
        log_entry: dict[str, Any],
    ) -> bool:
        """Append one log entry to the run's logs JSONB array."""
        run = await self.get_by_id(db, run_id)
        if run is None:
            return False
        current_logs = list(run.logs or [])
        current_logs.append(log_entry)
        run.logs = current_logs
        await db.flush()
        return True

    async def complete(
        self,
        db: AsyncSession,
        run_id: str,
        *,
        status: str,
        logs: list[dict],
        final_state: dict,
        summary: dict,
    ) -> ExecutionRunORM | None:
        """Mark a run complete with full logs, state and summary."""
        run = await self.get_by_id(db, run_id)
        if run is None:
            return None
        run.status       = status
        run.logs         = logs
        run.final_state  = final_state
        run.summary      = summary
        run.completed_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(run)
        logger.info("Completed execution run id=%s status=%s logs=%d", run_id, status, len(logs))
        return run

    async def delete(self, db: AsyncSession, run_id: str) -> bool:
        run = await self.get_by_id(db, run_id)
        if run is None:
            return False
        await db.delete(run)
        return True


execution_run_repo = ExecutionRunRepository()
