"""
AgentOptimizer
==============
Tracks per-agent performance across executions and uses the LLM to
suggest prompt improvements and better model choices.

Performance metrics tracked per agent:
- success_rate     (successful executions / total)
- avg_duration_ms  (mean latency)
- error_rate       (errors / total)
- tool_hit_rate    (tool called and succeeded / total)
- avg_tokens       (mean token usage)

LLM analysis produces:
- prompt_suggestions   list of concrete improvements to the system prompt
- model_suggestion     recommended model switch (or None if current is fine)
- model_reasoning      why the model change is recommended
- overall_assessment   one-paragraph health summary
- priority             "high" | "medium" | "low" (urgency of changes)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.llm.router import llm_router
from app.llm.types import GenerateParams

logger = logging.getLogger(__name__)


# ─── Performance record (in-memory, per agent) ────────────────────────────────

@dataclass
class AgentMetrics:
    agent_id:    str
    agent_name:  str
    role:        str
    model:       str

    total_runs:       int = 0
    success_count:    int = 0
    error_count:      int = 0
    skipped_count:    int = 0
    tool_call_count:  int = 0
    tool_hit_count:   int = 0    # tool called AND succeeded
    total_tokens:     int = 0
    total_duration_ms: float = 0.0

    # Rolling last-N logs for LLM analysis (capped at 10)
    recent_logs: list[dict[str, Any]] = field(default_factory=list)
    last_updated: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    @property
    def success_rate(self) -> float:
        return self.success_count / self.total_runs if self.total_runs > 0 else 0.0

    @property
    def error_rate(self) -> float:
        return self.error_count / self.total_runs if self.total_runs > 0 else 0.0

    @property
    def avg_duration_ms(self) -> float:
        return self.total_duration_ms / self.total_runs if self.total_runs > 0 else 0.0

    @property
    def avg_tokens(self) -> float:
        return self.total_tokens / self.total_runs if self.total_runs > 0 else 0.0

    @property
    def tool_hit_rate(self) -> float:
        return self.tool_hit_count / self.tool_call_count if self.tool_call_count > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id":        self.agent_id,
            "agent_name":      self.agent_name,
            "role":            self.role,
            "model":           self.model,
            "total_runs":      self.total_runs,
            "success_count":   self.success_count,
            "error_count":     self.error_count,
            "skipped_count":   self.skipped_count,
            "success_rate":    round(self.success_rate, 3),
            "error_rate":      round(self.error_rate, 3),
            "avg_duration_ms": round(self.avg_duration_ms, 1),
            "avg_tokens":      round(self.avg_tokens, 1),
            "tool_hit_rate":   round(self.tool_hit_rate, 3),
            "last_updated":    self.last_updated,
        }


@dataclass
class OptimizationSuggestion:
    agent_id:           str
    agent_name:         str
    current_model:      str
    model_suggestion:   str | None          # None = keep current model
    model_reasoning:    str
    prompt_suggestions: list[str]
    overall_assessment: str
    priority:           str                  # "high" | "medium" | "low"
    metrics_snapshot:   dict[str, Any] = field(default_factory=dict)
    generated_at:       str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id":           self.agent_id,
            "agent_name":         self.agent_name,
            "current_model":      self.current_model,
            "model_suggestion":   self.model_suggestion,
            "model_reasoning":    self.model_reasoning,
            "prompt_suggestions": self.prompt_suggestions,
            "overall_assessment": self.overall_assessment,
            "priority":           self.priority,
            "metrics_snapshot":   self.metrics_snapshot,
            "generated_at":       self.generated_at,
        }


# ─── Optimizer ────────────────────────────────────────────────────────────────

_ANALYSIS_SYSTEM = """\
You are an AI agent performance analyst.
Given execution logs and performance metrics for an agent, provide concrete optimization recommendations.
Always respond with valid JSON only — no markdown fences, no explanation outside the JSON.
"""

_ANALYSIS_PROMPT = """\
## Agent Profile
Name:  {agent_name}
Role:  {role}
Model: {model}
Current prompt: {prompt}

## Performance Metrics
{metrics_json}

## Recent Execution Logs (last {log_count})
{logs_summary}

## Your Task
Analyze this agent's performance and suggest improvements.

Respond with EXACTLY this JSON:
{{
  "model_suggestion": "<model name or null if current model is fine>",
  "model_reasoning": "<one sentence>",
  "prompt_suggestions": ["<concrete suggestion 1>", "<concrete suggestion 2>", "<concrete suggestion 3>"],
  "overall_assessment": "<2-3 sentence health summary>",
  "priority": "<high|medium|low>"
}}

Rules:
- model_suggestion: only suggest a change if there is a clear reason
  (high latency → haiku, complex reasoning → opus, current is fine → null)
