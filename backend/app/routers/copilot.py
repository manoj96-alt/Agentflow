"""
Co-pilot Router
===============
Analyses the current workflow graph and returns AI-generated suggestions:
  - Missing nodes (e.g. no evaluator, no error handler)
  - Better prompts for existing agents
  - Connection improvements
  - Structural optimizations

POST /api/copilot/suggest   — full workflow analysis
POST /api/copilot/quick     — single agent context (faster, on node select)
"""
from __future__ import annotations

import json
import logging
import re
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any

from app.llm.router import llm_router
from app.llm.types import GenerateParams

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["copilot"])

# ── Schemas ───────────────────────────────────────────────────────────────────

class NodeSummary(BaseModel):
    id: str
    role: str
    name: str
    prompt: str = ""
    model: str = ""
    attached_tools: list[str] = Field(default_factory=list)

class EdgeSummary(BaseModel):
    source: str
    target: str
    condition: str = ""

class WorkflowAnalysisRequest(BaseModel):
    nodes: list[NodeSummary]
    edges: list[EdgeSummary]
    goal: str = ""           # optional user-stated goal
    context: str = ""        # e.g. "user just added a Researcher node"

class QuickSuggestRequest(BaseModel):
    node_id: str
    node_role: str
    node_name: str
    node_prompt: str
    workflow_roles: list[str] = Field(default_factory=list)   # existing roles

# ── Suggestion types ──────────────────────────────────────────────────────────

SUGGESTION_TYPES = {
    "add_node":       "Add a new agent node",
    "add_edge":       "Add a connection between agents",
    "improve_prompt": "Improve an agent's prompt",
    "change_model":   "Use a better model for this agent",
    "add_condition":  "Add a conditional edge",
    "add_tool":       "Attach a tool to an agent",
    "restructure":    "Restructure the workflow",
    "add_loop":       "Add a quality-check loop",
}

# ── System prompts ────────────────────────────────────────────────────────────

ANALYSIS_SYSTEM = """You are an expert multi-agent system architect reviewing a workflow graph.
Return ONLY valid JSON — no markdown, no explanation outside JSON."""

ANALYSIS_PROMPT = """Analyse this multi-agent workflow and suggest concrete improvements.

## Workflow
Goal: {goal}

Nodes ({node_count}):
{nodes_text}

Edges ({edge_count}):
{edges_text}

## Return this exact JSON (5 suggestions max):
{{
  "workflow_health": "good|fair|needs_work",
  "health_reason": "one sentence",
  "suggestions": [
    {{
      "id": "s1",
      "type": "add_node|add_edge|improve_prompt|change_model|add_condition|add_tool|restructure|add_loop",
      "priority": "high|medium|low",
      "title": "Short action title (max 6 words)",
      "reason": "One sentence explaining why",
      "action": {{
        "node_role": "evaluator",
        "node_name": "Quality Evaluator",
        "node_prompt": "Review all outputs and score quality 0-100. Write state['score'] and state['evaluator:approved'].",
        "model": "claude-opus-4-5",
        "connect_from": "node_id_or_null",
        "connect_to": "node_id_or_null",
        "edge_condition": "",
        "tool_name": "",
        "prompt_improvement": ""
      }}
    }}
  ]
}}

Rules:
- Only suggest things that are genuinely missing or wrong
- If workflow looks complete, say health=good and give 1-2 polish suggestions
- For add_node: always provide node_role, node_name, node_prompt, model, connect_from
- For improve_prompt: set prompt_improvement to the full improved prompt text
- For add_condition: set edge_condition to a JS expression like state['score'] < 75
- Available roles: orchestrator, planner, worker, evaluator, researcher, coder, reviewer, custom
- Available models: claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5, gpt-4o, gpt-4o-mini
- connect_from and connect_to must be node IDs from the Nodes list, or null"""

QUICK_PROMPT = """An agent named "{name}" with role "{role}" was just added/selected in a workflow.
Existing roles in workflow: {roles}

Suggest 3 quick improvements for THIS agent specifically:
{{
  "suggestions": [
    {{
      "id": "q1",
      "type": "improve_prompt|change_model|add_tool|add_edge",
      "priority": "high|medium|low",
      "title": "Short title (max 6 words)",
      "reason": "One sentence",
      "action": {{
        "prompt_improvement": "improved prompt text or empty",
        "model": "suggested model or empty",
        "tool_name": "tool name or empty",
        "connect_from": null,
        "connect_to": null,
        "edge_condition": ""
      }}
    }}
  ]
}}

Current prompt: {prompt}

Return ONLY JSON."""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        text = m.group(0)
    return json.loads(text)

def _format_nodes(nodes: list[NodeSummary]) -> str:
    lines = []
    for n in nodes:
        tools = f" tools=[{', '.join(n.attached_tools)}]" if n.attached_tools else ""
        prompt_preview = n.prompt[:80] + "…" if len(n.prompt) > 80 else n.prompt
        lines.append(f"  [{n.id}] {n.name} ({n.role}) model={n.model}{tools}\n        prompt: {prompt_preview}")
    return "\n".join(lines) or "  (empty)"

