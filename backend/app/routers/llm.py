"""
LLM Router
==========
REST surface for the LLM abstraction layer.

Endpoints:
  GET  /api/llm/models                — list all models with metadata
  POST /api/llm/generate              — call generate() directly
  POST /api/llm/generate/select       — generate with dynamic model selection
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.llm.router import llm_router
from app.llm.types import GenerateParams, LLMError

router = APIRouter(prefix="/llm", tags=["llm"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="User input / instruction")
    model: str | None = Field(
        default=None,
        description="Model to use (e.g. 'claude-sonnet-4-5'). Omit for auto-selection.",
    )
    system: str | None = Field(default=None, description="System prompt")
    temperature: float = Field(default=0.7, ge=0.0, le=1.0)
    max_tokens: int = Field(default=1024, ge=1, le=128000)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    stop: list[str] | None = Field(default=None)
    extra: dict[str, Any] = Field(default_factory=dict)


class SelectGenerateRequest(GenerateRequest):
    strategy: str | None = Field(
        default=None,
        description=(
            "Model selection strategy: "
            "'balanced' | 'cheapest' | 'fastest' | 'smartest' | 'explicit'"
        ),
    )
    provider_filter: str | None = Field(
        default=None,
        description="Restrict to 'anthropic' or 'openai'",
    )


class GenerateResponse(BaseModel):
    content: str
    model: str
    provider: str
    usage: dict[str, int]
    finish_reason: str
    latency_ms: float


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _to_params(req: GenerateRequest) -> GenerateParams:
    return GenerateParams(
        system=req.system,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        top_p=req.top_p,
        stop=req.stop,
        extra=req.extra,
    )


def _to_response(result) -> GenerateResponse:
    return GenerateResponse(
        content=result.content,
        model=result.model,
        provider=result.provider,
        usage=result.usage.__dict__,
        finish_reason=result.finish_reason,
        latency_ms=result.latency_ms,
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/models",
    summary="List all available LLM models",
)
async def list_models():
    """
    Return every registered model with its provider, tier, context window,
    cost rank, and speed rank.

    ```
    tier:       "fast" | "balanced" | "premium"
    cost_rank:  1 (expensive) → 5 (cheapest)
    speed_rank: 1 (slowest)   → 5 (fastest)
    ctx:        context window in tokens
    ```
    """
    return {"models": llm_router.list_models()}


@router.post(
    "/generate",
    response_model=GenerateResponse,
    summary="Generate a completion (explicit model)",
)
async def generate(req: GenerateRequest):
    """
    Call `generate(prompt, model, params)` directly.

    - Specify `model` to use a particular model.
    - Omit `model` to use the default (`LLM_DEFAULT_MODEL` env var).

    **Example — Anthropic:**
    ```json
    {
      "prompt": "Explain transformers in 3 sentences.",
      "model": "claude-sonnet-4-5",
      "system": "You are a concise ML educator.",
      "temperature": 0.4,
      "max_tokens": 256
    }
    ```

    **Example — OpenAI:**
    ```json
    {
      "prompt": "Write a Python quicksort.",
      "model": "gpt-4o-mini",
      "temperature": 0.2,
      "max_tokens": 512
    }
    ```
    """
    try:
        result = await llm_router.generate(
            prompt=req.prompt,
            model=req.model,
            params=_to_params(req),
        )
        return _to_response(result)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail={
            "error": str(exc),
            "provider": exc.provider,
            "model": exc.model,
        })
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post(
    "/generate/select",
    response_model=GenerateResponse,
    summary="Generate with dynamic model selection",
)
async def generate_with_selection(req: SelectGenerateRequest):
    """
    Generate using automatic model selection.

    The router uses `strategy` and `provider_filter` to pick the best
    model before calling the provider. The `model` field becomes a *hint*
    unless `strategy` is `"explicit"`.

    **Strategies:**

    | strategy  | Picks…                                  |
    |-----------|------------------------------------------|
    | balanced  | Middle tier — good value (default)       |
    | cheapest  | Lowest cost model                        |
    | fastest   | Lowest latency model                     |
    | smartest  | Highest capability (premium tier)        |
    | explicit  | Exactly the `model` you specify          |

    **Example — cheapest Anthropic model:**
    ```json
    {
      "prompt": "Translate 'hello' to French.",
      "strategy": "cheapest",
      "provider_filter": "anthropic"
    }
    ```
    """
    try:
        result = await llm_router.generate(
            prompt=req.prompt,
            model=req.model,
            params=_to_params(req),
            strategy=req.strategy,      # type: ignore[arg-type]
            provider_filter=req.provider_filter,  # type: ignore[arg-type]
        )
        return _to_response(result)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail={
            "error": str(exc),
            "provider": exc.provider,
            "model": exc.model,
        })
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