- Available models: claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5, gpt-4o, gpt-4o-mini
- prompt_suggestions: must be SPECIFIC and ACTIONABLE (not vague like "improve clarity")
- priority: "high" if error_rate > 0.3 or success_rate < 0.5, "medium" if issues found, "low" otherwise
"""


class AgentOptimizer:
    """
    Tracks agent performance in memory and generates LLM-powered suggestions.
    """

    def __init__(self) -> None:
        self._metrics: dict[str, AgentMetrics] = {}   # agent_id → metrics

    # ── Record ────────────────────────────────────────────────────────────────

    def record_execution(
        self,
        agent_id: str,
        agent_name: str,
        role: str,
        model: str,
        status: str,
        duration_ms: float,
        tokens: int,
        tool_called: bool,
        tool_succeeded: bool,
        log_entry: dict[str, Any],
    ) -> None:
        """Record one agent execution. Call this after every node completes."""
        if agent_id not in self._metrics:
            self._metrics[agent_id] = AgentMetrics(
                agent_id=agent_id, agent_name=agent_name, role=role, model=model,
            )

        m = self._metrics[agent_id]
        m.total_runs        += 1
        m.total_duration_ms += duration_ms
        m.total_tokens      += tokens
        m.last_updated       = datetime.utcnow().isoformat()

        if status == "success":    m.success_count += 1
        elif status == "error":    m.error_count   += 1
        elif status == "skipped":  m.skipped_count += 1

        if tool_called:
            m.tool_call_count += 1
            if tool_succeeded:
                m.tool_hit_count += 1

        # Keep rolling last-10 logs for analysis
        compact = {
            "status": status,
            "duration_ms": round(duration_ms, 1),
            "tokens": tokens,
            "tool_called": tool_called,
            "tool_ok": tool_succeeded,
            "error": log_entry.get("error"),
            "message": str(log_entry.get("message", ""))[:200],
        }
        m.recent_logs = (m.recent_logs + [compact])[-10:]

    # ── Query ─────────────────────────────────────────────────────────────────

    def get_metrics(self, agent_id: str) -> AgentMetrics | None:
        return self._metrics.get(agent_id)

    def get_all_metrics(self) -> list[dict[str, Any]]:
        return [m.to_dict() for m in self._metrics.values()]

    # ── Analyse ───────────────────────────────────────────────────────────────

    async def analyse(
        self,
        agent_id: str,
        agent_name: str,
        role: str,
        current_model: str,
        current_prompt: str,
    ) -> OptimizationSuggestion:
        """
        Ask the LLM to analyse this agent's performance and return suggestions.
        Falls back to a basic suggestion if LLM call fails.
        """
        m = self._metrics.get(agent_id)
        metrics_dict = m.to_dict() if m else {}
        recent_logs  = m.recent_logs if m else []

        logs_summary = "\n".join(
            f"  run {i+1}: status={l['status']} dur={l['duration_ms']}ms "
            f"tokens={l['tokens']} tool={'✓' if l['tool_ok'] else ('✕' if l['tool_called'] else '-')}"
            + (f" error={l['error']}" if l.get("error") else "")
            for i, l in enumerate(recent_logs)
        ) or "  No executions recorded yet."

        prompt = _ANALYSIS_PROMPT.format(
            agent_name=agent_name,
            role=role,
            model=current_model,
            prompt=current_prompt[:400],
            metrics_json=json.dumps(metrics_dict, indent=2),
            log_count=len(recent_logs),
            logs_summary=logs_summary,
        )

        try:
            resp = await llm_router.generate(
                prompt=prompt,
                model="claude-haiku-4-5",   # use fast/cheap model for meta-analysis
                params=GenerateParams(
                    system=_ANALYSIS_SYSTEM,
                    temperature=0.2,
                    max_tokens=600,
                ),
            )
            data = _parse_json(resp.content)
            return OptimizationSuggestion(
                agent_id=agent_id,
                agent_name=agent_name,
                current_model=current_model,
                model_suggestion=data.get("model_suggestion"),
                model_reasoning=data.get("model_reasoning", ""),
                prompt_suggestions=data.get("prompt_suggestions", []),
                overall_assessment=data.get("overall_assessment", ""),
                priority=data.get("priority", "low"),
                metrics_snapshot=metrics_dict,
            )
        except Exception as exc:
            logger.warning("Optimizer LLM call failed for '%s': %s", agent_name, exc)
            # Return a basic fallback suggestion
            error_rate = m.error_rate if m else 0.0
            return OptimizationSuggestion(
                agent_id=agent_id,
                agent_name=agent_name,
                current_model=current_model,
                model_suggestion=None,
                model_reasoning="Could not analyse — LLM call failed",
                prompt_suggestions=[
                    "Add explicit output format instructions to the prompt",
                    "Specify what keys to write to shared state",
                    "Add error handling guidance to the prompt",
                ],
                overall_assessment=f"Analysis failed: {exc}. Error rate: {error_rate:.1%}",
                priority="high" if error_rate > 0.3 else "low",
                metrics_snapshot=metrics_dict,
            )


def _parse_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        text = m.group(0)
    return json.loads(text)


# ── Singleton ─────────────────────────────────────────────────────────────────
agent_optimizer = AgentOptimizer()
