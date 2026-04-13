"""
MCP Router
==========
REST surface for MCP tool discovery, direct execution, and agent-scoped execution.

Endpoints:
  GET  /api/mcp/servers             — list registered MCP servers
  GET  /api/mcp/tools               — discover all tools
  POST /api/mcp/tools/call          — call any tool directly
  POST /api/mcp/agents/{id}/execute — run an agent in a workflow run
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.mcp_client import mcp_pool
from app.services.agent_execution_service import agent_execution_service

router = APIRouter(prefix="/mcp", tags=["mcp"])

MCP_SERVER = "flowforge"


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ToolSchema(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]


class ToolCallRequest(BaseModel):
    tool_name: str = Field(..., description="MCP tool name to invoke")
    arguments: dict[str, Any] = Field(
        default_factory=dict,
        description="Arguments matching the tool's inputSchema",
    )


class ToolCallResponse(BaseModel):
    tool: str
    success: bool
    content: list[str]
    parsed: Any = None


class AgentExecuteRequest(BaseModel):
    run_id: str = Field(
        ...,
        description="Active run_id to use as the shared-state context",
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/servers",
    summary="List registered MCP servers",
)
async def list_servers():
    """Return all MCP server names registered with the pool."""
    return {"servers": mcp_pool.list_servers()}


@router.get(
    "/tools",
    response_model=list[ToolSchema],
    summary="Discover tools from the MCP server",
)
async def list_tools():
    """
    Connect to the FlowForge MCP server and return every available tool
    with its name, description, and JSON input schema.
    """
    try:
        async with mcp_pool.connect(MCP_SERVER) as client:
            tools = await client.list_tools()
        return [
            ToolSchema(
                name=t.name,
                description=t.description,
                input_schema=t.input_schema,
            )
            for t in tools
        ]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MCP unavailable: {exc}")


@router.post(
    "/tools/call",
    response_model=ToolCallResponse,
    summary="Execute an MCP tool directly",
)
async def call_tool(body: ToolCallRequest):
    """
    Call any tool exposed by the MCP server.

    **api_call example:**
    ```json
    {
      "tool_name": "api_call",
      "arguments": { "url": "https://httpbin.org/json", "method": "GET" }
    }
    ```

    **db_query example:**
    ```json
    {
      "tool_name": "db_query",
      "arguments": { "sql": "SELECT id, name, role FROM agents" }
    }
    ```

    **db_list_tables example:**
    ```json
    {
      "tool_name": "db_list_tables",
      "arguments": {}
    }
    ```
    """
    try:
        async with mcp_pool.connect(MCP_SERVER) as client:
            raw = await client.call_tool(body.tool_name, body.arguments)

        parsed = None
        if raw["content"]:
            try:
                parsed = json.loads(raw["content"][0])
            except (json.JSONDecodeError, TypeError):
                pass

        return ToolCallResponse(
            tool=body.tool_name,
            success=raw["success"],
            content=raw["content"],
            parsed=parsed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Tool failed: {exc}")


@router.post(
    "/agents/{agent_id}/execute",
    summary="Execute an agent using MCP tools within a workflow run",
)
async def execute_agent(agent_id: str, body: AgentExecuteRequest):
    """
    Run a registered agent inside an active workflow run.

    The agent will:
    1. Read relevant keys from the shared Redis state (`run_id`).
    2. Discover available MCP tools.
    3. Call appropriate tools based on its role.
    4. Write results back to the shared state.

    Returns the full `AgentExecutionReport`.
    """
    report = await agent_execution_service.execute_agent_in_run(
        agent_id=agent_id,
        run_id=body.run_id,
    )
    if report.status == "error" and "not found" in (report.error or ""):
        raise HTTPException(status_code=404, detail=report.error)
    return report.to_dict()


# ─── Tool registry endpoints ──────────────────────────────────────────────────

class ToolRegistryEntry(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]
    category: str      # "http" | "database" | "custom"
    example_args: dict[str, Any] = {}


class AgentToolAssignment(BaseModel):
    agent_id: str
    tool_names: list[str]


# Agent tool assignments — stored in shared core module to avoid circular imports
from app.core.tool_registry import get_agent_tools as _get_tools, set_agent_tools as _set_tools, clear_agent_tools as _clear_tools

TOOL_CATEGORIES = {
    "api_call":       "http",
    "api_fetch":      "http",
    "db_query":       "database",
    "sql_query":      "database",
    "db_list_tables": "database",
    "file_tool":      "file",
}

TOOL_EXAMPLES = {
    "api_call":   {"url": "https://httpbin.org/json", "method": "GET"},
    "api_fetch":  {"url": "https://api.github.com/repos/anthropics/anthropic-sdk-python"},
    "db_query":   {"sql": "SELECT id, name, role FROM agents WHERE active=1"},
    "sql_query":  {"sql": "SELECT * FROM runs WHERE status = :status", "params": {"status": "completed"}},
    "db_list_tables": {},
    "file_tool":   {"operation": "list", "path": "."},
}


@router.get(
    "/registry",
    response_model=list[ToolRegistryEntry],
    summary="Get full tool registry with categories and examples",
)
async def get_tool_registry():
    """
    Return all available MCP tools enriched with category and example arguments.
    Used by the frontend tool registry UI.
    """
    try:
        async with mcp_pool.connect(MCP_SERVER) as client:
            tools = await client.list_tools()
        return [
            ToolRegistryEntry(
                name=t.name,
                description=t.description,
                input_schema=t.input_schema,
                category=TOOL_CATEGORIES.get(t.name, "custom"),
                example_args=TOOL_EXAMPLES.get(t.name, {}),
            )
            for t in tools
        ]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MCP unavailable: {exc}")


@router.get(
    "/agents/{agent_id}/tools",
    summary="Get tools assigned to an agent",
)
async def get_agent_tools(agent_id: str):
    """Return the list of tool names attached to a specific agent."""
    return {"agent_id": agent_id, "tools": _get_tools(agent_id) or []}


@router.put(
    "/agents/{agent_id}/tools",
    summary="Assign tools to an agent",
)
async def assign_agent_tools(agent_id: str, body: AgentToolAssignment):
    """
    Attach a list of MCP tools to an agent.
    The agent's execution will use only these tools.

    ```json
    { "agent_id": "agent-abc", "tool_names": ["api_fetch", "db_query"] }
    ```
    """
    # Validate tool names
    try:
        async with mcp_pool.connect(MCP_SERVER) as client:
            tools = await client.list_tools()
        valid_names = {t.name for t in tools}
        invalid = [n for n in body.tool_names if n not in valid_names]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Unknown tools: {invalid}. Available: {sorted(valid_names)}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MCP unavailable: {exc}")

    _set_tools(agent_id, body.tool_names)
    return {"agent_id": agent_id, "tools": body.tool_names, "assigned": True}


@router.delete(
    "/agents/{agent_id}/tools",
    summary="Remove all tool assignments from an agent",
)
async def clear_agent_tools(agent_id: str):
    """Remove all tool assignments — agent falls back to role-based defaults."""
    _clear_tools(agent_id)
    return {"agent_id": agent_id, "tools": [], "cleared": True}


@router.get(
    "/tools/{tool_name}/test",
    summary="Test a tool with its example arguments",
)
async def test_tool(tool_name: str):
    """Run a tool with its built-in example arguments. Good for verifying tools work."""
    example = TOOL_EXAMPLES.get(tool_name)
    if example is None:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    try:
        async with mcp_pool.connect(MCP_SERVER) as client:
            raw = await client.call_tool(tool_name, example)
        parsed = None
        if raw["content"]:
            try:
                import json as _json
                parsed = _json.loads(raw["content"][0])
            except Exception:
                pass
        return {"tool": tool_name, "args_used": example, "success": raw["success"], "parsed": parsed}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
