"""
Shared in-memory agent→tools registry.
Imported by both mcp router (writes) and agent execution service (reads).
Avoids circular imports.
"""
from __future__ import annotations

# agent_id → list of tool names attached to that agent
_agent_tools: dict[str, list[str]] = {}


def get_agent_tools(agent_id: str) -> list[str] | None:
    """Return attached tools for agent, or None if no assignment exists."""
    return _agent_tools.get(agent_id)


def set_agent_tools(agent_id: str, tools: list[str]) -> None:
    _agent_tools[agent_id] = tools


def clear_agent_tools(agent_id: str) -> None:
    _agent_tools.pop(agent_id, None)


def all_assignments() -> dict[str, list[str]]:
    return dict(_agent_tools)
