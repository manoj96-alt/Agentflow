"""
FlowEngine — Parallel Async Execution Engine
============================================

Replaces the simple sequential loop in AgentExecutionService with a
graph-aware async runner that:

1. Builds a DAG from workflow nodes + edges.
2. Detects parallel tiers (nodes with no unmet dependencies).
3. Executes each tier concurrently with asyncio.gather().
4. Merges all results into a single shared Redis state atomically per tier.
5. Handles conditional edges (expression evaluated against live state).
6. Detects cycles and caps iterations with a per-node max.

Shared state contract
---------------------
Every agent writes its outputs under namespaced keys:
    {agent_id}:llm_response
    {agent_id}:tool:{tool_name}:output
    {agent_id}:execution_summary
    {agent_id}:status

These are merged into Redis after each parallel tier completes so that
later tiers see the full outputs of earlier ones.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core import redis as redis_store
from app.core.mcp_client import mcp_pool
from app.llm.router import llm_router
from app.llm.types import GenerateParams
from app.services.run_state_service import run_state_service

logger = logging.getLogger(__name__)

MCP_SERVER = "flowforge"
DEFAULT_MAX_ITERATIONS = 5


# ─── Graph types ──────────────────────────────────────────────────────────────

@dataclass
class WorkflowNode:
    id: str
    agent_name: str
    role: str
    model: str
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 1024


@dataclass
class WorkflowEdge:
    id: str
    source: str
    target: str
    condition: str = ""       # JS-like expression; empty = unconditional
    label: str = ""


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class NodeResult:
    node_id: str
    agent_name: str
    status: str                    # "success" | "error" | "skipped"
    llm_response: str | None = None
    state_updates: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    started_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    finished_at: str | None = None
    duration_ms: float = 0.0
    parallel_tier: int = 0         # which tier this node ran in


@dataclass
class FlowExecutionReport:
    run_id: str
    status: str                    # "success" | "partial" | "error"
    total_nodes: int = 0
    nodes_executed: int = 0
    nodes_skipped: int = 0
    nodes_failed: int = 0
    parallel_tiers: int = 0
    max_concurrency: int = 0       # largest tier size
    total_duration_ms: float = 0.0
    node_results: list[NodeResult] = field(default_factory=list)
    final_state: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id":           self.run_id,
            "status":           self.status,
            "total_nodes":      self.total_nodes,
            "nodes_executed":   self.nodes_executed,
            "nodes_skipped":    self.nodes_skipped,
            "nodes_failed":     self.nodes_failed,
            "parallel_tiers":   self.parallel_tiers,
            "max_concurrency":  self.max_concurrency,
            "total_duration_ms": self.total_duration_ms,
            "node_results": [
                {
                    "node_id":       r.node_id,
                    "agent_name":    r.agent_name,
                    "status":        r.status,
                    "llm_response":  r.llm_response,
                    "state_updates": list(r.state_updates.keys()),
                    "error":         r.error,
                    "started_at":    r.started_at,
                    "finished_at":   r.finished_at,
                    "duration_ms":   r.duration_ms,
                    "parallel_tier": r.parallel_tier,
                }
                for r in self.node_results
            ],
            "error": self.error,
        }


# ─── DAG analysis ─────────────────────────────────────────────────────────────

class WorkflowDAG:
    """
    Builds a dependency graph and exposes tier-based parallel execution order.

    Tier 0 = nodes with no incoming edges (roots).
    Tier N = nodes whose all dependencies are in tiers 0..N-1.

    Cycles are detected and broken by capping per-node visit counts.
    """

    def __init__(self, nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> None:
        self.nodes      = {n.id: n for n in nodes}
        self.edges      = edges
        self.successors: dict[str, list[WorkflowEdge]] = {}
        self.in_degree:  dict[str, int] = {n.id: 0 for n in nodes}

        for e in edges:
            self.successors.setdefault(e.source, []).append(e)
            if e.target in self.in_degree:
                self.in_degree[e.target] += 1

    def tiers(self) -> list[list[str]]:
        """
        Kahn's algorithm → returns ordered tiers of node IDs.
        Each tier can be executed in parallel.
        """
        degree = dict(self.in_degree)
        queue = [nid for nid, d in degree.items() if d == 0]
        result: list[list[str]] = []

        while queue:
            result.append(list(queue))
            next_queue: list[str] = []
            for nid in queue:
                for edge in self.successors.get(nid, []):
                    if edge.target not in degree:
                        continue
                    degree[edge.target] -= 1
                    if degree[edge.target] == 0:
                        next_queue.append(edge.target)
            queue = next_queue

        # Any remaining nodes are in a cycle — append them as a final tier
        remaining = [nid for nid, d in degree.items() if d > 0]
        if remaining:
            result.append(remaining)

        return result

    def successors_of(self, node_id: str) -> list[WorkflowEdge]:
        return self.successors.get(node_id, [])


# ─── Condition evaluator ──────────────────────────────────────────────────────

def _evaluate_condition(expression: str, state: dict[str, Any]) -> bool:
    """
    Evaluate a simple Python-style condition expression.
    The variable `state` is the shared FlowState dict.

    Examples:
        state['score'] > 80
        state.get('approved') is True
        state.get('retry_count', 0) < 3
        not state.get('error')
    """
    if not expression or not expression.strip():
        return True   # unconditional edge

    # Block dangerous builtins
    blocked = {"__import__", "exec", "eval", "open", "os", "sys", "subprocess"}
    if any(b in expression for b in blocked):
        logger.warning("Blocked condition expression: %r", expression)
        return False

    try:
        result = eval(expression, {"__builtins__": {}}, {"state": state})  # noqa: S307
        return bool(result)
    except Exception as exc:
        logger.warning("Condition eval failed %r: %s", expression, exc)
        return False   # treat evaluation errors as falsy (skip the edge)


# ─── Single-node execution ────────────────────────────────────────────────────

async def _execute_node(
    node: WorkflowNode,
    shared_state: dict[str, Any],
    tier: int,
) -> NodeResult:
    """
    Execute one agent node:
      1. Build an LLM prompt from the agent's instructions + shared state context.
      2. Call the LLM via llm_router.
      3. Return a NodeResult with all state updates to write.

    This function is pure — it does NOT write to Redis.
    All Redis writes happen in the tier-merge step so they are batched.
    """
    t0 = time.perf_counter()
    result = NodeResult(
        node_id=node.id,
        agent_name=node.agent_name,
        status="running",
        parallel_tier=tier,
    )

    try:
        # Build context from relevant shared state
        peer_outputs = {
            k: v for k, v in shared_state.items()
            if not k.startswith("__") and "llm_response" in k
        }
        context_lines = []
        for k, v in list(peer_outputs.items())[:6]:
            v_str = str(v)[:400]
            context_lines.append(f"- {k}: {v_str}")
        context = "\n".join(context_lines) if context_lines else "No prior agent outputs yet."

        user_prompt = (
            f"{node.prompt}\n\n"
            f"## Shared Context (outputs from other agents)\n"
            f"{context}\n\n"
            f"Parallel tier: {tier}. Respond as the {node.role} agent. Be concise."
        )

        system_prompt = (
            f"You are {node.agent_name}, a {node.role} agent in a multi-agent pipeline."
        )

        llm_resp = await llm_router.generate(
            prompt=user_prompt,
            model=node.model,
            params=GenerateParams(
                system=system_prompt,
                temperature=node.temperature,
                max_tokens=node.max_tokens,
            ),
        )

        result.llm_response = llm_resp.content
        result.status = "success"

        # Build state updates — namespaced by node_id
        result.state_updates = {
            f"{node.id}:llm_response":  llm_resp.content,
            f"{node.id}:model_used":    llm_resp.model,
            f"{node.id}:provider_used": llm_resp.provider,
            f"{node.id}:status":        "success",
            f"{node.id}:tier":          tier,
            f"{node.id}:tokens":        llm_resp.usage.total_tokens,
        }

    except Exception as exc:
        logger.exception("Node '%s' failed: %s", node.agent_name, exc)
        result.status = "error"
        result.error = str(exc)
        result.state_updates = {
            f"{node.id}:status": "error",
            f"{node.id}:error":  str(exc),
        }

    result.finished_at  = datetime.utcnow().isoformat()
    result.duration_ms  = round((time.perf_counter() - t0) * 1000, 2)
    return result


# ─── Merge helper ─────────────────────────────────────────────────────────────

def _merge_tier_results(
    results: list[NodeResult],
    shared_state: dict[str, Any],
) -> dict[str, Any]:
    """
    Merge all node state_updates from a parallel tier into shared_state.

    Conflict resolution: last-write-wins within a tier is fine because
    each node writes to its own namespaced keys (node_id:key).
    Cross-node conflicts on non-namespaced keys are resolved by keeping
    the value from the last successful node (deterministic order).
    """
    merged: dict[str, Any] = {}
    for result in results:
        if result.state_updates:
            merged.update(result.state_updates)

    # Track which nodes ran in this tier
    tier_num = results[0].parallel_tier if results else 0
    merged[f"__tier_{tier_num}_nodes__"] = [r.node_id for r in results]
    merged[f"__tier_{tier_num}_status__"] = {
        r.node_id: r.status for r in results
    }
    merged["__last_tier__"] = tier_num

    return {**shared_state, **merged}


# ─── Main engine ──────────────────────────────────────────────────────────────

class FlowEngine:
    """
    Parallel async workflow execution engine.

    Usage:
        engine = FlowEngine()
        report = await engine.execute(run_id, nodes, edges, max_iterations=5)
    """

    async def execute(
        self,
        run_id: str,
        nodes: list[WorkflowNode],
        edges: list[WorkflowEdge],
        max_iterations: int = DEFAULT_MAX_ITERATIONS,
    ) -> FlowExecutionReport:
        wall_start = time.perf_counter()
        report = FlowExecutionReport(
            run_id=run_id,
            status="running",
            total_nodes=len(nodes),
        )

        # ── Mark run as running in Redis ─────────────────────────────────────
        await run_state_service.update_status(run_id, "running")

        # ── Read initial shared state ─────────────────────────────────────────
        shared_state: dict[str, Any] = await run_state_service.read_state(run_id) or {}

        # ── Build DAG ─────────────────────────────────────────────────────────
        dag = WorkflowDAG(nodes, edges)
        tiers = dag.tiers()
        report.parallel_tiers = len(tiers)
        report.max_concurrency = max(len(t) for t in tiers) if tiers else 0

        logger.info(
            "FlowEngine: run=%s nodes=%d tiers=%d max_concurrency=%d",
            run_id, len(nodes), len(tiers), report.max_concurrency,
        )

        # ── Execute tier by tier ──────────────────────────────────────────────
        iteration_count: dict[str, int] = {n.id: 0 for n in nodes}
        node_map = dag.nodes

        for tier_idx, tier_node_ids in enumerate(tiers):

            # Filter to nodes that:
            # (a) haven't exceeded max iterations
            # (b) have at least one passing incoming edge (or are roots)
            runnable: list[str] = []
            for node_id in tier_node_ids:
                if iteration_count.get(node_id, 0) >= max_iterations:
                    logger.info("Node %s skipped: max iterations reached", node_id)
                    report.nodes_skipped += 1
                    continue

                # Check all incoming edges
                incoming = [e for e in edges if e.target == node_id]
                if incoming:
                    # At least one incoming edge must pass its condition
                    any_pass = any(
                        _evaluate_condition(e.condition, shared_state)
                        for e in incoming
                    )
                    if not any_pass:
                        logger.info("Node %s skipped: all conditions failed", node_id)
                        report.nodes_skipped += 1
                        # Write skip status to state
                        shared_state[f"{node_id}:status"] = "skipped"
                        continue

                runnable.append(node_id)
                iteration_count[node_id] = iteration_count.get(node_id, 0) + 1

            if not runnable:
                logger.info("Tier %d: all nodes skipped", tier_idx)
                continue

            logger.info(
                "Tier %d: running %d node(s) in parallel: %s",
                tier_idx, len(runnable), runnable,
            )

            # ── Run all nodes in this tier concurrently ───────────────────────
            tasks = [
                _execute_node(node_map[nid], shared_state, tier_idx)
                for nid in runnable
                if nid in node_map
            ]

            tier_results: list[NodeResult] = await asyncio.gather(*tasks)

            # ── Merge tier results into shared state ──────────────────────────
            shared_state = _merge_tier_results(list(tier_results), shared_state)

            # ── Persist merged state to Redis ─────────────────────────────────
            tier_updates = {}
            for result in tier_results:
                tier_updates.update(result.state_updates)

            await run_state_service.write_state(run_id, tier_updates, agent_id=f"tier_{tier_idx}")

            # ── Update report ─────────────────────────────────────────────────
            for result in tier_results:
                report.node_results.append(result)
                if result.status == "success":
                    report.nodes_executed += 1
                elif result.status == "error":
                    report.nodes_failed += 1

            logger.info(
                "Tier %d complete: %d success, %d failed",
                tier_idx,
                sum(1 for r in tier_results if r.status == "success"),
                sum(1 for r in tier_results if r.status == "error"),
            )

        # ── Finalise ──────────────────────────────────────────────────────────
        report.total_duration_ms = round((time.perf_counter() - wall_start) * 1000, 2)
        report.status = (
            "error"   if report.nodes_failed > 0 and report.nodes_executed == 0
            else "partial" if report.nodes_failed > 0
            else "success"
        )
        report.final_state = shared_state

        # Write summary to Redis
        await run_state_service.write_state(run_id, {
            "__flow_status__":       report.status,
            "__total_duration_ms__": report.total_duration_ms,
            "__parallel_tiers__":    report.parallel_tiers,
            "__max_concurrency__":   report.max_concurrency,
        }, agent_id="flow_engine")

        await run_state_service.update_status(
            run_id,
            "completed" if report.status == "success" else "failed",
        )

        logger.info(
            "FlowEngine done: run=%s status=%s tiers=%d executed=%d failed=%d duration=%.0fms",
            run_id, report.status, report.parallel_tiers,
            report.nodes_executed, report.nodes_failed, report.total_duration_ms,
        )

        return report


# ── Singleton ─────────────────────────────────────────────────────────────────
flow_engine = FlowEngine()
