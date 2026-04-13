from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
import uuid

from pydantic import BaseModel, Field


RunStatus = Literal["created", "running", "completed", "failed"]


class RunCreate(BaseModel):
    flow_id: str = Field(..., description="ID of the flow being executed")
    initial_state: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional seed values pre-loaded into shared state",
    )


class RunMeta(BaseModel):
    """Stored in Redis under run:<id>:meta"""
    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    flow_id: str
    status: RunStatus = "created"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}


class RunResponse(BaseModel):
    run_id: str
    flow_id: str
    status: RunStatus
    created_at: str
    updated_at: str
    state: dict[str, Any]
    backend: Literal["redis", "memory"]


# ─── Agent state operations ───────────────────────────────────────────────────

class StateReadRequest(BaseModel):
    keys: list[str] | None = Field(
        default=None,
        description="Specific keys to read. If omitted, returns full state.",
    )


class StateReadResponse(BaseModel):
    run_id: str
    keys_requested: list[str] | None
    state: dict[str, Any]


class StateWriteRequest(BaseModel):
    updates: dict[str, Any] = Field(
        ...,
        description="Key-value pairs to merge into shared state",
    )
    agent_id: str | None = Field(
        default=None,
        description="ID of the agent writing (recorded in audit trail)",
    )


class StateWriteResponse(BaseModel):
    run_id: str
    keys_written: list[str]
    state: dict[str, Any]
