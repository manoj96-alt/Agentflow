"""
Tool Recommendation Engine
==========================
Analyses agent roles/prompts and recommends the most relevant MCP tools.

Two entry points:
  recommend_for_agent()   — single agent, returns top-N tool matches with reasoning
  recommend_for_workflow() — all agents, returns a map of agentId → recommendations

Match logic:
  1. Rule-based pre-filter (fast, no LLM): keyword matching on role + prompt
  2. LLM ranking: haiku scores and explains each candidate match
  3. Returns top-3 with confidence, reasoning, and a ready-to-use example

Confidence levels:
  high   (≥0.75) — strong keyword + semantic match, show as primary suggestion
  medium (≥0.45) — plausible match, show as secondary suggestion
  low    (<0.45)  — weak match, omit unless explicitly requested
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.llm.router import llm_router
from app.llm.types import GenerateParams

logger = logging.getLogger(__name__)

# ─── Tool definitions (source of truth for the recommender) ───────────────────

TOOLS = {
    "api_fetch": {
        "name":        "api_fetch",
        "category":    "http",
        "description": "Fetch data from any HTTP GET endpoint. Returns parsed JSON or text.",
        "best_for":    ["fetch", "get", "retrieve", "download", "api", "endpoint", "url",
                        "http", "rest", "request", "web", "data", "news", "price", "weather",
                        "research", "information", "search", "lookup", "external"],
        "roles":       ["researcher", "coder", "worker", "orchestrator"],
        "example":     {"url": "https://api.example.com/data"},
    },
    "api_call": {
        "name":        "api_call",
        "category":    "http",
        "description": "Make POST/PUT/PATCH HTTP requests with a JSON body.",
        "best_for":    ["send", "post", "submit", "update", "create", "push", "notify",
                        "webhook", "trigger", "write", "api", "http"],
        "roles":       ["coder", "worker", "orchestrator"],
        "example":     {"url": "https://api.example.com/update", "method": "POST",
                        "body": {"key": "value"}},
    },
    "db_query": {
        "name":        "db_query",
        "category":    "database",
        "description": "Execute read-only SQL SELECT queries against the application database.",
        "best_for":    ["database", "sql", "query", "select", "records", "data", "table",
                        "rows", "lookup", "find", "search", "history", "logs", "analytics",
                        "report", "count", "aggregate", "join"],
        "roles":       ["researcher", "coder", "evaluator", "reviewer", "worker"],
        "example":     {"sql": "SELECT id, name, status FROM workflows ORDER BY created_at DESC LIMIT 10"},
    },
    "sql_query": {
        "name":        "sql_query",
        "category":    "database",
        "description": "Execute full SQL (SELECT, INSERT, UPDATE, DELETE) on the configured database.",
        "best_for":    ["write", "insert", "update", "delete", "modify", "store", "save",
                        "persist", "database", "sql", "record"],
        "roles":       ["coder", "worker"],
        "example":     {"sql": "INSERT INTO results (agent_id, score, output) VALUES (?, ?, ?)"},
    },
    "file_tool": {
        "name":        "file_tool",
        "category":    "file",
        "description": "Read, write, list, or check existence of files on the server.",
        "best_for":    ["file", "read", "write", "save", "load", "document", "text", "csv",
                        "json", "markdown", "report", "output", "store", "disk", "path",
                        "pdf", "content", "summarize", "extract", "parse"],
        "roles":       ["researcher", "coder", "worker", "reviewer"],
        "example":     {"operation": "read", "path": "/tmp/input.txt"},
    },
    "db_list_tables": {
        "name":        "db_list_tables",
        "category":    "database",
        "description": "List all tables available in the database.",
        "best_for":    ["schema", "tables", "database", "structure", "explore", "discover"],
        "roles":       ["researcher", "coder"],
        "example":     {},
    },
}


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class ToolMatch:
    tool_name:   str
    category:    str
    description: str
    confidence:  float          # 0.0–1.0
    reasoning:   str            # one sentence from LLM
    example:     dict           # ready-to-use example args
    rule_score:  float = 0.0    # keyword pre-filter score


@dataclass
class AgentRecommendation:
    agent_id:    str
    agent_name:  str
    role:        str
    matches:     list[ToolMatch] = field(default_factory=list)


# ─── Rule-based pre-filter ─────────────────────────────────────────────────────

def _rule_score(tool: dict, role: str, prompt: str) -> float:
    """Fast keyword overlap score — 0.0 to 1.0."""
    text = f"{role} {prompt}".lower()
    keyword_hits = sum(1 for kw in tool["best_for"] if kw in text)
    role_hit     = 1.0 if role in tool["roles"] else 0.0
    kw_score     = min(keyword_hits / max(len(tool["best_for"]), 1), 1.0)
    return 0.4 * role_hit + 0.6 * kw_score


def _pre_filter(role: str, prompt: str, top_n: int = 4) -> list[str]:
    """Return top_n tool names by rule score."""
    scored = [(name, _rule_score(t, role, prompt)) for name, t in TOOLS.items()]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [name for name, score in scored[:top_n] if score > 0.05]


# ─── LLM ranker ───────────────────────────────────────────────────────────────

_RANK_SYSTEM = """\
You are a tool selection expert for AI agent pipelines.
Rank which MCP tools best fit an agent's task.
Return ONLY valid JSON — no markdown, no explanation outside the JSON."""

_RANK_PROMPT = """\
Agent: "{name}" (role: {role})
Task description: {prompt}

