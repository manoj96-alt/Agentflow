"""
Plugin System
=============
Defines the plugin interface and a dynamic registry for loading
external agents, tools, and connectors.

Plugin types
------------
AgentPlugin   — a custom agent implementation with execute() method
ToolPlugin    — a custom tool with call() method (wraps MCP concepts)
ConnectorPlugin — an external data source/sink (email, Slack, DB, etc.)

Each plugin registers itself via @plugin_registry.register().
The registry exposes list/get/call endpoints used by the REST API.

Built-in example plugins (shipped with AgentFlow):
- SummarizerAgentPlugin  — always summarises its input state
- EchoToolPlugin         — returns its arguments as output (for testing)
- WebhookConnectorPlugin — POSTs state to a webhook URL
"""

from __future__ import annotations

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# ─── Base interfaces ──────────────────────────────────────────────────────────

@dataclass
class PluginMeta:
    id:          str
    name:        str
    version:     str
    description: str
    author:      str
    plugin_type: str      # "agent" | "tool" | "connector"
    tags:        list[str] = field(default_factory=list)
    config_schema: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id":            self.id,
            "name":          self.name,
            "version":       self.version,
            "description":   self.description,
            "author":        self.author,
            "plugin_type":   self.plugin_type,
            "tags":          self.tags,
            "config_schema": self.config_schema,
        }


