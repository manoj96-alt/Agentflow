"""
MCP Server Registry
===================
Manages MCP server registrations dynamically.
New servers can be added via POST /api/mcp/servers without code changes.

Storage: in-memory (survives process lifetime).
The built-in "flowforge" server is registered at startup in main.py.

Each server config is a StdioServerConfig (command + args).
Clients are lazily created on first connect and cached.

HTTP surface:
  GET    /api/mcp/servers              — list all registered servers
  POST   /api/mcp/servers              — register a new server
  DELETE /api/mcp/servers/{name}       — remove a server
  GET    /api/mcp/servers/{name}/tools — list tools from a specific server
  POST   /api/mcp/servers/{name}/call  — call a tool on a specific server
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.mcp_client import mcp_pool, StdioServerConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp/servers", tags=["mcp"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ServerRegistration(BaseModel):
    name:    str  = Field(..., description="Unique server name, e.g. 'my-db-server'")
    command: str  = Field(..., description="Executable to run, e.g. 'python' or 'npx'")
    args:    list[str] = Field(default_factory=list, description="Arguments to pass to the command")
    description: str = Field(default="", description="Human-readable description")


class ToolCallRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/", summary="List all registered MCP servers")
async def list_servers():
    """
    Returns all registered servers with their command, args and status.
    The built-in 'flowforge' server is always present.
    """
    servers = []
    for name, config in mcp_pool.list_servers().items():
        servers.append({
            "name":        name,
            "command":     config.command,
            "args":        config.args,
            "builtin":     name == "flowforge",
        })
    return {"servers": servers, "count": len(servers)}


@router.post("/", summary="Register a new MCP server (no code changes needed)")
async def register_server(body: ServerRegistration):
    """
    Dynamically register a new MCP server.

    The server must be launchable as a stdio subprocess.
    It will be immediately available for tool discovery and execution.

    **Example — Python server:**
    ```json
    { "name": "my-tools", "command": "python", "args": ["-m", "my_mcp_server"] }
    ```

    **Example — Node.js server:**
    ```json
    { "name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
    ```
    """
    if body.name in mcp_pool.list_servers() and body.name == "flowforge":
        raise HTTPException(status_code=409, detail="Cannot overwrite the built-in 'flowforge' server")

    config = StdioServerConfig(command=body.command, args=body.args)
    mcp_pool.register(body.name, config)

    # Verify the server is reachable by listing its tools
    try:
        async with mcp_pool.connect(body.name) as client:
            tools = await client.list_tools()
            tool_names = [t.name for t in tools]
    except Exception as exc:
        # Still keep it registered but warn
        logger.warning("Server '%s' registered but tool discovery failed: %s", body.name, exc)
        tool_names = []

    logger.info("Registered MCP server '%s' with %d tools: %s", body.name, len(tool_names), tool_names)
    return {
        "registered": True,
        "name": body.name,
        "tools_discovered": tool_names,
        "tool_count": len(tool_names),
    }


@router.delete("/{server_name}", summary="Unregister an MCP server")
async def unregister_server(server_name: str):
    if server_name == "flowforge":
        raise HTTPException(status_code=403, detail="Cannot remove the built-in 'flowforge' server")
    removed = mcp_pool.remove(server_name)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Server '{server_name}' not found")
    return {"removed": True, "name": server_name}


@router.get("/{server_name}/tools", summary="List tools from a specific MCP server")
async def list_server_tools(server_name: str):
    config = mcp_pool.get_config(server_name)
    if not config:
        raise HTTPException(status_code=404, detail=f"Server '{server_name}' not registered")
    try:
        async with mcp_pool.connect(server_name) as client:
            tools = await client.list_tools()
        return {
            "server": server_name,
            "tools": [
                {
                    "name":         t.name,
                    "description":  t.description,
                    "input_schema": t.input_schema,
                }
                for t in tools
            ],
            "count": len(tools),
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Cannot connect to '{server_name}': {exc}")


@router.post("/{server_name}/call", summary="Call a tool on a specific MCP server")
async def call_server_tool(server_name: str, body: ToolCallRequest):
    config = mcp_pool.get_config(server_name)
    if not config:
        raise HTTPException(status_code=404, detail=f"Server '{server_name}' not registered")
    try:
        async with mcp_pool.connect(server_name) as client:
            result = await client.call_tool_json(body.tool_name, body.arguments)
        return {
            "server":    server_name,
            "tool":      body.tool_name,
            "success":   True,
            "result":    result,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