Candidate tools:
{tools_block}

For each tool, rate fit 0.0–1.0 and give one-sentence reasoning.

Return:
{{
  "rankings": [
    {{
      "tool_name": "api_fetch",
      "confidence": 0.90,
      "reasoning": "This agent fetches live news data — api_fetch is the direct match."
    }}
  ]
}}

Rules:
- Only include tools with confidence >= 0.3
- Order by confidence descending
- Keep reasoning under 15 words
- Max 3 results"""


def _build_tools_block(candidate_names: list[str]) -> str:
    lines = []
    for name in candidate_names:
        t = TOOLS.get(name)
        if t:
            lines.append(f"  {name}: {t['description']}")
    return "\n".join(lines)


async def _llm_rank(
    name: str, role: str, prompt: str, candidates: list[str],
) -> list[dict]:
    """Ask haiku to rank candidate tools. Returns list of {tool_name, confidence, reasoning}."""
    tools_block = _build_tools_block(candidates)
    user_prompt = _RANK_PROMPT.format(
        name=name, role=role,
        prompt=prompt[:200] or f"I am a {role} agent",
        tools_block=tools_block,
    )
    try:
        resp = await llm_router.generate(
            prompt=user_prompt,
            model="claude-haiku-4-5",
            params=GenerateParams(system=_RANK_SYSTEM, temperature=0.1, max_tokens=400),
        )
        raw = resp.content.strip()
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            data = json.loads(m.group(0))
            return data.get("rankings", [])
    except Exception as e:
        logger.warning("LLM ranking failed for '%s': %s", name, e)
    return []


# ─── Public API ────────────────────────────────────────────────────────────────

async def recommend_for_agent(
    agent_id:   str,
    agent_name: str,
    role:       str,
    prompt:     str,
    top_n:      int = 3,
    min_confidence: float = 0.30,
) -> AgentRecommendation:
    """
    Recommend tools for a single agent.
    Uses rule pre-filter + LLM ranking.
    """
    # 1. Rule-based pre-filter (fast)
    candidates = _pre_filter(role, prompt, top_n=5)

    # Add all tools if no candidates found (empty prompt, generic role)
    if not candidates:
        candidates = list(TOOLS.keys())

    rule_scores = {name: _rule_score(TOOLS[name], role, prompt) for name in candidates}

    # 2. LLM ranking
    llm_rankings = await _llm_rank(agent_name, role, prompt, candidates)

    # 3. Merge rule + LLM scores
    llm_map = {r["tool_name"]: r for r in llm_rankings}
    matches: list[ToolMatch] = []

    for name in candidates:
        tool = TOOLS.get(name)
        if not tool:
            continue
        llm = llm_map.get(name)
        rule = rule_scores.get(name, 0.0)

        if llm:
            # Blend: 60% LLM + 40% rule
            confidence = 0.6 * float(llm.get("confidence", 0.0)) + 0.4 * rule
            reasoning  = llm.get("reasoning", "")
        else:
            confidence = rule * 0.7   # downweight unconfirmed matches
            reasoning  = f"Keyword match — {tool['category']} tool fits {role} role"

        if confidence < min_confidence:
            continue

        matches.append(ToolMatch(
            tool_name=name,
            category=tool["category"],
            description=tool["description"],
            confidence=round(confidence, 3),
            reasoning=reasoning,
            example=tool["example"],
            rule_score=round(rule, 3),
        ))

    # Sort by confidence, take top_n
    matches.sort(key=lambda m: m.confidence, reverse=True)
    return AgentRecommendation(
        agent_id=agent_id, agent_name=agent_name, role=role,
        matches=matches[:top_n],
    )


async def recommend_for_workflow(
    agents: list[dict],  # list of {id, name, role, prompt}
    top_n_per_agent: int = 3,
) -> list[AgentRecommendation]:
    """
    Recommend tools for every agent in a workflow.
    Runs recommendations concurrently for speed.
    """
    import asyncio
    tasks = [
        recommend_for_agent(
            agent_id=a.get("id", ""),
            agent_name=a.get("name", a.get("role", "Agent")),
            role=a.get("role", "custom"),
            prompt=a.get("prompt", ""),
            top_n=top_n_per_agent,
        )
        for a in agents
    ]
    return await asyncio.gather(*tasks)


def match_to_dict(m: ToolMatch) -> dict:
    return {
        "tool_name":   m.tool_name,
        "category":    m.category,
        "description": m.description,
        "confidence":  m.confidence,
        "reasoning":   m.reasoning,
        "example":     m.example,
    }


def recommendation_to_dict(r: AgentRecommendation) -> dict:
    return {
        "agent_id":   r.agent_id,
        "agent_name": r.agent_name,
        "role":       r.role,
        "matches":    [match_to_dict(m) for m in r.matches],
    }