class AgentPlugin(ABC):
    """Base class for custom agent plugins."""

    @property
    @abstractmethod
    def meta(self) -> PluginMeta: ...

    @abstractmethod
    async def execute(
        self,
        prompt: str,
        shared_state: dict[str, Any],
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Execute the agent and return state updates.
        Returns: { output: str, state_updates: dict, reasoning: str }
        """
        ...


class ToolPlugin(ABC):
    """Base class for custom tool plugins."""

    @property
    @abstractmethod
    def meta(self) -> PluginMeta: ...

    @abstractmethod
    async def call(
        self,
        arguments: dict[str, Any],
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute the tool and return { result: Any, success: bool }"""
        ...


class ConnectorPlugin(ABC):
    """Base class for external connector plugins (email, Slack, DB, etc.)"""

    @property
    @abstractmethod
    def meta(self) -> PluginMeta: ...

    @abstractmethod
    async def send(
        self,
        payload: dict[str, Any],
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Send data via this connector. Returns { success: bool, message: str }"""
        ...

    async def receive(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        """Optional: receive/poll data from connector. Returns list of items."""
        return []


# ─── Registry ─────────────────────────────────────────────────────────────────

class PluginRegistry:
    """
    Central registry for all plugins.
    Plugins register themselves at import time via @registry.register().
    """

    def __init__(self) -> None:
        self._agents:     dict[str, AgentPlugin]     = {}
        self._tools:      dict[str, ToolPlugin]       = {}
        self._connectors: dict[str, ConnectorPlugin]  = {}

    def register(self, plugin: AgentPlugin | ToolPlugin | ConnectorPlugin) -> None:
        pid = plugin.meta.id
        if isinstance(plugin, AgentPlugin):
            self._agents[pid] = plugin
            logger.info("Registered AgentPlugin: %s v%s", pid, plugin.meta.version)
        elif isinstance(plugin, ToolPlugin):
            self._tools[pid] = plugin
            logger.info("Registered ToolPlugin: %s v%s", pid, plugin.meta.version)
        elif isinstance(plugin, ConnectorPlugin):
            self._connectors[pid] = plugin
            logger.info("Registered ConnectorPlugin: %s v%s", pid, plugin.meta.version)

    # ── Queries ───────────────────────────────────────────────────────────────

    def list_all(self) -> list[dict[str, Any]]:
        all_plugins = (
            list(self._agents.values()) +
            list(self._tools.values()) +
            list(self._connectors.values())
        )
        return [p.meta.to_dict() for p in all_plugins]

    def list_by_type(self, plugin_type: str) -> list[dict[str, Any]]:
        mapping = {"agent": self._agents, "tool": self._tools, "connector": self._connectors}
        bucket = mapping.get(plugin_type, {})
        return [p.meta.to_dict() for p in bucket.values()]

    def get_agent(self, plugin_id: str) -> AgentPlugin | None:
        return self._agents.get(plugin_id)

    def get_tool(self, plugin_id: str) -> ToolPlugin | None:
        return self._tools.get(plugin_id)

    def get_connector(self, plugin_id: str) -> ConnectorPlugin | None:
        return self._connectors.get(plugin_id)

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_agent(
        self, plugin_id: str, prompt: str, shared_state: dict, config: dict
    ) -> dict[str, Any]:
        agent = self.get_agent(plugin_id)
        if not agent:
            return {"success": False, "error": f"Agent plugin '{plugin_id}' not found"}
        try:
            result = await agent.execute(prompt, shared_state, config)
            return {"success": True, "plugin_id": plugin_id, **result}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def call_tool(
        self, plugin_id: str, arguments: dict, config: dict
    ) -> dict[str, Any]:
        tool = self.get_tool(plugin_id)
        if not tool:
            return {"success": False, "error": f"Tool plugin '{plugin_id}' not found"}
        try:
            result = await tool.call(arguments, config)
            return {"success": True, "plugin_id": plugin_id, **result}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def send_connector(
        self, plugin_id: str, payload: dict, config: dict
    ) -> dict[str, Any]:
        connector = self.get_connector(plugin_id)
        if not connector:
            return {"success": False, "error": f"Connector plugin '{plugin_id}' not found"}
        try:
            result = await connector.send(payload, config)
            return {"success": True, "plugin_id": plugin_id, **result}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ── Singleton ─────────────────────────────────────────────────────────────────
plugin_registry = PluginRegistry()


# ─── Built-in example plugins ─────────────────────────────────────────────────

class SummarizerAgentPlugin(AgentPlugin):
    """
    Example agent plugin that summarises all llm_response keys in shared state.
    """
    @property
    def meta(self) -> PluginMeta:
        return PluginMeta(
            id="builtin.summarizer",
            name="Summarizer Agent",
            version="1.0.0",
            description="Collects all agent outputs from shared state and returns a concise summary.",
            author="AgentFlow",
            plugin_type="agent",
            tags=["builtin", "summarization"],
            config_schema={
                "max_length": {"type": "integer", "default": 200, "description": "Max summary length in words"},
            },
        )

    async def execute(self, prompt: str, shared_state: dict, config: dict) -> dict:
        outputs = {k: v for k, v in shared_state.items() if "llm_response" in k and not k.startswith("__")}
        combined = "\n\n".join(f"{k}:\n{v}" for k, v in list(outputs.items())[:5])
        max_len = config.get("max_length", 200)
        words = combined.split()
        summary = " ".join(words[:max_len]) + ("…" if len(words) > max_len else "")
        return {
            "output": summary or "No agent outputs found in shared state.",
            "state_updates": {"plugin:summarizer:output": summary},
            "reasoning": f"Collected {len(outputs)} agent outputs and summarised to {max_len} words.",
        }


class EchoToolPlugin(ToolPlugin):
    """
    Example tool plugin that echoes its arguments. Useful for testing plugin wiring.
    """
    @property
    def meta(self) -> PluginMeta:
        return PluginMeta(
            id="builtin.echo",
            name="Echo Tool",
            version="1.0.0",
            description="Returns its arguments as output. Useful for testing plugin connectivity.",
            author="AgentFlow",
            plugin_type="tool",
            tags=["builtin", "testing"],
            config_schema={},
        )

    async def call(self, arguments: dict, config: dict) -> dict:
        return {
            "result": {"echo": arguments, "timestamp": datetime.utcnow().isoformat()},
            "success": True,
        }


class WebhookConnectorPlugin(ConnectorPlugin):
    """
    Example connector that POSTs workflow state to a webhook URL.
    Config: { url: str, headers: dict, include_keys: list[str] }
    """
    @property
    def meta(self) -> PluginMeta:
        return PluginMeta(
            id="builtin.webhook",
            name="Webhook Connector",
            version="1.0.0",
            description="POSTs selected state keys to a webhook URL as JSON.",
            author="AgentFlow",
            plugin_type="connector",
            tags=["builtin", "webhook", "http"],
            config_schema={
                "url":          {"type": "string",  "required": True,  "description": "Webhook URL"},
                "headers":      {"type": "object",  "required": False, "description": "Extra HTTP headers"},
                "include_keys": {"type": "array",   "required": False, "description": "State keys to include (all if empty)"},
                "timeout":      {"type": "integer", "default": 10,     "description": "Request timeout seconds"},
            },
        )

    async def send(self, payload: dict, config: dict) -> dict:
        url = config.get("url")
        if not url:
            return {"success": False, "message": "No webhook URL configured"}

        headers = {"Content-Type": "application/json", **config.get("headers", {})}
        include = config.get("include_keys", [])
        data = {k: v for k, v in payload.items() if not include or k in include}
        timeout = config.get("timeout", 10)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=data, headers=headers)
            return {
                "success": resp.status_code < 400,
                "message": f"HTTP {resp.status_code}",
                "status_code": resp.status_code,
            }
        except Exception as e:
            return {"success": False, "message": str(e)}


# ── Register built-in plugins ─────────────────────────────────────────────────
plugin_registry.register(SummarizerAgentPlugin())
plugin_registry.register(EchoToolPlugin())
plugin_registry.register(WebhookConnectorPlugin())
