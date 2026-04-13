"""
Execution Runs Router
=====================
REST endpoints for storing and retrieving execution replays.

POST /api/execution-runs/           — save a completed execution
GET  /api/execution-runs/           — list saved runs
GET  /api/execution-runs/{id}       — get full run with logs
DELETE /api/execution-runs/{id}     — delete a run
"""
from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.execution_run_orm import ExecutionRunORM
from app.repositories.execution_run_repository import execution_run_repo

router = APIRouter(prefix="/execution-runs", tags=["execution-runs"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class SaveExecutionRequest(BaseModel):
    flow_name: str
    workflow_id: str | None = None
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    logs: list[dict[str, Any]]
    final_state: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, Any] = Field(default_factory=dict)
    status: str = "success"


class ExecutionRunSummary(BaseModel):
    id: str
    flow_name: str
    workflow_id: str | None
    status: str
    node_count: int
    step_count: int
    duration_ms: float | None
    created_at: str
    completed_at: str | None

    @classmethod
    def from_orm(cls, run: ExecutionRunORM) -> "ExecutionRunSummary":
        return cls(
            id=run.id,
            flow_name=run.flow_name,
            workflow_id=run.workflow_id,
            status=run.status,
            node_count=len(run.nodes or []),
            step_count=len(run.logs or []),
            duration_ms=run.summary.get("durationMs") if run.summary else None,
            created_at=run.created_at.isoformat(),
            completed_at=run.completed_at.isoformat() if run.completed_at else None,
        )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/", summary="Save a completed execution for replay")
async def save_execution(
    body: SaveExecutionRequest,
    db: AsyncSession = Depends(get_db),
):
    run = await execution_run_repo.create(
        db,
        flow_name=body.flow_name,
        workflow_id=body.workflow_id,
        nodes=body.nodes,
        edges=body.edges,
        status="running",
    )
    completed = await execution_run_repo.complete(
        db, run.id,
        status=body.status,
        logs=body.logs,
        final_state=body.final_state,
        summary=body.summary,
    )
    await db.commit()
    return {"id": completed.id, "flow_name": completed.flow_name, "status": completed.status}


@router.get("/", summary="List saved execution runs")
async def list_executions(
    workflow_id: str | None = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    runs, total = await execution_run_repo.list_runs(
        db, workflow_id=workflow_id, limit=limit, offset=offset
    )
    return {
        "total": total,
        "items": [ExecutionRunSummary.from_orm(r) for r in runs],
    }


@router.get("/{run_id}", summary="Get full execution run with all logs")
async def get_execution(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await execution_run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Execution run '{run_id}' not found")
    return {
        "id": run.id,
        "flow_name": run.flow_name,
        "workflow_id": run.workflow_id,
        "status": run.status,
        "nodes": run.nodes,
        "edges": run.edges,
        "logs": run.logs,
        "final_state": run.final_state,
        "summary": run.summary,
        "created_at": run.created_at.isoformat(),
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }


@router.delete("/{run_id}", summary="Delete an execution run")
async def delete_execution(run_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await execution_run_repo.delete(db, run_id)
    await db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Execution run '{run_id}' not found")
    return {"deleted": True, "id": run_id}
