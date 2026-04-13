"""
Workflow Pydantic schemas
=========================
Separate from the ORM model so the API contract is explicit.

WorkflowCreate  →  POST /workflows body
WorkflowUpdate  →  PUT  /workflows/{id} body (all fields optional)
WorkflowResponse  →  returned by all endpoints
WorkflowSummary   →  returned by list (no nodes/edges for bandwidth)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
import uuid

from pydantic import BaseModel, Field


# ─── Node / Edge sub-schemas (mirrors the frontend types) ────────────────────

class NodePosition(BaseModel):
    x: float
    y: float


class WorkflowNode(BaseModel):
    id: str
    type: str = "agent"
    position: NodePosition
    data: dict[str, Any]         # agentName, role, model, prompt, …


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    animated: Optional[bool] = False
    style: Optional[dict[str, Any]] = None


# ─── Request bodies ───────────────────────────────────────────────────────────

class WorkflowCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Human-readable workflow name")
    description: Optional[str] = Field(None, max_length=2000)
    tags: list[str] = Field(default_factory=list, description="Free-form tags for filtering")
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    max_iterations: int = Field(default=5, ge=1, le=50, description="Loop guard: max node iterations")

    model_config = {"json_schema_extra": {
        "example": {
            "name": "Research Pipeline",
            "description": "Orchestrator → Researcher → Coder → Reviewer",
            "tags": ["research", "demo"],
            "max_iterations": 5,
            "nodes": [
                {"id": "1", "type": "agent", "position": {"x": 200, "y": 60},
                 "data": {"agentName": "Orchestrator", "role": "orchestrator",
                          "model": "claude-sonnet-4-5", "prompt": "Coordinate the team."}}
            ],
            "edges": [{"id": "e1-2", "source": "1", "target": "2", "animated": True}],
        }
    }}


class WorkflowUpdate(BaseModel):
    """All fields optional — supports partial updates."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    nodes: Optional[list[WorkflowNode]] = None
    edges: Optional[list[WorkflowEdge]] = None
    max_iterations: Optional[int] = Field(None, ge=1, le=50)


# ─── Response schemas ─────────────────────────────────────────────────────────

class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    tags: list[str]
    nodes: list[dict[str, Any]]   # raw dicts — passed straight to the frontend
    edges: list[dict[str, Any]]
    max_iterations: int
    node_count: int
    edge_count: int
    created_at: str
    updated_at: str

    @classmethod
    def from_orm(cls, w) -> "WorkflowResponse":
        return cls(
            id=w.id,
            name=w.name,
            description=w.description,
            tags=w.tags or [],
            nodes=w.nodes or [],
            edges=w.edges or [],
            max_iterations=w.max_iterations,
            node_count=len(w.nodes or []),
            edge_count=len(w.edges or []),
            created_at=w.created_at.isoformat() if isinstance(w.created_at, datetime) else w.created_at,
            updated_at=w.updated_at.isoformat() if isinstance(w.updated_at, datetime) else w.updated_at,
        )


class WorkflowSummary(BaseModel):
    """Lightweight response for list endpoint — omits nodes/edges."""
    id: str
    name: str
    description: Optional[str]
    tags: list[str]
    node_count: int
    edge_count: int
    max_iterations: int
    created_at: str
    updated_at: str

    @classmethod
    def from_orm(cls, w) -> "WorkflowSummary":
        return cls(
            id=w.id,
            name=w.name,
            description=w.description,
            tags=w.tags or [],
            node_count=len(w.nodes or []),
            edge_count=len(w.edges or []),
            max_iterations=w.max_iterations,
            created_at=w.created_at.isoformat() if isinstance(w.created_at, datetime) else w.created_at,
            updated_at=w.updated_at.isoformat() if isinstance(w.updated_at, datetime) else w.updated_at,
        )
