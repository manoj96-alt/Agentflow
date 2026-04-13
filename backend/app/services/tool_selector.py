"""
ToolSelector
============
Uses the LLM to reason about which MCP tool best fits the agent's
current task, then builds the correct arguments for that tool.

Pipeline per agent invocation:
  1. Fetch available tools from MCP server (or agent's attached subset).
  2. Call LLM with a structured "tool selection" prompt.
  3. Parse the LLM's JSON decision: { tool, arguments, reasoning }.
  4. Validate the chosen tool exists and arguments are safe.
  5. Return the selection (or None if LLM chose to skip tools).

Fallback chain:
  LLM picks tool → validate → execute
      ↓ (no tool / validation fails)
  LLM answers directly (no tool)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.llm.router import llm_router
from app.llm.types import GenerateParams

logger = logging.getLogger(__name__)


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class ToolSelection:
    """What the LLM decided to do."""
    tool_name: str | None        # None = skip tools, use LLM directly
    arguments: dict[str, Any]
    reasoning: str               # LLM's explanation of its choice
    confidence: float            # 0.0–1.0, self-reported by LLM
    fallback_to_llm: bool = False  # True when no tool was selected


# ─── Prompt templates ─────────────────────────────────────────────────────────

_SELECTION_SYSTEM = """\
You are a tool selection assistant for an AI agent pipeline.
Your job is to decide whether an agent should use an MCP tool or answer directly with its LLM reasoning.
Always respond with valid JSON only — no markdown, no explanation outside the JSON.
"""

_SELECTION_USER_TEMPLATE = """\
## Agent
Name: {agent_name}
Role: {agent_role}
Task (system prompt): {agent_prompt}

## Current Shared State (context from previous agents)
{state_summary}

## Available MCP Tools
{tools_description}

## Decision Required
Should this agent call an MCP tool to complete its task, or reason directly without a tool?

Respond with EXACTLY this JSON structure:
{{
  "tool_name": "<tool name or null if no tool needed>",
  "arguments": {{}},
  "reasoning": "<one sentence explaining your choice>",
  "confidence": <0.0 to 1.0>
}}

