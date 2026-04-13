"""
BaseLLMProvider
===============
Abstract interface every concrete provider must implement.
Callers only ever interact with this interface — never with SDK objects directly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.llm.types import GenerateParams, LLMResponse


class BaseLLMProvider(ABC):
    """
    Contract for all LLM provider adapters.

    Implementations must override `generate` and `provider_name`.
    They should raise `LLMError` on failure (never let SDK exceptions leak).
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Human-readable provider identifier, e.g. 'anthropic'."""
        ...

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        model: str,
        params: GenerateParams,
    ) -> LLMResponse:
        """
        Generate a completion for `prompt` using `model`.

        Parameters
        ----------
        prompt:
            The user-facing input / instruction.
        model:
            The exact model identifier (e.g. "claude-sonnet-4-5").
        params:
            Unified generation parameters (temperature, max_tokens, system, …).

        Returns
        -------
        LLMResponse
            Normalised response — provider-agnostic.

        Raises
        ------
        LLMError
            On any provider-level failure (auth, rate-limit, timeout, …).
        """
        ...

    @abstractmethod
    def supports_model(self, model: str) -> bool:
        """Return True if this provider handles the given model identifier."""
        ...
