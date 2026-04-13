"""
Optimizer & Plugin Router
=========================

GET  /api/optimizer/metrics              — all agent performance metrics
GET  /api/optimizer/metrics/{agent_id}   — one agent's metrics
POST /api/optimizer/analyse/{agent_id}   — LLM analysis + suggestions

GET  /api/plugins/                       — list all plugins
GET  /api/plugins/{type}                 — list by type (agent/tool/connector)
POST /api/plugins/agents/{id}/execute    — run an agent plugin
POST /api/plugins/tools/{id}/call        — call a tool plugin
POST /api/plugins/connectors/{id}/send   — send via connector
"""
from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.agent_optimizer import agent_optimizer
from app.plugins import plugin_registry

router = APIRouter(tags=["optimizer-plugins"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class AnalyseRequest(BaseModel):
    agent_name:     str
    role:           str
    current_model:  str
    current_prompt: str


class RecordRequest(BaseModel):
    agent_id:       str
    agent_name:     str
    role:           str
    model:          str
    status:         str
    duration_ms:    float
    tokens:         int = 0
    tool_called:    bool = False
    tool_succeeded: bool = False
    log_entry:      dict[str, Any] = Field(default_factory=dict)


class PluginExecuteRequest(BaseModel):
    prompt:       str = ""
    shared_state: dict[str, Any] = Field(default_factory=dict)
    arguments:    dict[str, Any] = Field(default_factory=dict)
    payload:      dict[str, Any] = Field(default_factory=dict)
    config:       dict[str, Any] = Field(default_factory=dict)


# ─── Optimizer endpoints ──────────────────────────────────────────────────────

optimizer_router = APIRouter(prefix="/optimizer", tags=["optimizer"])


@optimizer_router.get("/metrics", summary="All agent performance metrics")
async def get_all_metrics():
    return {"metrics": agent_optimizer.get_all_metrics()}


@optimizer_router.get("/metrics/{agent_id}", summary="One agent's performance metrics")
async def get_agent_metrics(agent_id: str):
    m = agent_optimizer.get_metrics(agent_id)
    if not m:
        return {"agent_id": agent_id, "metrics": None, "message": "No data recorded yet"}
    return {"agent_id": agent_id, "metrics": m.to_dict()}


@optimizer_router.post("/record", summary="Record one agent execution for tracking")
async def record_execution(body: RecordRequest):
    agent_optimizer.record_execution(
        agent_id=body.agent_id,
        agent_name=body.agent_name,
        role=body.role,
        model=body.model,
        status=body.status,
        duration_ms=body.duration_ms,
        tokens=body.tokens,
        tool_called=body.tool_called,
        tool_succeeded=body.tool_succeeded,
        log_entry=body.log_entry,
    )
    return {"recorded": True, "agent_id": body.agent_id}


@optimizer_router.post("/analyse/{agent_id}", summary="LLM analysis + optimization suggestions")
async def analyse_agent(agent_id: str, body: AnalyseRequest):
    """
    Uses the LLM to analyse this agent's recent performance and return:
    - Concrete prompt improvements
    - Model switch recommendation
    - Priority level

    The analysis uses a fast model (claude-haiku) to keep cost low.
    """
    suggestion = await agent_optimizer.analyse(
        agent_id=agent_id,
        agent_name=body.agent_name,
        role=body.role,
        current_model=body.current_model,
        current_prompt=body.current_prompt,
    )
    return suggestion.to_dict()


# ─── Plugin endpoints ─────────────────────────────────────────────────────────

plugin_router = APIRouter(prefix="/plugins", tags=["plugins"])


@plugin_router.get("/", summary="List all registered plugins")
async def list_plugins():
    return {"plugins": plugin_registry.list_all(), "count": len(plugin_registry.list_all())}


@plugin_router.get("/{plugin_type}", summary="List plugins by type (agent/tool/connector)")
async def list_plugins_by_type(plugin_type: str):
    if plugin_type not in ("agent", "tool", "connector"):
        raise HTTPException(status_code=400, detail="plugin_type must be agent, tool, or connector")
    return {"plugins": plugin_registry.list_by_type(plugin_type), "type": plugin_type}


@plugin_router.post("/agents/{plugin_id}/execute", summary="Execute an agent plugin")
async def execute_agent_plugin(plugin_id: str, body: PluginExecuteRequest):
    result = await plugin_registry.execute_agent(plugin_id, body.prompt, body.shared_state, body.config)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Plugin execution failed"))
    return result


@plugin_router.post("/tools/{plugin_id}/call", summary="Call a tool plugin")
async def call_tool_plugin(plugin_id: str, body: PluginExecuteRequest):
    result = await plugin_registry.call_tool(plugin_id, body.arguments, body.config)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Plugin call failed"))
    return result


@plugin_router.post("/connectors/{plugin_id}/send", summary="Send via connector plugin")
async def send_connector_plugin(plugin_id: str, body: PluginExecuteRequest):
    result = await plugin_registry.send_connector(plugin_id, body.payload, body.config)
    return result
