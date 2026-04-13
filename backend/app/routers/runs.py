from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from typing import List

from app.models.run import (
    RunCreate,
    RunResponse,
    StateReadRequest,
    StateReadResponse,
    StateWriteRequest,
    StateWriteResponse,
)
from app.services.run_state_service import run_state_service

router = APIRouter(prefix="/runs", tags=["runs"])


# ─── Run lifecycle ────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=RunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new workflow run",
)
async def create_run(data: RunCreate):
    """
    Start a new run for a flow. Returns a `run_id` that agents use for all
    subsequent state reads and writes.

    Optionally supply `initial_state` to seed the shared dictionary.
    """
    return await run_state_service.create_run(data)


@router.get(
    "/",
    response_model=List[RunResponse],
    summary="List all runs",
)
async def list_runs():
    """Return metadata and current state for every active run."""
    return await run_state_service.list_runs()


@router.get(
    "/{run_id}",
    response_model=RunResponse,
    summary="Get run by ID",
)
async def get_run(run_id: str):
    """Fetch full run metadata and shared state for a single run."""
    run = await run_state_service.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return run


@router.patch(
    "/{run_id}/status/{new_status}",
    response_model=RunResponse,
    summary="Update run status",
)
async def update_run_status(run_id: str, new_status: str):
    """
    Transition a run's status.
    Valid values: `created` | `running` | `completed` | `failed`
    """
    valid = {"created", "running", "completed", "failed"}
    if new_status not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status '{new_status}'. Must be one of: {sorted(valid)}",
        )
    ok = await run_state_service.update_status(run_id, new_status)  # type: ignore[arg-type]
    if not ok:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    run = await run_state_service.get_run(run_id)
    return run


@router.delete(
    "/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a run and its state",
)
async def delete_run(run_id: str):
    """Permanently remove a run and all its state from Redis."""
    ok = await run_state_service.delete_run(run_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")


# ─── Agent state operations ───────────────────────────────────────────────────

@router.post(
    "/{run_id}/state/read",
    response_model=StateReadResponse,
    summary="Agent: read state",
)
async def agent_read_state(run_id: str, body: StateReadRequest):
    """
    An agent reads from the shared state dictionary.

    - Pass `keys: null` (or omit) to return the **full** state.
    - Pass `keys: ["key1", "key2"]` to return only those keys.

    Unknown keys are silently omitted from the response.

    ```json
    POST /api/runs/{run_id}/state/read
    { "keys": ["researcher:output", "coder:output"] }
    ```
    """
    state = await run_state_service.read_state(run_id, body.keys)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return StateReadResponse(
        run_id=run_id,
        keys_requested=body.keys,
        state=state,
    )


@router.post(
    "/{run_id}/state/write",
    response_model=StateWriteResponse,
    summary="Agent: write state",
)
async def agent_write_state(run_id: str, body: StateWriteRequest):
    """
    An agent merges key-value pairs into the run's shared state.

    All updates are atomic per request. The write is appended to the
    audit trail stored inside the state under `__audit__`.

    Protected internal keys (`__run_id__`, `__flow_id__`, etc.) are
    silently ignored.

    ```json
    POST /api/runs/{run_id}/state/write
    {
      "agent_id": "agent-abc123",
      "updates": {
        "researcher:output": "Found 3 relevant papers...",
        "researcher:status":  "done"
      }
    }
    ```
    """
    state = await run_state_service.write_state(run_id, body.updates, body.agent_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    # Only return the keys that were actually written (minus protected rejections)
    protected = {"__run_id__", "__flow_id__", "__created_at__", "__status__"}
    keys_written = [k for k in body.updates if k not in protected]

    return StateWriteResponse(
        run_id=run_id,
        keys_written=keys_written,
        state=state,
    )
