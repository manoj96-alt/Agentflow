"""
RunStateService
===============
All state operations go through this service.
It owns the contract:

  run:<run_id>:state  →  JSON dict   (shared state written/read by agents)
  run:<run_id>:meta   →  JSON dict   (RunMeta — status, timestamps, flow_id)

Agents call:
  read_state(run_id, keys?)  — returns full state or subset of keys
  write_state(run_id, updates, agent_id?)  — merges updates, records audit entry
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.core import redis as redis_store
from app.models.run import RunCreate, RunMeta, RunResponse, RunStatus

logger = logging.getLogger(__name__)


class RunStateService:

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def create_run(self, data: RunCreate) -> RunResponse:
        meta = RunMeta(flow_id=data.flow_id)

        # Seed state with initial values + bookkeeping keys
        state: dict[str, Any] = {
            **data.initial_state,
            "__run_id__": meta.run_id,
            "__flow_id__": data.flow_id,
            "__created_at__": meta.created_at.isoformat(),
            "__status__": "created",
            "__audit__": [],          # list of write events from agents
        }

        await redis_store.save_state(meta.run_id, state)
        await redis_store.save_meta(meta.run_id, meta.model_dump(mode="json"))

        return self._build_response(meta, state)

    async def get_run(self, run_id: str) -> RunResponse | None:
        meta_raw = await redis_store.load_meta(run_id)
        if meta_raw is None:
            return None
        state = await redis_store.load_state(run_id) or {}
        meta = RunMeta(**meta_raw)
        return self._build_response(meta, state)

    async def list_runs(self) -> list[RunResponse]:
        run_ids = await redis_store.list_run_ids()
        results = []
        for run_id in run_ids:
            r = await self.get_run(run_id)
            if r:
                results.append(r)
        return results

    async def update_status(self, run_id: str, status: RunStatus) -> bool:
        meta_raw = await redis_store.load_meta(run_id)
        if meta_raw is None:
            return False
        meta = RunMeta(**meta_raw)
        meta.status = status
        meta.updated_at = datetime.utcnow()
        await redis_store.save_meta(run_id, meta.model_dump(mode="json"))

        # Mirror status into shared state
        state = await redis_store.load_state(run_id) or {}
        state["__status__"] = status
        await redis_store.save_state(run_id, state)
        return True

    async def delete_run(self, run_id: str) -> bool:
        meta_raw = await redis_store.load_meta(run_id)
        if meta_raw is None:
            return False
        await redis_store.delete_run(run_id)
        return True

    # ── Agent read ────────────────────────────────────────────────────────────

    async def read_state(
        self,
        run_id: str,
        keys: list[str] | None = None,
    ) -> dict[str, Any] | None:
        state = await redis_store.load_state(run_id)
        if state is None:
            return None
        if keys is None:
            return state
        return {k: state[k] for k in keys if k in state}

    # ── Agent write ───────────────────────────────────────────────────────────

    async def write_state(
        self,
        run_id: str,
        updates: dict[str, Any],
        agent_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Merge `updates` into the run's shared state.
        Appends an audit entry so you can trace which agent wrote what and when.
        Returns the full updated state, or None if run_id not found.
        """
        state = await redis_store.load_state(run_id)
        if state is None:
            return None

        # Prevent agents from overwriting internal bookkeeping keys
        protected = {"__run_id__", "__flow_id__", "__created_at__", "__status__"}
        safe_updates = {k: v for k, v in updates.items() if k not in protected}

        state.update(safe_updates)

        # Append audit trail entry
        audit: list[dict] = state.get("__audit__", [])
        audit.append({
            "agent_id": agent_id,
            "keys": list(safe_updates.keys()),
            "timestamp": datetime.utcnow().isoformat(),
        })
        state["__audit__"] = audit
        state["__last_writer__"] = agent_id
        state["__last_write_at__"] = datetime.utcnow().isoformat()

        await redis_store.save_state(run_id, state)
        logger.info(
            "Agent %s wrote %d key(s) to run %s: %s",
            agent_id or "unknown",
            len(safe_updates),
            run_id,
            list(safe_updates.keys()),
        )
        return state

    # ── Internal ──────────────────────────────────────────────────────────────

    @staticmethod
    def _build_response(meta: RunMeta, state: dict[str, Any]) -> RunResponse:
        return RunResponse(
            run_id=meta.run_id,
            flow_id=meta.flow_id,
            status=meta.status,
            created_at=meta.created_at.isoformat()
                if isinstance(meta.created_at, datetime) else meta.created_at,
            updated_at=meta.updated_at.isoformat()
                if isinstance(meta.updated_at, datetime) else meta.updated_at,
            state=state,
            backend="redis" if redis_store.is_redis_live() else "memory",
        )


run_state_service = RunStateService()