Rules:
- Use a tool when the task requires live data, HTTP calls, or database queries.
- Set tool_name to null when the task is purely analytical/generative.
- arguments must exactly match the tool's input schema.
- Only use tool names from the Available MCP Tools list.
- If the agent has no relevant tools for its task, set tool_name to null.
"""


# ─── Selector ─────────────────────────────────────────────────────────────────

class ToolSelector:
    """
    Asks the LLM to reason about which tool to use, then validates
    the decision against the actual tool manifest.
    """

    async def select(
        self,
        agent_name: str,
        agent_role: str,
        agent_prompt: str,
        agent_model: str,
        available_tools: list[dict[str, Any]],   # from MCPClient.list_tools()
        shared_state: dict[str, Any],
        attached_tools: list[str] | None = None,  # agent-specific allow-list
    ) -> ToolSelection:
        """
        Use the LLM to choose a tool (or decide no tool is needed).

        Parameters
        ----------
        available_tools:
            List of ToolInfo dicts from the MCP server.
        attached_tools:
            If set, restrict choices to this subset of tool names.
            None means all available tools are candidates.

        Returns
        -------
        ToolSelection — always succeeds; sets fallback_to_llm=True on any error.
        """
        # ── Filter to attached tools if specified ─────────────────────────────
        if attached_tools is not None:
            candidate_tools = [t for t in available_tools if t["name"] in attached_tools]
        else:
            candidate_tools = list(available_tools)

        if not candidate_tools:
            logger.info(
                "Agent '%s': no candidate tools — falling back to direct LLM",
                agent_name,
            )
            return ToolSelection(
                tool_name=None, arguments={},
                reasoning="No tools available for this agent",
                confidence=1.0, fallback_to_llm=True,
            )

        # ── Build tool description for the prompt ─────────────────────────────
        tools_desc = self._format_tools(candidate_tools)

        # ── Summarise relevant shared state ───────────────────────────────────
        state_summary = self._summarise_state(shared_state)

        user_prompt = _SELECTION_USER_TEMPLATE.format(
            agent_name=agent_name,
            agent_role=agent_role,
            agent_prompt=agent_prompt[:600],
            state_summary=state_summary,
            tools_description=tools_desc,
        )

        # ── Ask LLM to decide ─────────────────────────────────────────────────
        try:
            resp = await llm_router.generate(
                prompt=user_prompt,
                model=agent_model,
                params=GenerateParams(
                    system=_SELECTION_SYSTEM,
                    temperature=0.1,      # low temp for structured decision
                    max_tokens=512,
                ),
            )
            selection = self._parse_selection(resp.content, candidate_tools)
            logger.info(
                "Agent '%s' tool selection: tool=%s confidence=%.2f reason=%s",
                agent_name, selection.tool_name, selection.confidence, selection.reasoning,
            )
            return selection

        except Exception as exc:
            logger.warning(
                "Tool selection LLM call failed for '%s': %s — falling back",
                agent_name, exc,
            )
            return ToolSelection(
                tool_name=None, arguments={},
                reasoning=f"LLM selection failed: {exc}",
                confidence=0.0, fallback_to_llm=True,
            )

    # ─── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _format_tools(tools: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for t in tools:
            props = t.get("input_schema", {}).get("properties", {})
            required = t.get("input_schema", {}).get("required", [])
            param_list = ", ".join(
                f"{k}{'*' if k in required else ''}: {v.get('type','any')}"
                for k, v in props.items()
            )
            lines.append(f"- {t['name']}({param_list}): {t['description'][:120]}")
        return "\n".join(lines) if lines else "No tools available."

    @staticmethod
    def _summarise_state(state: dict[str, Any]) -> str:
        relevant = {
            k: v for k, v in state.items()
            if not k.startswith("__") and k not in
               ("flowStartTime", "flowEndTime", "totalNodes", "maxIterations", "totalSteps")
        }
        if not relevant:
            return "Empty — this is the first agent."
        lines = []
        for k, v in list(relevant.items())[:8]:
            v_str = str(v)[:120].replace("\n", " ")
            lines.append(f"  {k}: {v_str}")
        return "\n".join(lines)

    @staticmethod
    def _parse_selection(
        raw: str,
        candidate_tools: list[dict[str, Any]],
    ) -> ToolSelection:
        """Parse and validate the LLM's JSON response."""
        valid_names = {t["name"] for t in candidate_tools}

        # Extract JSON from response (tolerate markdown fences)
        json_str = raw.strip()
        m = re.search(r"\{[\s\S]*\}", json_str)
        if m:
            json_str = m.group(0)

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            return ToolSelection(
                tool_name=None, arguments={},
                reasoning="Could not parse LLM response as JSON",
                confidence=0.0, fallback_to_llm=True,
            )

        tool_name = data.get("tool_name")
        arguments = data.get("arguments", {}) or {}
        reasoning = data.get("reasoning", "No reasoning provided")
        confidence = float(data.get("confidence", 0.5))

        # Validate tool name
        if tool_name and tool_name not in valid_names:
            logger.warning("LLM selected unknown tool %r — falling back", tool_name)
            return ToolSelection(
                tool_name=None, arguments={},
                reasoning=f"LLM chose unknown tool '{tool_name}' — falling back to direct LLM",
                confidence=0.0, fallback_to_llm=True,
            )

        # Validate arguments is a dict
        if not isinstance(arguments, dict):
            arguments = {}

        return ToolSelection(
            tool_name=tool_name,
            arguments=arguments,
            reasoning=reasoning,
            confidence=confidence,
            fallback_to_llm=(tool_name is None),
        )


# ── Singleton ─────────────────────────────────────────────────────────────────
tool_selector = ToolSelector()
