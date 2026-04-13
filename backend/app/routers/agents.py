from fastapi import APIRouter, HTTPException, status
from typing import List
from app.models.agent import AgentCreate, AgentResponse
from app.services.agent_service import agent_service

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post(
    "/",
    response_model=AgentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new agent",
)
def create_agent(data: AgentCreate):
    """
    Create a new agent with a name, system prompt, model, and optional memory flag.

    - **name**: Human-readable label for this agent
    - **prompt**: System prompt that defines the agent's behavior
    - **model**: One of the supported LLM model identifiers
    - **memory**: If `true`, the agent will retain conversation history across turns
    """
    agent = agent_service.create(data)
    return AgentResponse.from_agent(agent)


@router.get(
    "/",
    response_model=List[AgentResponse],
    summary="List all agents",
)
def list_agents():
    """Return all registered agents."""
    return [AgentResponse.from_agent(a) for a in agent_service.get_all()]


@router.get(
    "/{agent_id}",
    response_model=AgentResponse,
    summary="Get agent by ID",
)
def get_agent(agent_id: str):
    """Fetch a single agent by its UUID."""
    agent = agent_service.get_by_id(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return AgentResponse.from_agent(agent)


@router.put(
    "/{agent_id}",
    response_model=AgentResponse,
    summary="Update an agent",
)
def update_agent(agent_id: str, data: AgentCreate):
    """Replace an agent's fields entirely."""
    agent = agent_service.update(agent_id, data)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return AgentResponse.from_agent(agent)


@router.delete(
    "/{agent_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an agent",
)
def delete_agent(agent_id: str):
    """Remove an agent permanently."""
    if not agent_service.delete(agent_id):
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")


# ─── Agent execution via MCP ─────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel

class _ExecuteRequest(_BaseModel):
    run_id: str


@router.post(
    "/{agent_id}/execute",
    summary="Execute an agent within a workflow run",
)
async def execute_agent(agent_id: str, body: _ExecuteRequest):
    """
    Execute a single agent as part of a workflow run.

    The agent will:
    1. Connect to the MCP server and discover available tools.
    2. Call appropriate tools based on its role.
    3. Write results into the run's shared Redis state.

    Returns a full execution report.
    """
    from app.services.agent_execution_service import agent_execution_service
    report = await agent_execution_service.execute_agent_in_run(agent_id, body.run_id)
    if report.status == "error" and "not found" in (report.error or ""):
        raise HTTPException(status_code=404, detail=report.error)
    return report.to_dict()
