from typing import Dict, List, Optional
from datetime import datetime
import time
from app.models.flow import FlowGraph, FlowGraphCreate, ExecutionResult


# In-memory store (replace with a real DB in production)
_store: Dict[str, FlowGraph] = {}


class FlowService:
    def get_all(self) -> List[FlowGraph]:
        return list(_store.values())

    def get_by_id(self, flow_id: str) -> Optional[FlowGraph]:
        return _store.get(flow_id)

    def create(self, data: FlowGraphCreate) -> FlowGraph:
        flow = FlowGraph(**data.model_dump())
        _store[flow.id] = flow
        return flow

    def update(self, flow_id: str, data: FlowGraphCreate) -> Optional[FlowGraph]:
        if flow_id not in _store:
            return None
        updated = FlowGraph(
            id=flow_id,
            created_at=_store[flow_id].created_at,
            updated_at=datetime.utcnow(),
            **data.model_dump(),
        )
        _store[flow_id] = updated
        return updated

    def delete(self, flow_id: str) -> bool:
        if flow_id not in _store:
            return False
        del _store[flow_id]
        return True

    def execute(self, flow_id: str) -> Optional[ExecutionResult]:
        flow = _store.get(flow_id)
        if not flow:
            return None

        start = time.time()
        # Simulate execution logic
        executed = len(flow.nodes)
        duration_ms = (time.time() - start) * 1000 + executed * 50  # simulate work

        return ExecutionResult(
            flow_id=flow_id,
            status="success",
            message=f"Executed {executed} nodes successfully",
            executed_nodes=executed,
            duration_ms=round(duration_ms, 2),
        )


flow_service = FlowService()
