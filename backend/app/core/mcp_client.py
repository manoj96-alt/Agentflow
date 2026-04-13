"""
MCPClient
=========
Async context-manager client for a single MCP stdio server.

Usage
-----
    from app.core.mcp_client import MCPClient, StdioServerConfig, mcp_pool

    # One-shot usage
    async with MCPClient(config) as client:
        tools  = await client.list_tools()
        result = await client.call_tool("db_query", {"sql": "SELECT * FROM agents"})

    # Via pool (registered in main.py)
    async with mcp_pool.connect("flowforge") as client:
        result = await client.call_tool_json("db_list_tables", {})
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from mcp import ClientSession, types
from mcp.client.stdio import stdio_client, StdioServerParameters

logger = logging.getLogger(__name__)


# ─── Config ───────────────────────────────────────────────────────────────────

@dataclass
class StdioServerConfig:
    """Parameters to launch an MCP server as a stdio subprocess."""
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] | None = None


# ─── Tool manifest entry ──────────────────────────────────────────────────────

@dataclass
class ToolInfo:
    name: str
    description: str
    input_schema: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


# ─── Client ───────────────────────────────────────────────────────────────────

class MCPClient:
    """
    Connects to one MCP stdio server for the duration of an async context.
    Caches the tool manifest so agents can inspect available tools without
    a second round-trip.
    """

    def __init__(self, config: StdioServerConfig) -> None:
        self._config = config
        self._session: ClientSession | None = None
        self._stdio_cm = None
        self._tool_cache: dict[str, ToolInfo] | None = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def __aenter__(self) -> "MCPClient":
        params = StdioServerParameters(
            command=self._config.command,
            args=self._config.args,
            env=self._config.env,
        )
        self._stdio_cm = stdio_client(params)
        read, write = await self._stdio_cm.__aenter__()
        self._session = ClientSession(read, write)
        await self._session.__aenter__()
        await self._session.initialize()
        logger.info("MCPClient connected: %s %s", self._config.command,
                    " ".join(self._config.args))
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._session:
            try:
                await self._session.__aexit__(None, None, None)
            except Exception:
                pass
            self._session = None
        if self._stdio_cm:
            try:
                await self._stdio_cm.__aexit__(None, None, None)
            except Exception:
                pass
            self._stdio_cm = None
        self._tool_cache = None

    # ── Tool discovery ────────────────────────────────────────────────────────

    async def list_tools(self, *, force_refresh: bool = False) -> list[ToolInfo]:
        """
        Return all tools advertised by the server.
        Cached after first call; use force_refresh=True to re-fetch.
        """
        if self._tool_cache is not None and not force_refresh:
            return list(self._tool_cache.values())

        assert self._session, "Not connected"
        result: types.ListToolsResult = await self._session.list_tools()
        self._tool_cache = {
            t.name: ToolInfo(
                name=t.name,
                description=t.description or "",
                input_schema=t.inputSchema if isinstance(t.inputSchema, dict) else {},
            )
            for t in result.tools
        }
        logger.info("Discovered %d tools: %s", len(self._tool_cache),
                    list(self._tool_cache))
        return list(self._tool_cache.values())

    def get_tool(self, name: str) -> ToolInfo | None:
        """Look up a cached tool by name. Call list_tools() first."""
        return (self._tool_cache or {}).get(name)

    def tool_names(self) -> list[str]:
        return list((self._tool_cache or {}).keys())

    # ── Tool execution ────────────────────────────────────────────────────────

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Invoke a tool and return a normalised result:

            {
                "tool":    str,
                "success": bool,
                "content": list[str],   # text blocks from the server
                "raw":     CallToolResult,
            }
        """
        assert self._session, "Not connected"

        if self._tool_cache and name not in self._tool_cache:
            raise ValueError(
                f"Tool '{name}' not found. Available: {list(self._tool_cache)}"
            )

        logger.info("Calling tool '%s' args=%s", name, arguments)
        result: types.CallToolResult = await self._session.call_tool(
            name, arguments or {}
        )

        text_blocks = [
            b.text for b in result.content if isinstance(b, types.TextContent)
        ]
        return {
            "tool": name,
            "success": not result.isError,
            "content": text_blocks,
            "raw": result,
        }

    async def call_tool_json(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> Any:
        """
        Same as call_tool but parses the first text block as JSON.
        Returns the parsed value, or the raw string on failure.
        """
        result = await self.call_tool(name, arguments)
        if result["content"]:
            try:
                return json.loads(result["content"][0])
            except json.JSONDecodeError:
                return result["content"][0]
        return None


# ─── Pool ─────────────────────────────────────────────────────────────────────

class MCPClientPool:
    """
    Registry of named MCP server configurations.
    Yields a fresh connected MCPClient per request via async context manager.
    """

    def __init__(self) -> None:
        self._configs: dict[str, StdioServerConfig] = {}

    def register(self, name: str, config: StdioServerConfig) -> None:
        self._configs[name] = config
        logger.info("Registered MCP server '%s'", name)

    def list_servers(self) -> dict[str, StdioServerConfig]:
        """Return all registered server configs."""
        return dict(self._configs)

    def remove(self, name: str) -> bool:
        """Remove a registered server. Returns True if removed."""
        if name in self._configs:
            del self._configs[name]
            return True
        return False

    def get_config(self, name: str) -> StdioServerConfig | None:
        return self._configs.get(name)

    @asynccontextmanager
    async def connect(self, server_name: str):
        """
        Async context manager that yields a ready MCPClient with tool
        cache pre-populated.

            async with pool.connect("flowforge") as client:
                result = await client.call_tool_json("db_query", {"sql": "..."})
        """
        config = self._configs.get(server_name)
        if config is None:
            raise KeyError(f"No MCP server registered as '{server_name}'")
        async with MCPClient(config) as client:
            await client.list_tools()   # warm cache
            yield client


# Singleton — registered in main.py lifespan
mcp_pool = MCPClientPool()