def _format_edges(edges: list[EdgeSummary]) -> str:
    if not edges:
        return "  (no connections)"
    return "\n".join(
        f"  {e.source} → {e.target}" + (f"  if: {e.condition}" if e.condition else "")
        for e in edges
    )

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/suggest", summary="Full workflow analysis — returns up to 5 suggestions")
async def suggest(body: WorkflowAnalysisRequest):
    """
    Analyses the complete workflow graph and returns prioritised suggestions.
    Uses claude-haiku for speed (< 2s typical response).
    """
    if not body.nodes:
        return {"workflow_health": "needs_work", "health_reason": "No agents yet", "suggestions": [
            {"id": "s0", "type": "add_node", "priority": "high",
             "title": "Add your first agent",
             "reason": "Drag an Orchestrator from the sidebar to get started.",
             "action": {"node_role": "orchestrator", "node_name": "Orchestrator",
                        "node_prompt": "You coordinate the workflow. Break down the goal and delegate to specialist agents.",
                        "model": "claude-sonnet-4-5", "connect_from": None, "connect_to": None,
                        "edge_condition": "", "tool_name": "", "prompt_improvement": ""}}
        ]}

    prompt = ANALYSIS_PROMPT.format(
        goal=body.goal or "Not specified",
        node_count=len(body.nodes),
        nodes_text=_format_nodes(body.nodes),
        edge_count=len(body.edges),
        edges_text=_format_edges(body.edges),
    )

    try:
        resp = await llm_router.generate(
            prompt=prompt,
            model="claude-haiku-4-5",
            params=GenerateParams(system=ANALYSIS_SYSTEM, temperature=0.2, max_tokens=1200),
        )
        data = _parse_json(resp.content)
        return data
    except Exception as e:
        logger.warning("Co-pilot suggest failed: %s", e)
        return {
            "workflow_health": "fair",
            "health_reason": "Analysis unavailable",
            "suggestions": _fallback_suggestions(body.nodes, body.edges),
        }

@router.post("/quick", summary="Quick single-agent suggestions (on node focus)")
async def quick_suggest(body: QuickSuggestRequest):
    """
    Fast, focused suggestions for a single agent that was just added or selected.
    Called automatically when user clicks a node.
    """
    prompt = QUICK_PROMPT.format(
        name=body.node_name,
        role=body.node_role,
        roles=", ".join(body.workflow_roles) or "none",
        prompt=body.node_prompt[:200] or "(empty)",
    )

    try:
        resp = await llm_router.generate(
            prompt=prompt,
            model="claude-haiku-4-5",
            params=GenerateParams(system=ANALYSIS_SYSTEM, temperature=0.2, max_tokens=600),
        )
        data = _parse_json(resp.content)
        return {"node_id": body.node_id, "suggestions": data.get("suggestions", [])}
    except Exception as e:
        logger.warning("Co-pilot quick failed: %s", e)
        return {"node_id": body.node_id, "suggestions": []}

# ── Fallback suggestions (no LLM) ─────────────────────────────────────────────

def _fallback_suggestions(
    nodes: list[NodeSummary],
    edges: list[EdgeSummary],
) -> list[dict]:
    suggestions = []
    roles = {n.role for n in nodes}
    node_ids = [n.id for n in nodes]

    if "evaluator" not in roles and "reviewer" not in roles and len(nodes) >= 2:
        last_id = node_ids[-1] if node_ids else None
        suggestions.append({
            "id": "fb1", "type": "add_node", "priority": "high",
            "title": "Add a Reviewer agent",
            "reason": "Every workflow benefits from a validation step to score output quality.",
            "action": {
                "node_role": "reviewer", "node_name": "Quality Reviewer",
                "node_prompt": "Review all agent outputs. Score quality 0-100. Write state['score'] and state['reviewer:approved'] (true if score >= 75).",
                "model": "claude-opus-4-5",
                "connect_from": last_id, "connect_to": None,
                "edge_condition": "", "tool_name": "", "prompt_improvement": "",
            }
        })

    if len(nodes) >= 2 and len(edges) == 0:
        suggestions.append({
            "id": "fb2", "type": "add_edge", "priority": "high",
            "title": "Connect your agents",
            "reason": "Agents are not connected — drag from a node's bottom handle to another's top handle.",
            "action": {"connect_from": node_ids[0], "connect_to": node_ids[1],
                       "edge_condition": "", "tool_name": "", "prompt_improvement": ""},
        })

    if nodes and not any(n.prompt and len(n.prompt) > 20 for n in nodes):
        suggestions.append({
            "id": "fb3", "type": "improve_prompt", "priority": "medium",
            "title": "Add prompts to your agents",
            "reason": "Agents without prompts use generic behaviour. Add specific instructions for better results.",
            "action": {"prompt_improvement": "", "tool_name": "", "connect_from": None, "connect_to": None, "edge_condition": ""},
        })

    return suggestions[:3]
