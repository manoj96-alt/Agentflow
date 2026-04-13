"""
Workflows Router
================
REST endpoints for saving and retrieving workflow graphs in PostgreSQL.

POST   /api/workflows             create
GET    /api/workflows             list (with pagination + filtering)
GET    /api/workflows/{id}        get full workflow with nodes + edges
PUT    /api/workflows/{id}        partial update (PATCH semantics)
DELETE /api/workflows/{id}        remove
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.workflow import (
    WorkflowCreate,
    WorkflowUpdate,
    WorkflowResponse,
    WorkflowSummary,
)
from app.repositories.workflow_repository import workflow_repo

router = APIRouter(prefix="/workflows", tags=["workflows"])


# ─── POST /workflows ──────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=WorkflowResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Save a new workflow",
)
async def create_workflow(
    data: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Persist a complete React Flow graph as a workflow.

    Nodes and edges are stored as JSONB — pass them exactly as the
    frontend produces them. The response includes the assigned `id`
    and server-generated timestamps.

    ```json
    {
      "name": "Research Pipeline",
      "description": "Multi-agent research workflow",
      "tags": ["research", "demo"],
      "max_iterations": 5,
      "nodes": [ { "id": "1", "type": "agent", "position": {"x": 200, "y": 60},
                   "data": { "agentName": "Orchestrator", "role": "orchestrator",
                              "model": "claude-sonnet-4-5", "prompt": "…" } } ],
      "edges": [ { "id": "e1-2", "source": "1", "target": "2", "animated": true } ]
    }
    ```
    """
    workflow = await workflow_repo.create(db, data)
    return WorkflowResponse.from_orm(workflow)


# ─── GET /workflows ───────────────────────────────────────────────────────────

@router.get(
    "/",
    summary="List workflows (summaries, no graph data)",
)
async def list_workflows(
    tag: Optional[str] = Query(None, description="Filter by tag"),
    search: Optional[str] = Query(None, description="Search name/description"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    Return a paginated list of workflow summaries.
    Nodes and edges are omitted to keep responses small — fetch the
    individual workflow to get the full graph.

    **Filters:**
    - `tag=research` — workflows tagged "research"
    - `search=pipeline` — name or description contains "pipeline"
    """
    workflows, total = await workflow_repo.get_all(
        db, tag=tag, search=search, limit=limit, offset=offset
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [WorkflowSummary.from_orm(w) for w in workflows],
    }


# ─── GET /workflows/{id} ──────────────────────────────────────────────────────

@router.get(
    "/{workflow_id}",
    response_model=WorkflowResponse,
    summary="Get full workflow graph by ID",
)
async def get_workflow(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Return the full workflow including all nodes and edges.
    Use this to load a saved workflow into the React Flow canvas.
    """
    workflow = await workflow_repo.get_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow '{workflow_id}' not found",
        )
    return WorkflowResponse.from_orm(workflow)


# ─── PUT /workflows/{id} ──────────────────────────────────────────────────────

@router.put(
    "/{workflow_id}",
    response_model=WorkflowResponse,
    summary="Update a workflow (partial update supported)",
)
async def update_workflow(
    workflow_id: str,
    data: WorkflowUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Update a workflow. Only the fields you include are changed —
    omitted fields retain their current value.

    **Common use-cases:**
    - Auto-save the canvas: send `{ "nodes": […], "edges": […] }`
    - Rename: send `{ "name": "New Name" }`
    - Update tags: send `{ "tags": ["production", "v2"] }`
    """
    workflow = await workflow_repo.update(db, workflow_id, data)
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow '{workflow_id}' not found",
        )
    return WorkflowResponse.from_orm(workflow)


# ─── DELETE /workflows/{id} ───────────────────────────────────────────────────

@router.delete(
    "/{workflow_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workflow",
)
async def delete_workflow(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Permanently remove a workflow and its graph data from PostgreSQL."""
    deleted = await workflow_repo.delete(db, workflow_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"Workflow '{workflow_id}' not found",
        )


# ─── GET /workflows/templates ─────────────────────────────────────────────────

from app.workflows.prebuilt import PREBUILT_TEMPLATES, TEMPLATE_BY_KEY


@router.get(
    "/templates",
    summary="List all prebuilt workflow templates",
)
async def list_templates():
    """
    Return all prebuilt workflow templates with their full graph data.
    Use these payloads directly with `POST /api/workflows` to save a copy,
    or render them in the canvas immediately without saving.

    Templates:
    - **pdf_summarizer** — Extract, chunk, summarise, compose from a PDF
    - **reasoning_loop** — Adversarial debate loop with quality-gated iterations
    - **api_analysis** — Fetch, validate, analyse, and report on API data
    """
    return {
        "count": len(PREBUILT_TEMPLATES),
        "templates": [
            {
                "key": key,
                "name": t.name,
                "description": t.description,
                "tags": t.tags,
                "node_count": len(t.nodes),
                "edge_count": len(t.edges),
                "max_iterations": t.max_iterations,
                "nodes": [n.model_dump() for n in t.nodes],
                "edges": [e.model_dump() for e in t.edges],
            }
            for key, t in TEMPLATE_BY_KEY.items()
        ],
    }


@router.get(
    "/templates/{key}",
    summary="Get a single prebuilt template by key",
)
async def get_template(key: str):
    """
    Fetch one template by its key.

    Keys: `pdf_summarizer` | `reasoning_loop` | `api_analysis`
    """
    template = TEMPLATE_BY_KEY.get(key)
    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"Template '{key}' not found. Available: {list(TEMPLATE_BY_KEY)}",
        )
    return {
        "key": key,
        "name": template.name,
        "description": template.description,
        "tags": template.tags,
        "node_count": len(template.nodes),
        "edge_count": len(template.edges),
        "max_iterations": template.max_iterations,
        "nodes": [n.model_dump() for n in template.nodes],
        "edges": [e.model_dump() for e in template.edges],
    }


@router.post(
    "/templates/{key}/save",
    response_model=WorkflowResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Save a prebuilt template as a new workflow",
)
async def save_template(
    key: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Instantiate a prebuilt template and persist it to PostgreSQL.

    Returns the saved `WorkflowResponse` with a new UUID.
    You can then load it with `GET /api/workflows/{id}`.
    """
    template = TEMPLATE_BY_KEY.get(key)
    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"Template '{key}' not found. Available: {list(TEMPLATE_BY_KEY)}",
        )
    workflow = await workflow_repo.create(db, template)
    return WorkflowResponse.from_orm(workflow)
