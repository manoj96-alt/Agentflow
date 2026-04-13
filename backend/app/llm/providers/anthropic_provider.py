"""
AnthropicProvider
=================
Implements BaseLLMProvider using the official `anthropic` SDK.

Supported models: claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import anthropic

from app.llm.base import BaseLLMProvider
from app.llm.types import (
    GenerateParams,
    LLMError,
    LLMResponse,
    LLMUsage,
    MODEL_PROVIDER_MAP,
)

logger = logging.getLogger(__name__)

ANTHROPIC_MODELS = {m for m, p in MODEL_PROVIDER_MAP.items() if p == "anthropic"}


class AnthropicProvider(BaseLLMProvider):
    """
    Thin async wrapper around the Anthropic Messages API.

    API key is read from the ANTHROPIC_API_KEY environment variable.
    Pass api_key explicitly to override (useful in tests).
    """

    def __init__(self, api_key: str | None = None) -> None:
        key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        if not key:
            logger.warning(
                "ANTHROPIC_API_KEY not set — Anthropic calls will fail at runtime"
            )
        self._client = anthropic.AsyncAnthropic(api_key=key or "not-set")

    @property
    def provider_name(self) -> str:
        return "anthropic"

    def supports_model(self, model: str) -> bool:
        return model in ANTHROPIC_MODELS

    async def generate(
        self,
        prompt: str,
        model: str,
        params: GenerateParams,
    ) -> LLMResponse:
        """
        Call the Anthropic Messages endpoint.

        Maps GenerateParams → Anthropic-specific kwargs:
          params.system       → system parameter
          params.temperature  → temperature
          params.max_tokens   → max_tokens  (required by Anthropic API)
          params.top_p        → top_p
          params.stop         → stop_sequences
          params.extra        → merged into the request kwargs
        """
        if not self.supports_model(model):
            raise LLMError(
                f"Model '{model}' is not an Anthropic model",
                provider=self.provider_name,
                model=model,
            )

        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": params.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": params.temperature,
            **params.extra,
        }

        if params.system:
            kwargs["system"] = params.system
        if params.top_p is not None:
            kwargs["top_p"] = params.top_p
        if params.stop:
            kwargs["stop_sequences"] = params.stop

        t0 = time.perf_counter()
        try:
            response = await self._client.messages.create(**kwargs)
        except anthropic.AuthenticationError as exc:
            raise LLMError("Invalid Anthropic API key", self.provider_name, model, exc) from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Anthropic rate limit exceeded", self.provider_name, model, exc) from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(
                f"Anthropic API error {exc.status_code}: {exc.message}",
                self.provider_name, model, exc,
            ) from exc
        except Exception as exc:
            raise LLMError(str(exc), self.provider_name, model, exc) from exc

        latency_ms = (time.perf_counter() - t0) * 1000

        # Extract text from content blocks
        text = "".join(
            block.text for block in response.content
            if hasattr(block, "text")
        )

        usage = LLMUsage(
            prompt_tokens=response.usage.input_tokens,
            completion_tokens=response.usage.output_tokens,
            total_tokens=response.usage.input_tokens + response.usage.output_tokens,
        )

        finish_map = {
            "end_turn":      "stop",
            "max_tokens":    "length",
            "stop_sequence": "stop",
        }

        return LLMResponse(
            content=text,
            model=response.model,
            provider=self.provider_name,
            usage=usage,
            finish_reason=finish_map.get(response.stop_reason or "", "stop"),
            raw=response,
            latency_ms=round(latency_ms, 2),
        )
