"""
Execution Router
================
Triggers parallel workflow execution via the FlowEngine.

POST /api/execute
    Body: { run_id, nodes, edges, max_iterations? }
    Runs the workflow graph with parallel tier execution.
    Returns a FlowExecutionReport.

POST /api/execute/workflow/{workflow_id}
    Loads a saved workflow from PostgreSQL, creates a run,
    and executes it end-to-end.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.run import RunCreate
from app.repositories.workflow_repository import workflow_repo
from app.services.flow_engine import (
    FlowEngine,
    WorkflowNode,
    WorkflowEdge,
    flow_engine,
)
from app.services.run_state_service import run_state_service

router = APIRouter(prefix="/execute", tags=["execution"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class NodeSchema(BaseModel):
    id: str
    agent_name: str = Field(alias="agentName", default="Agent")
    role: str = "custom"
    model: str = "claude-sonnet-4-5"
    prompt: str = ""
    temperature: float = 0.7
    max_tokens: int = Field(alias="maxTokens", default=1024)

    model_config = {"populate_by_name": True}


class EdgeSchema(BaseModel):
    id: str
    source: str
    target: str
    condition: str = ""
    label: str = ""


class ExecuteRequest(BaseModel):
    run_id: str = Field(..., description="Active run ID (from POST /api/runs)")
    nodes: list[NodeSchema]
    edges: list[EdgeSchema]
    max_iterations: int = Field(default=5, ge=1, le=20)


class ExecuteWorkflowRequest(BaseModel):
    initial_state: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional seed values for the shared state",
    )
    max_iterations: int = Field(default=5, ge=1, le=20)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/",
    summary="Execute a workflow graph with parallel tier execution",
)
async def execute_flow(body: ExecuteRequest):
    """
    Execute a workflow graph.

    The engine will:
    1. Build a DAG from nodes + edges.
    2. Detect independent tiers (nodes with no unmet dependencies).
    3. Execute each tier with `asyncio.gather()` — nodes in the same tier
       run concurrently.
    4. Merge all results into the shared Redis state after each tier.
    5. Evaluate conditional edges before routing to successor tiers.

    **Example:**
    ```json
    {
      "run_id": "abc-123",
      "nodes": [
        { "id": "1", "agentName": "Orchestrator", "role": "orchestrator",
          "model": "claude-sonnet-4-5", "prompt": "Coordinate the team." },
        { "id": "2", "agentName": "Researcher", "role": "researcher",
          "model": "claude-haiku-4-5", "prompt": "Find relevant data." }
      ],
      "edges": [
        { "id": "e1", "source": "1", "target": "2", "condition": "" }
      ],
      "max_iterations": 5
    }
    ```
    """
    # Verify run exists
    run = await run_state_service.get_run(body.run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{body.run_id}' not found")

    # Convert schema → engine types
    wf_nodes = [
        WorkflowNode(
            id=n.id,
            agent_name=n.agent_name,
            role=n.role,
            model=n.model,
            prompt=n.prompt,
            temperature=n.temperature,
            max_tokens=n.max_tokens,
        )
        for n in body.nodes
    ]

    wf_edges = [
        WorkflowEdge(
            id=e.id,
            source=e.source,
            target=e.target,
            condition=e.condition,
            label=e.label,
        )
        for e in body.edges
    ]

    report = await flow_engine.execute(
        run_id=body.run_id,
        nodes=wf_nodes,
        edges=wf_edges,
        max_iterations=body.max_iterations,
    )

    return report.to_dict()


@router.post(
    "/workflow/{workflow_id}",
    summary="Load a saved workflow and execute it end-to-end",
)
async def execute_saved_workflow(
    workflow_id: str,
    body: ExecuteWorkflowRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Load a workflow from PostgreSQL by ID, create a fresh run,
    and execute it with the parallel engine.

    Returns both the run metadata and the execution report.
    """
    # Load workflow from DB
    workflow = await workflow_repo.get_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")

    # Create a run for this execution
    run = await run_state_service.create_run(
        RunCreate(flow_id=workflow_id, initial_state=body.initial_state)
    )

    # Parse nodes from stored JSONB
    wf_nodes: list[WorkflowNode] = []
    for raw in (workflow.nodes or []):
        data = raw.get("data", {}) if isinstance(raw, dict) else {}
        wf_nodes.append(WorkflowNode(
            id=raw.get("id", ""),
            agent_name=data.get("agentName", data.get("label", "Agent")),
            role=data.get("role", "custom"),
            model=data.get("model", "claude-sonnet-4-5"),
            prompt=data.get("prompt", ""),
            temperature=float(data.get("temperature", 0.7)),
            max_tokens=int(data.get("maxTokens", 1024)),
        ))

    # Parse edges from stored JSONB
    wf_edges: list[WorkflowEdge] = []
    for raw in (workflow.edges or []):
        if not isinstance(raw, dict):
            continue
        condition_data = raw.get("data", {}) or {}
        condition_obj  = condition_data.get("condition") or {}
        wf_edges.append(WorkflowEdge(
            id=raw.get("id", ""),
            source=raw.get("source", ""),
            target=raw.get("target", ""),
            condition=condition_obj.get("expression", "") if isinstance(condition_obj, dict) else "",
            label=raw.get("label", ""),
        ))

    # Execute
    report = await flow_engine.execute(
        run_id=run.run_id,
        nodes=wf_nodes,
        edges=wf_edges,
        max_iterations=body.max_iterations,
    )

    return {
        "run_id":    run.run_id,
        "workflow":  {"id": workflow_id, "name": workflow.name},
        "execution": report.to_dict(),
    }
