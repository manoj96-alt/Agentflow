"""
AgentExecutionService  v2
=========================
Full agent execution pipeline with LLM-powered tool selection:

  1. Resolve agent config.
  2. Read shared Redis state.
  3. Connect to MCP server — discover all available tools.
  4. Filter to tools attached to this agent (if any assignment exists).
  5. Ask LLM to select the best tool for the current task (ToolSelector).
  6. Execute the chosen tool via MCP (or skip if LLM chose direct response).
  7. Call LLM again with tool results as context to produce the final response.
  8. Write everything to shared Redis state.
  9. Return AgentExecutionReport.

Fallback chain
--------------
  LLM selects tool → MCP executes → LLM synthesises response
        ↓ (no tool chosen / tool fails)
  LLM answers directly with prompt + state context
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.mcp_client import mcp_pool
from app.llm.router import llm_router
from app.llm.types import GenerateParams
from app.services.agent_service import agent_service
from app.services.run_state_service import run_state_service
from app.services.tool_selector import tool_selector, ToolSelection

logger = logging.getLogger(__name__)

MCP_SERVER = "flowforge"

# Agent-tool assignments (synced from mcp router in-memory store)
# Import the live dict so both modules share the same reference
from app.core.tool_registry import get_agent_tools as _get_agent_tools


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ToolCallRecord:
    tool_name: str
    arguments: dict[str, Any]
    success: bool
    output: Any
    reasoning: str = ""           # LLM's reasoning for choosing this tool
    confidence: float = 1.0
    error: str | None = None
    duration_ms: float = 0.0


@dataclass
class AgentExecutionReport:
    agent_id: str
    agent_name: str
    run_id: str
    model_used: str
    provider_used: str
    status: str
    tool_selection_reasoning: str = ""
    tool_selection_confidence: float = 0.0
    fallback_to_llm: bool = False
    llm_response: str | None = None
    llm_usage: dict[str, Any] = field(default_factory=dict)
    llm_latency_ms: float = 0.0
    tools_available: list[str] = field(default_factory=list)
    tools_attached: list[str] = field(default_factory=list)
    tools_called: list[str] = field(default_factory=list)
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    state_keys_written: list[str] = field(default_factory=list)
    error: str | None = None
    started_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id":                    self.agent_id,
            "agent_name":                  self.agent_name,
            "run_id":                      self.run_id,
            "model_used":                  self.model_used,
            "provider_used":               self.provider_used,
            "status":                      self.status,
            "tool_selection_reasoning":    self.tool_selection_reasoning,
            "tool_selection_confidence":   self.tool_selection_confidence,
            "fallback_to_llm":             self.fallback_to_llm,
            "llm_response":                self.llm_response,
            "llm_usage":                   self.llm_usage,
            "llm_latency_ms":              self.llm_latency_ms,
            "tools_available":             self.tools_available,
            "tools_attached":              self.tools_attached,
            "tools_called":                self.tools_called,
            "tool_calls": [
                {
                    "tool":        r.tool_name,
                    "arguments":   r.arguments,
                    "success":     r.success,
                    "output":      r.output,
                    "reasoning":   r.reasoning,
                    "confidence":  r.confidence,
                    "error":       r.error,
                    "duration_ms": r.duration_ms,
                }
                for r in self.tool_calls
            ],
            "state_keys_written": self.state_keys_written,
            "error":       self.error,
            "started_at":  self.started_at,
            "finished_at": self.finished_at,
        }


# ─── Prompt builders ──────────────────────────────────────────────────────────

def _build_synthesis_prompt(
    agent_prompt: str,
    role: str,
    tool_calls: list[ToolCallRecord],
    shared_state: dict[str, Any],
    selection: ToolSelection,
) -> str:
    """
    Build the final LLM prompt that synthesises tool results into a response.
    """
    parts = [agent_prompt, ""]

    if tool_calls:
        parts.append("## Tool Results\n")
        for r in tool_calls:
            status = "✓" if r.success else "✗"
            parts.append(f"**{status} {r.tool_name}** ({r.duration_ms:.0f}ms)")
            parts.append(f"*Why this tool:* {r.reasoning}")
            output_str = json.dumps(r.output, indent=2) if r.output else r.error or "no output"
            parts.append(f"```json\n{output_str[:2000]}\n```\n")
    elif selection.fallback_to_llm:
        parts.append(f"*No tool was used. Reasoning: {selection.reasoning}*\n")

    # Peer outputs from shared state
    peer = {k: v for k, v in shared_state.items() if ":llm_response" in k and not k.startswith("__")}
    if peer:
        parts.append("## Context from Other Agents\n")
        for k, v in list(peer.items())[:4]:
            v_str = str(v)[:600]
            parts.append(f"**{k}:**\n{v_str}\n")

    parts.append(f"\nAs the {role} agent, synthesise the above into a clear, actionable response.")
    return "\n".join(parts)


def _build_direct_prompt(
    agent_prompt: str,
    role: str,
    shared_state: dict[str, Any],
) -> str:
    """Prompt used when no tool is available or selected (pure LLM path)."""
    peer = {k: v for k, v in shared_state.items() if ":llm_response" in k and not k.startswith("__")}
    parts = [agent_prompt, ""]
    if peer:
        parts.append("## Context from Other Agents\n")
        for k, v in list(peer.items())[:4]:
            parts.append(f"**{k}:** {str(v)[:500]}\n")
    parts.append(f"\nRespond as the {role} agent. Be concise and actionable.")
    return "\n".join(parts)


# ─── Service ──────────────────────────────────────────────────────────────────

class AgentExecutionService:

    async def execute_agent_in_run(
        self,
        agent_id: str,
        run_id: str,
        strategy: str | None = None,
    ) -> AgentExecutionReport:
        """
        Full LLM-powered execution pipeline for one agent within a workflow run.
        """
        agent = agent_service.get_by_id(agent_id)
        if agent is None:
            return AgentExecutionReport(
                agent_id=agent_id, agent_name="unknown", run_id=run_id,
                model_used="none", provider_used="none",
                status="error", error=f"Agent '{agent_id}' not found",
            )

        report = AgentExecutionReport(
            agent_id=agent_id, agent_name=agent.name, run_id=run_id,
            model_used=agent.model, provider_used="unknown",
            status="running",
        )

        try:
            # ── 1. Read shared state ──────────────────────────────────────────
            shared_state = await run_state_service.read_state(run_id) or {}
            logger.info("Agent '%s' (%s) starting — %d state keys", agent.name, agent.role, len(shared_state))

            state_updates: dict[str, Any] = {}

            # ── 2. Get agent's attached tools (allow-list) ────────────────────
            attached_tools: list[str] | None = _get_agent_tools(agent_id)
            report.tools_attached = attached_tools or []

            # ── 3. Connect to MCP → discover tools ───────────────────────────
            async with mcp_pool.connect(MCP_SERVER) as client:
                raw_tools = await client.list_tools()
                all_tool_dicts = [t.to_dict() for t in raw_tools]
                report.tools_available = [t["name"] for t in all_tool_dicts]

                logger.info(
                    "Agent '%s' sees %d tools, attached=%s",
                    agent.name, len(all_tool_dicts), attached_tools,
                )

                # ── 4. LLM picks the best tool ────────────────────────────────
                selection: ToolSelection = await tool_selector.select(
                    agent_name=agent.name,
                    agent_role=agent.role,
                    agent_prompt=agent.prompt,
                    agent_model=agent.model,
                    available_tools=all_tool_dicts,
                    shared_state=shared_state,
                    attached_tools=attached_tools,
                )

                report.tool_selection_reasoning  = selection.reasoning
                report.tool_selection_confidence = selection.confidence
                report.fallback_to_llm           = selection.fallback_to_llm

                logger.info(
                    "Agent '%s' selected tool=%s (confidence=%.2f) reason=%s",
                    agent.name, selection.tool_name, selection.confidence, selection.reasoning,
                )

                # ── 5. Execute selected tool ──────────────────────────────────
                if selection.tool_name and not selection.fallback_to_llm:
                    t0 = time.perf_counter()
                    try:
                        output = await client.call_tool_json(
                            selection.tool_name, selection.arguments
                        )
                        duration_ms = (time.perf_counter() - t0) * 1000
                        record = ToolCallRecord(
                            tool_name=selection.tool_name,
                            arguments=selection.arguments,
                            success=True,
                            output=output,
                            reasoning=selection.reasoning,
                            confidence=selection.confidence,
                            duration_ms=round(duration_ms, 2),
                        )
                        state_updates[f"{agent_id}:{selection.tool_name}:output"] = output
                        logger.info("Tool '%s' succeeded in %.0fms", selection.tool_name, duration_ms)
                    except Exception as exc:
                        duration_ms = (time.perf_counter() - t0) * 1000
                        logger.warning("Tool '%s' failed: %s — falling back to LLM", selection.tool_name, exc)
                        record = ToolCallRecord(
                            tool_name=selection.tool_name,
                            arguments=selection.arguments,
                            success=False, output=None,
                            reasoning=selection.reasoning,
                            confidence=selection.confidence,
                            error=str(exc),
                            duration_ms=round(duration_ms, 2),
                        )
                        state_updates[f"{agent_id}:{selection.tool_name}:error"] = str(exc)
                        # Tool failed → synthesise without tool results
                        selection = ToolSelection(
                            tool_name=None, arguments={},
                            reasoning=f"Tool '{selection.tool_name}' failed: {exc}",
                            confidence=0.0, fallback_to_llm=True,
                        )
                        report.fallback_to_llm = True

                    report.tool_calls.append(record)
                    report.tools_called.append(record.tool_name)

            # ── 6. LLM synthesis ──────────────────────────────────────────────
            if report.tool_calls and any(r.success for r in report.tool_calls):
                # Synthesise with tool results
                user_prompt = _build_synthesis_prompt(
                    agent.prompt, agent.role, report.tool_calls, shared_state, selection
                )
            else:
                # Direct LLM path (no tool / all tools failed)
                user_prompt = _build_direct_prompt(agent.prompt, agent.role, shared_state)

            llm_resp = await llm_router.generate(
                prompt=user_prompt,
                model=agent.model,
                params=GenerateParams(
                    system=(
                        f"You are {agent.name}, a {agent.role} agent. "
                        f"{'You called an MCP tool and are synthesising the results.' if report.tool_calls else 'Answer using your reasoning only.'}"
                    ),
                    temperature=0.6,
                    max_tokens=1024,
                ),
                strategy=strategy,
            )

            report.llm_response   = llm_resp.content
            report.model_used     = llm_resp.model
            report.provider_used  = llm_resp.provider
            report.llm_latency_ms = llm_resp.latency_ms
            report.llm_usage      = llm_resp.usage.__dict__

            # ── 7. Write to Redis ─────────────────────────────────────────────
            state_updates.update({
                f"{agent_id}:llm_response":          llm_resp.content,
                f"{agent_id}:model_used":            llm_resp.model,
                f"{agent_id}:provider_used":         llm_resp.provider,
                f"{agent_id}:tool_selection":        selection.tool_name,
                f"{agent_id}:tool_reasoning":        selection.reasoning,
                f"{agent_id}:tool_confidence":       selection.confidence,
                f"{agent_id}:fallback_to_llm":       report.fallback_to_llm,
                f"{agent_id}:tools_used":            [r.tool_name for r in report.tool_calls if r.success],
                f"{agent_id}:execution_summary": {
                    "tools_available": len(report.tools_available),
                    "tools_attached":  len(report.tools_attached),
                    "tool_selected":   selection.tool_name,
                    "fallback":        report.fallback_to_llm,
                    "finished_at":     datetime.utcnow().isoformat(),
                },
            })

            await run_state_service.write_state(run_id, state_updates, agent_id)
            report.state_keys_written = list(state_updates.keys())

            failures = [r for r in report.tool_calls if not r.success]
            report.status = "partial" if failures else "success"

        except Exception as exc:
            logger.exception("Agent '%s' execution crashed: %s", agent.name, exc)
            report.status = "error"
            report.error = str(exc)

        report.finished_at = datetime.utcnow().isoformat()
        return report


agent_execution_service = AgentExecutionService()
