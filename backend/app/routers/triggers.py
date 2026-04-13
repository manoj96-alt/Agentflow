"""
Trigger System
==============
Event-driven workflow execution.

Trigger types:
  webhook   — POST to /api/triggers/webhook/{trigger_id} runs a workflow
  scheduled — cron expression (stored, evaluated by background task)
  api       — programmatic trigger via POST /api/triggers/{id}/fire

Endpoints:
  POST   /api/triggers/              — create trigger
  GET    /api/triggers/              — list triggers
  GET    /api/triggers/{id}          — get trigger
  DELETE /api/triggers/{id}          — delete trigger
  POST   /api/triggers/{id}/fire     — manually fire a trigger
  POST   /api/triggers/webhook/{id}  — webhook endpoint (public, no auth)
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/triggers", tags=["triggers"])

# ── In-memory trigger store ───────────────────────────────────────────────────

_triggers: dict[str, dict] = {}
_trigger_runs: list[dict]  = []

# ── Schemas ───────────────────────────────────────────────────────────────────

class TriggerCreate(BaseModel):
    name:        str
    type:        str = Field(..., description="webhook | scheduled | api")
    workflow_id: str
    cron:        str | None = Field(None, description="Cron expression for scheduled triggers, e.g. '0 9 * * *'")
    initial_state: dict[str, Any] = Field(default_factory=dict)
    enabled:     bool = True
    description: str = ""

# ── Background execution ──────────────────────────────────────────────────────

async def _execute_workflow_headless(workflow_id: str, initial_state: dict, trigger_id: str, source: str):
    """Fire-and-forget workflow execution."""
    run_id = str(uuid.uuid4())
    _trigger_runs.append({
        "run_id":      run_id,
        "trigger_id":  trigger_id,
        "workflow_id": workflow_id,
        "source":      source,
        "status":      "running",
        "started_at":  datetime.utcnow().isoformat(),
        "initial_state": initial_state,
    })
    logger.info("Trigger '%s' fired workflow '%s' (run %s)", trigger_id, workflow_id, run_id)

    try:
        # Call the execution endpoint internally
        import httpx
        async with httpx.AsyncClient(timeout=300) as client:
            res = await client.post(
                f"http://localhost:8000/api/execute/workflow/{workflow_id}",
                json={"initial_state": initial_state, "max_iterations": 5},
            )
            result = res.json() if res.status_code == 200 else {"error": res.text}

        # Update run record
        for run in _trigger_runs:
            if run["run_id"] == run_id:
                run["status"]       = "completed" if res.status_code == 200 else "failed"
                run["completed_at"] = datetime.utcnow().isoformat()
                run["result"]       = result
                break
    except Exception as exc:
        logger.exception("Trigger execution failed: %s", exc)
        for run in _trigger_runs:
            if run["run_id"] == run_id:
                run["status"] = "error"
                run["error"]  = str(exc)
                break

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", summary="Create a trigger")
async def create_trigger(body: TriggerCreate):
    """
    Create a new trigger.

    **webhook:** POST to `/api/triggers/webhook/{trigger_id}` to fire it.
    **scheduled:** Set `cron` to a cron expression (e.g. `0 9 * * *` for 9am daily).
    **api:** Fire manually via `POST /api/triggers/{id}/fire`.
    """
    trigger_id = str(uuid.uuid4())
    trigger = {
        "trigger_id":    trigger_id,
        "name":          body.name,
        "type":          body.type,
        "workflow_id":   body.workflow_id,
        "cron":          body.cron,
        "initial_state": body.initial_state,
        "enabled":       body.enabled,
        "description":   body.description,
        "created_at":    datetime.utcnow().isoformat(),
        "last_fired":    None,
        "fire_count":    0,
    }
    _triggers[trigger_id] = trigger

    webhook_url = f"/api/triggers/webhook/{trigger_id}" if body.type == "webhook" else None
    return {
        "trigger_id": trigger_id,
        "name":       body.name,
        "type":       body.type,
        "webhook_url": webhook_url,
        "created":    True,
    }

@router.get("/", summary="List all triggers")
async def list_triggers():
    return {"triggers": list(_triggers.values()), "count": len(_triggers)}

@router.get("/{trigger_id}", summary="Get a trigger")
async def get_trigger(trigger_id: str):
    t = _triggers.get(trigger_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
    return t

@router.delete("/{trigger_id}", summary="Delete a trigger")
async def delete_trigger(trigger_id: str):
    if trigger_id not in _triggers:
        raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
    del _triggers[trigger_id]
    return {"deleted": True, "trigger_id": trigger_id}

@router.post("/{trigger_id}/fire", summary="Manually fire a trigger")
async def fire_trigger(trigger_id: str, background: BackgroundTasks, payload: dict = {}):
    t = _triggers.get(trigger_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
    if not t["enabled"]:
        raise HTTPException(status_code=400, detail="Trigger is disabled")

    t["last_fired"] = datetime.utcnow().isoformat()
    t["fire_count"] = t.get("fire_count", 0) + 1

    initial_state = {**t.get("initial_state", {}), **payload, "trigger_source": "api"}
    background.add_task(_execute_workflow_headless, t["workflow_id"], initial_state, trigger_id, "api")

    return {"fired": True, "trigger_id": trigger_id, "workflow_id": t["workflow_id"]}

@router.post("/webhook/{trigger_id}", summary="Webhook endpoint — fires a workflow")
async def webhook_trigger(trigger_id: str, request: Request, background: BackgroundTasks):
    """
    Public webhook endpoint. POST any JSON body here and the linked workflow runs.
    The body is merged into the workflow's initial state under `webhook:payload`.
    """
    t = _triggers.get(trigger_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trigger not found")
    if not t["enabled"]:
        return {"accepted": False, "reason": "trigger disabled"}
    if t["type"] != "webhook":
        raise HTTPException(status_code=400, detail="This trigger is not a webhook type")

    try:
        body = await request.json()
    except Exception:
        body = {}

    t["last_fired"] = datetime.utcnow().isoformat()
    t["fire_count"] = t.get("fire_count", 0) + 1

    initial_state = {
        **t.get("initial_state", {}),
        "webhook:payload": body,
        "webhook:headers": dict(request.headers),
        "trigger_source":  "webhook",
    }
    background.add_task(_execute_workflow_headless, t["workflow_id"], initial_state, trigger_id, "webhook")

    return {"accepted": True, "trigger_id": trigger_id, "workflow_id": t["workflow_id"]}

@router.get("/runs/history", summary="Get trigger execution history")
async def trigger_run_history(limit: int = 50):
    return {"runs": _trigger_runs[-limit:], "total": len(_trigger_runs)}
