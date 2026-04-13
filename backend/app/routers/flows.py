from fastapi import APIRouter, HTTPException, status
from typing import List
from app.models.flow import FlowGraph, FlowGraphCreate, ExecutionResult
from app.services.flow_service import flow_service

router = APIRouter(prefix="/flows", tags=["flows"])


@router.get("/", response_model=List[FlowGraph])
def list_flows():
    """Return all saved flows."""
    return flow_service.get_all()


@router.get("/{flow_id}", response_model=FlowGraph)
def get_flow(flow_id: str):
    """Get a single flow by ID."""
    flow = flow_service.get_by_id(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    return flow


@router.post("/", response_model=FlowGraph, status_code=status.HTTP_201_CREATED)
def create_flow(data: FlowGraphCreate):
    """Create a new flow."""
    return flow_service.create(data)


@router.put("/{flow_id}", response_model=FlowGraph)
def update_flow(flow_id: str, data: FlowGraphCreate):
    """Update an existing flow."""
    flow = flow_service.update(flow_id, data)
    if not flow:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    return flow


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flow(flow_id: str):
    """Delete a flow."""
    if not flow_service.delete(flow_id):
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")


@router.post("/{flow_id}/execute", response_model=ExecutionResult)
def execute_flow(flow_id: str):
    """Execute a flow and return results."""
    result = flow_service.execute(flow_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    return result
