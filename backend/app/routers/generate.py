"""
POST /api/generate-workflow
===========================
Accepts a natural language description and returns a workflow JSON graph.
Uses Claude server-side so the API key stays on the backend.
"""
from __future__ import annotations

import json
import logging
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.llm.router import llm_router
from app.llm.types import GenerateParams

logger = logging.getLogger(__name__)
router = APIRouter(tags=["generate"])

SYSTEM = """You are an expert multi-agent system architect.
Convert a workflow description into a JSON graph of agents and connections.
Respond with ONLY valid JSON — no markdown fences, no explanation."""

def build_prompt(description: str) -> str:
    return f"""Design a multi-agent workflow for: "{description}"

Return this exact JSON structure:
{{
  "name": "Short workflow name (max 5 words)",
  "description": "One sentence description",
  "complexity": "simple|medium|complex",
  "agents": [
    {{
      "id": "1",
      "name": "Agent Name",
      "role": "orchestrator",
      "prompt": "Concise 2-3 sentence action-oriented system prompt. Mention what to read from state[] and what to write.",
      "description": "One line role description"
    }}
  ],
  "connections": [
    {{ "from": "1", "to": "2", "label": "" }}
  ]
}}

Rules:
- 3 to 5 agents only
- First agent: role "orchestrator", last agent: role "reviewer"
- Middle agents: "researcher", "coder", or "custom"
- Prompts must be SHORT and ACTION-ORIENTED
- Orchestrator prompt MUST include the user goal: "{description}"
- Do NOT add loopback connections unless iteration is explicitly needed"""


class GenerateRequest(BaseModel):
    description: str


@router.post("/generate-workflow", summary="Generate workflow graph from natural language")
async def generate_workflow(body: GenerateRequest):
    if not body.description.strip():
        raise HTTPException(status_code=422, detail="Description cannot be empty")

    try:
        resp = await llm_router.generate(
            prompt=build_prompt(body.description),
            model="claude-sonnet-4-5",
            params=GenerateParams(system=SYSTEM, temperature=0.2, max_tokens=2048),
        )

        # Parse JSON from response
        raw = resp.content.strip()
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            raw = m.group(0)

        parsed = json.loads(raw)
        return {"raw": parsed, "model": resp.model, "tokens": resp.usage.total_tokens}

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"LLM returned invalid JSON: {e}")
    except Exception as e:
        logger.exception("generate-workflow failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
