"""
ModelSelector
=============
Chooses the best model for an agent given a strategy and constraints.

Strategies
----------
"balanced"  — cost_rank 2–3, reasonable speed (default)
"cheapest"  — lowest cost model available
"fastest"   — lowest latency model available
"smartest"  — highest capability (premium tier)
"explicit"  — always use whatever model the agent specifies (no-op selector)

Usage
-----
    from app.llm.model_selector import ModelSelector

    selector = ModelSelector(strategy="balanced")

    # Let selector pick from all models
    model = selector.select()

    # Constrain to a specific provider
    model = selector.select(provider_filter="anthropic")

    # Enforce the agent's own model choice
    model = selector.select(preferred="claude-haiku-4-5", strategy_override="explicit")
"""

from __future__ import annotations

import logging
import os
from typing import Literal

from app.llm.types import MODEL_METADATA, MODEL_PROVIDER_MAP, Provider

logger = logging.getLogger(__name__)

Strategy = Literal["balanced", "cheapest", "fastest", "smartest", "explicit"]

DEFAULT_MODEL = os.getenv("LLM_DEFAULT_MODEL", "claude-sonnet-4-5")
DEFAULT_STRATEGY: Strategy = os.getenv("LLM_SELECTION_STRATEGY", "balanced")  # type: ignore[assignment]


class ModelSelector:
    """
    Stateless helper that applies a scoring strategy to pick a model.
    All state (strategy, provider_filter) is passed per-call so the same
    instance can be shared safely across concurrent requests.
    """

    def select(
        self,
        preferred: str | None = None,
        strategy: Strategy | None = None,
        provider_filter: Provider | None = None,
        task_hint: str | None = None,
    ) -> str:
        """
        Return the best model identifier for the given constraints.

        Parameters
        ----------
        preferred:
            The model the agent explicitly asked for. If strategy is
            "explicit" this is returned immediately (after validation).
        strategy:
            Override the default selection strategy for this call.
        provider_filter:
            Limit candidates to a single provider ("anthropic" | "openai").
        task_hint:
            Natural-language hint, e.g. "code generation", "summarisation".
            Reserved for future LLM-based meta-selection.

        Returns
        -------
        str
            A validated model identifier from MODEL_PROVIDER_MAP.
        """
        active_strategy: Strategy = strategy or DEFAULT_STRATEGY  # type: ignore[assignment]

        # ── Explicit: trust the agent's model choice ─────────────────────────
        if active_strategy == "explicit" and preferred:
            return self._validate(preferred)

        # ── If a preferred model is set and no overriding strategy, use it ───
        if preferred and active_strategy not in ("cheapest", "fastest", "smartest"):
            return self._validate(preferred)

        # ── Build candidate pool ──────────────────────────────────────────────
        candidates = list(MODEL_METADATA.items())

        if provider_filter:
            candidates = [
                (m, meta) for m, meta in candidates
                if MODEL_PROVIDER_MAP.get(m) == provider_filter
            ]

        if not candidates:
            logger.warning(
                "No candidates after filtering (provider=%s) — using default '%s'",
                provider_filter, DEFAULT_MODEL,
            )
            return DEFAULT_MODEL

        # ── Score and rank ────────────────────────────────────────────────────
        def score(item: tuple[str, dict]) -> int:
            _, meta = item
            if active_strategy == "cheapest":
                # Higher cost_rank = cheaper
                return -meta["cost_rank"]
            if active_strategy == "fastest":
                # Higher speed_rank = faster; negate for min-sort
                return -meta["speed_rank"]
            if active_strategy == "smartest":
                # Lower cost_rank = more capable; negate for min-sort
                return meta["cost_rank"]
            # "balanced" — favour cost_rank 2 (middle tier, good value)
            # We minimise distance from cost_rank 2
            return abs(meta["cost_rank"] - 2)

        candidates.sort(key=score)
        chosen = candidates[0][0]

        logger.debug(
            "ModelSelector: strategy=%s provider=%s preferred=%s → '%s'",
            active_strategy, provider_filter, preferred, chosen,
        )
        return chosen

    @staticmethod
    def _validate(model: str) -> str:
        if model not in MODEL_PROVIDER_MAP:
            raise ValueError(
                f"Model '{model}' is not registered. "
                f"Supported: {sorted(MODEL_PROVIDER_MAP)}"
            )
        return model

    @staticmethod
    def metadata(model: str) -> dict:
        return MODEL_METADATA.get(model, {})

    @staticmethod
    def all_models() -> list[dict]:
        return [
            {
                "model": m,
                "provider": MODEL_PROVIDER_MAP[m],
                **MODEL_METADATA.get(m, {}),
            }
            for m in MODEL_PROVIDER_MAP
        ]


# Singleton
model_selector = ModelSelector()
