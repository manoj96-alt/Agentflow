"""
Shared types for the LLM abstraction layer.
All providers speak this common vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ─── Provider / model registry ────────────────────────────────────────────────

Provider = Literal["anthropic", "openai"]

# Maps every supported model identifier → its provider
MODEL_PROVIDER_MAP: dict[str, Provider] = {
    # Anthropic
    "claude-opus-4-5":   "anthropic",
    "claude-sonnet-4-5": "anthropic",
    "claude-haiku-4-5":  "anthropic",
    # OpenAI
    "gpt-4o":            "openai",
    "gpt-4o-mini":       "openai",
    "gpt-4-turbo":       "openai",
    "gpt-3.5-turbo":     "openai",
}

# Model capability metadata — used by dynamic selection
MODEL_METADATA: dict[str, dict[str, Any]] = {
    "claude-opus-4-5":   {"tier": "premium",  "ctx": 200_000, "cost_rank": 1, "speed_rank": 4},
    "claude-sonnet-4-5": {"tier": "balanced", "ctx": 200_000, "cost_rank": 2, "speed_rank": 2},
    "claude-haiku-4-5":  {"tier": "fast",     "ctx": 200_000, "cost_rank": 4, "speed_rank": 1},
    "gpt-4o":            {"tier": "premium",  "ctx": 128_000, "cost_rank": 1, "speed_rank": 3},
    "gpt-4o-mini":       {"tier": "fast",     "ctx": 128_000, "cost_rank": 5, "speed_rank": 1},
    "gpt-4-turbo":       {"tier": "balanced", "ctx": 128_000, "cost_rank": 2, "speed_rank": 3},
    "gpt-3.5-turbo":     {"tier": "fast",     "ctx":  16_000, "cost_rank": 5, "speed_rank": 1},
}


def provider_for(model: str) -> Provider:
    p = MODEL_PROVIDER_MAP.get(model)
    if p is None:
        raise ValueError(
            f"Unknown model '{model}'. "
            f"Supported: {list(MODEL_PROVIDER_MAP)}"
        )
    return p


# ─── Request ──────────────────────────────────────────────────────────────────

@dataclass
class GenerateParams:
    """
    Unified generation parameters — provider-agnostic.
    Pass to LLMRouter.generate(prompt, model, params).
    """
    system: str | None = None          # system prompt (prepended before user turn)
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float | None = None
    stop: list[str] | None = None
    stream: bool = False               # reserved — not yet implemented
    extra: dict[str, Any] = field(default_factory=dict)  # provider-specific pass-through


# ─── Response ─────────────────────────────────────────────────────────────────

@dataclass
class LLMUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class LLMResponse:
    """
    Normalised response returned by every provider.
    Callers never need to know which SDK produced this.
    """
    content: str                       # generated text
    model: str                         # exact model string used
    provider: Provider                 # "anthropic" | "openai"
    usage: LLMUsage = field(default_factory=LLMUsage)
    finish_reason: str = "stop"        # "stop" | "length" | "error"
    raw: Any = None                    # original SDK response object
    latency_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "model": self.model,
            "provider": self.provider,
            "usage": {
                "prompt_tokens":     self.usage.prompt_tokens,
                "completion_tokens": self.usage.completion_tokens,
                "total_tokens":      self.usage.total_tokens,
            },
            "finish_reason": self.finish_reason,
            "latency_ms": self.latency_ms,
        }


# ─── Error ────────────────────────────────────────────────────────────────────

class LLMError(Exception):
    """Raised by any provider when generation fails."""
    def __init__(self, message: str, provider: str, model: str, cause: Exception | None = None):
        super().__init__(message)
        self.provider = provider
        self.model = model
        self.cause = cause
