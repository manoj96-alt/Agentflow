"""
OpenAIProvider
==============
Implements BaseLLMProvider using the official `openai` SDK.

Supported models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import openai
from openai import AsyncOpenAI

from app.llm.base import BaseLLMProvider
from app.llm.types import (
    GenerateParams,
    LLMError,
    LLMResponse,
    LLMUsage,
    MODEL_PROVIDER_MAP,
)

logger = logging.getLogger(__name__)

OPENAI_MODELS = {m for m, p in MODEL_PROVIDER_MAP.items() if p == "openai"}


class OpenAIProvider(BaseLLMProvider):
    """
    Thin async wrapper around the OpenAI Chat Completions API.

    API key is read from OPENAI_API_KEY environment variable.
    Pass api_key explicitly to override (useful in tests).
    """

    def __init__(self, api_key: str | None = None) -> None:
        key = api_key or os.getenv("OPENAI_API_KEY", "")
        if not key:
            logger.warning(
                "OPENAI_API_KEY not set — OpenAI calls will fail at runtime"
            )
        self._client = AsyncOpenAI(api_key=key or "not-set")

    @property
    def provider_name(self) -> str:
        return "openai"

    def supports_model(self, model: str) -> bool:
        return model in OPENAI_MODELS

    async def generate(
        self,
        prompt: str,
        model: str,
        params: GenerateParams,
    ) -> LLMResponse:
        """
        Call the OpenAI Chat Completions endpoint.

        Maps GenerateParams → OpenAI-specific kwargs:
          params.system       → messages[0] with role "system"
          params.temperature  → temperature
          params.max_tokens   → max_tokens
          params.top_p        → top_p
          params.stop         → stop
          params.extra        → merged into the request kwargs
        """
        if not self.supports_model(model):
            raise LLMError(
                f"Model '{model}' is not an OpenAI model",
                provider=self.provider_name,
                model=model,
            )

        messages: list[dict[str, str]] = []
        if params.system:
            messages.append({"role": "system", "content": params.system})
        messages.append({"role": "user", "content": prompt})

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            **params.extra,
        }

        if params.top_p is not None:
            kwargs["top_p"] = params.top_p
        if params.stop:
            kwargs["stop"] = params.stop

        t0 = time.perf_counter()
        try:
            response = await self._client.chat.completions.create(**kwargs)
        except openai.AuthenticationError as exc:
            raise LLMError("Invalid OpenAI API key", self.provider_name, model, exc) from exc
        except openai.RateLimitError as exc:
            raise LLMError("OpenAI rate limit exceeded", self.provider_name, model, exc) from exc
        except openai.APIStatusError as exc:
            raise LLMError(
                f"OpenAI API error {exc.status_code}: {exc.message}",
                self.provider_name, model, exc,
            ) from exc
        except Exception as exc:
            raise LLMError(str(exc), self.provider_name, model, exc) from exc

        latency_ms = (time.perf_counter() - t0) * 1000

        choice = response.choices[0]
        content = choice.message.content or ""

        usage = LLMUsage(
            prompt_tokens=response.usage.prompt_tokens if response.usage else 0,
            completion_tokens=response.usage.completion_tokens if response.usage else 0,
            total_tokens=response.usage.total_tokens if response.usage else 0,
        )

        finish_map = {
            "stop":          "stop",
            "length":        "length",
            "content_filter": "stop",
        }

        return LLMResponse(
            content=content,
            model=response.model,
            provider=self.provider_name,
            usage=usage,
            finish_reason=finish_map.get(choice.finish_reason or "", "stop"),
            raw=response,
            latency_ms=round(latency_ms, 2),
        )
