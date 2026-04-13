"""
Tool Recommendation Router
==========================

POST /api/tools/recommend/agent      — recommend tools for one agent
POST /api/tools/recommend/workflow   — recommend tools for all agents in a workflow
GET  /api/tools/catalog              — full tool catalog with rich metadata
POST /api/tools/attach               — attach recommended tools to an agent (shortcut)
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any

from app.services.tool_recommender import (
    recommend_for_agent, recommend_for_workflow,
    recommendation_to_dict, TOOLS,
)
from app.core.tool_registry import set_agent_tools

router = APIRouter(prefix="/tools", tags=["tool-recommendations"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class AgentSpec(BaseModel):
    id:     str = ""
    name:   str = ""
    role:   str = "custom"
    prompt: str = ""


class AgentRecommendRequest(BaseModel):
    agent:          AgentSpec
    top_n:          int   = Field(3,    ge=1, le=6)
    min_confidence: float = Field(0.30, ge=0.0, le=1.0)


class WorkflowRecommendRequest(BaseModel):
    agents:          list[AgentSpec]
    top_n_per_agent: int = Field(3, ge=1, le=6)


class AttachRequest(BaseModel):
    agent_id:   str
    tool_names: list[str]


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/recommend/agent", summary="Recommend MCP tools for a single agent")
async def recommend_agent(body: AgentRecommendRequest):
    """
    Uses rule-based pre-filter + LLM (haiku) ranking to match the agent's
    role and task description to the most relevant MCP tools.

    Returns up to `top_n` matches ordered by confidence (0–1).
    Each match includes:
    - tool_name, category, description
    - confidence score
    - one-sentence reasoning from LLM
    - ready-to-use example arguments
    """
    rec = await recommend_for_agent(
        agent_id=body.agent.id,
        agent_name=body.agent.name or body.agent.role,
        role=body.agent.role,
        prompt=body.agent.prompt,
        top_n=body.top_n,
        min_confidence=body.min_confidence,
    )
    return recommendation_to_dict(rec)


@router.post("/recommend/workflow", summary="Recommend tools for all agents in a workflow")
async def recommend_workflow(body: WorkflowRecommendRequest):
    """
    Runs tool recommendation for every agent concurrently.
    Returns a list of per-agent recommendations.

    Ideal for the frontend to call once after workflow generation
    and show recommendations next to each node.
    """
    recs = await recommend_for_workflow(
        agents=[a.model_dump() for a in body.agents],
        top_n_per_agent=body.top_n_per_agent,
    )
    return {"recommendations": [recommendation_to_dict(r) for r in recs]}


@router.get("/catalog", summary="Full tool catalog with metadata")
async def get_catalog():
    """
    Returns the complete tool catalog used by the recommender,
    with descriptions, best-use keywords, recommended roles, and examples.
    """
    catalog = []
    for name, t in TOOLS.items():
        catalog.append({
            "name":        name,
            "category":    t["category"],
            "description": t["description"],
            "best_for":    t["best_for"],
            "roles":       t["roles"],
            "example":     t["example"],
        })
    return {"tools": catalog, "count": len(catalog)}


@router.post("/attach", summary="Attach tools to an agent (one-click from recommendations)")
async def attach_tools(body: AttachRequest):
    """
    Convenience endpoint — attaches a list of tools to an agent
    and returns the updated tool list. Used by the frontend
    'Accept recommendation' button.
    """
    await set_agent_tools(body.agent_id, body.tool_names)
    return {
        "agent_id":   body.agent_id,
        "tool_names": body.tool_names,
        "attached":   True,
        "count":      len(body.tool_names),
    }
