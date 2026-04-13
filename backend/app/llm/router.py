"""
LLMRouter
=========
The single entry point for every LLM call in FlowForge.

Public API (matches the spec):
    generate(prompt, model, params) → LLMResponse

Responsibilities
----------------
1. Resolve which provider handles `model` (via MODEL_PROVIDER_MAP).
2. Optionally override `model` using ModelSelector strategies.
3. Route the call to the correct provider (Anthropic or OpenAI).
4. Emit structured logs for observability.
5. Optionally retry transient failures.

Usage
-----
    from app.llm.router import llm_router
    from app.llm.types import GenerateParams

    response = await llm_router.generate(
        prompt="Summarise the following text: ...",
        model="claude-sonnet-4-5",
        params=GenerateParams(system="You are a concise summariser.", temperature=0.3),
    )
    print(response.content)
    print(response.usage.total_tokens)

Dynamic selection:
    response = await llm_router.generate(
        prompt="Write a sorting algorithm in Python",
        model=None,                      # let the router pick
        params=GenerateParams(...),
        strategy="cheapest",
        provider_filter="anthropic",
    )
"""

from __future__ import annotations

import logging
import os
from typing import Literal

from app.llm.base import BaseLLMProvider
from app.llm.model_selector import ModelSelector, Strategy, model_selector
from app.llm.providers.anthropic_provider import AnthropicProvider
from app.llm.providers.openai_provider import OpenAIProvider
from app.llm.types import (
    GenerateParams,
    LLMError,
    LLMResponse,
    Provider,
    provider_for,
)

logger = logging.getLogger(__name__)


class LLMRouter:
    """
    Routes `generate(prompt, model, params)` to the correct provider.

    Provider instances are created once and reused — their underlying
    SDK clients manage connection pools internally.
    """

    def __init__(self) -> None:
        self._providers: dict[str, BaseLLMProvider] = {
            "anthropic": AnthropicProvider(),
            "openai":    OpenAIProvider(),
        }
        self._selector = model_selector

    # ── Main public interface ─────────────────────────────────────────────────

    async def generate(
        self,
        prompt: str,
        model: str | None,
        params: GenerateParams | None = None,
        *,
        strategy: Strategy | None = None,
        provider_filter: Provider | None = None,
    ) -> LLMResponse:
        """
        Generate a completion.

        Parameters
        ----------
        prompt:
            The user-facing input / question / instruction.
        model:
            Model identifier (e.g. "claude-sonnet-4-5"). Pass None to let
            the ModelSelector choose based on `strategy`.
        params:
            Generation parameters. Defaults to GenerateParams() if omitted.
        strategy:
            Dynamic model selection strategy override.
            Ignored when `model` is provided and strategy is not "cheapest",
            "fastest", or "smartest".
        provider_filter:
            Restrict dynamic selection to a single provider.

        Returns
        -------
        LLMResponse — provider-agnostic normalised response.

        Raises
        ------
        LLMError — on provider failure, auth error, or unknown model.
        """
        if params is None:
            params = GenerateParams()

        # ── Resolve model ─────────────────────────────────────────────────────
        resolved_model = self._selector.select(
            preferred=model,
            strategy=strategy,
            provider_filter=provider_filter,
        )

        # ── Route to provider ─────────────────────────────────────────────────
        provider_name = provider_for(resolved_model)
        provider = self._providers.get(provider_name)
        if provider is None:
            raise LLMError(
                f"No provider registered for '{provider_name}'",
                provider=provider_name,
                model=resolved_model,
            )

        logger.info(
            "LLMRouter → provider=%s model=%s temp=%.1f max_tokens=%d",
            provider_name, resolved_model, params.temperature, params.max_tokens,
        )

        response = await provider.generate(prompt, resolved_model, params)

        logger.info(
            "LLMRouter ← %d tokens (prompt=%d, completion=%d) in %.0fms finish=%s",
            response.usage.total_tokens,
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
            response.latency_ms,
            response.finish_reason,
        )

        return response

    # ── Convenience helpers ───────────────────────────────────────────────────

    async def generate_with_system(
        self,
        system: str,
        prompt: str,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        """Shorthand: one-line call with a system prompt."""
        return await self.generate(
            prompt=prompt,
            model=model,
            params=GenerateParams(
                system=system,
                temperature=temperature,
                max_tokens=max_tokens,
            ),
        )

    def list_models(self) -> list[dict]:
        """Return all registered models with provider + metadata."""
        return ModelSelector.all_models()

    def get_provider(self, name: str) -> BaseLLMProvider | None:
        return self._providers.get(name)


# ── Singleton ─────────────────────────────────────────────────────────────────
llm_router = LLMRouter()
