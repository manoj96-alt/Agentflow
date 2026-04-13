from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime
import uuid


class NodeData(BaseModel):
    label: str
    description: Optional[str] = None
    type: Literal["input", "process", "output", "decision"] = "process"
    status: Literal["idle", "running", "success", "error"] = "idle"


class Position(BaseModel):
    x: float
    y: float


class FlowNode(BaseModel):
    id: str
    type: str = "custom"
    position: Position
    data: NodeData


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    animated: Optional[bool] = False


class FlowGraphCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    nodes: List[FlowNode] = []
    edges: List[FlowEdge] = []


class FlowGraph(FlowGraphCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}


class ExecutionResult(BaseModel):
    flow_id: str
    status: Literal["success", "error"]
    message: str
    executed_nodes: int
    duration_ms: float
