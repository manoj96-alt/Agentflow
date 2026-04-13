"""
Test Suite System
=================
Store and run multiple test cases per workflow.
Includes basic hallucination detection heuristics.

Endpoints:
  POST /api/test-suites/                    — create a test suite
  GET  /api/test-suites/                    — list all suites
  GET  /api/test-suites/{id}               — get suite + results
  POST /api/test-suites/{id}/run           — run all test cases
  POST /api/test-suites/{id}/cases         — add a test case
  GET  /api/hallucination/check            — check text for hallucination signals
"""
from __future__ import annotations

import re
import uuid
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(tags=["testing"])

# ── In-memory stores ──────────────────────────────────────────────────────────
_suites: dict[str, dict] = {}

# ── Schemas ───────────────────────────────────────────────────────────────────

class Assertion(BaseModel):
    key:      str
    operator: str  # == != > < >= <= contains exists
    expected: Any

class TestCase(BaseModel):
    name:        str
    inputs:      dict[str, Any] = Field(default_factory=dict)
    assertions:  list[Assertion] = Field(default_factory=list)
    description: str = ""

class TestSuiteCreate(BaseModel):
    name:        str
    workflow_id: str
    description: str = ""
    cases:       list[TestCase] = Field(default_factory=list)

class HallucinationCheckRequest(BaseModel):
    text: str
    context: str = ""  # source context to check against

# ── Hallucination detection ───────────────────────────────────────────────────

# Signals that correlate with confabulation
_CONFIDENCE_HEDGES  = re.compile(r'\b(I think|I believe|probably|likely|might|perhaps|possibly|around|approximately|circa|roughly|seemingly|it seems|as far as I know|to my knowledge|I\'m not sure|I\'m fairly certain)\b', re.I)
_NUMERIC_CLAIMS     = re.compile(r'\b\d+[\.,]?\d*\s*(percent|%|million|billion|thousand|people|users|dollars|\$|km|miles)\b', re.I)
_DATE_CLAIMS        = re.compile(r'\b(in \d{4}|on [A-Z][a-z]+ \d+|January|February|March|April|May|June|July|August|September|October|November|December)\b')
_NAMED_ENTITY_DENSE = re.compile(r'[A-Z][a-z]+ [A-Z][a-z]+')
_INTERNAL_CONTRADICT= re.compile(r'\b(however|but|although|conversely|on the other hand|yet|despite)\b', re.I)

def detect_hallucination_signals(text: str, context: str = "") -> dict:
    """
    Heuristic hallucination detection.
    Returns a risk score 0-100 and list of signals found.

    NOT a guarantee — this is a basic heuristic, not ML-based.
    """
    signals: list[dict] = []
    score = 0

    # Hedge phrases (uncertainty markers = possible confabulation)
    hedges = _CONFIDENCE_HEDGES.findall(text)
    if hedges:
        signals.append({"type": "uncertainty_markers", "count": len(hedges), "examples": hedges[:3]})
        score += min(len(hedges) * 5, 20)

    # Numeric claims (easy to fabricate)
    nums = _NUMERIC_CLAIMS.findall(text)
    if nums:
        signals.append({"type": "numeric_claims", "count": len(nums), "examples": nums[:3]})
        score += min(len(nums) * 4, 15)

    # Date claims
    dates = _DATE_CLAIMS.findall(text)
    if dates:
        signals.append({"type": "date_claims", "count": len(dates)})
        score += min(len(dates) * 3, 10)

    # Named entities (could be fabricated)
    entities = _NAMED_ENTITY_DENSE.findall(text)
    if len(entities) > 5:
        signals.append({"type": "high_named_entity_density", "count": len(entities)})
        score += min((len(entities) - 5) * 2, 15)

    # Internal contradictions
    contradictions = _INTERNAL_CONTRADICT.findall(text)
    if len(contradictions) > 3:
        signals.append({"type": "possible_contradictions", "count": len(contradictions)})
        score += min(len(contradictions) * 3, 15)

    # Response length vs context (very long response from short context = suspicious)
    if context and len(text) > len(context) * 5:
        signals.append({"type": "disproportionate_length", "ratio": round(len(text)/max(len(context),1), 1)})
        score += 10

    # Context contradiction check (simple keyword overlap)
    if context:
        context_words = set(re.findall(r'\b\w{5,}\b', context.lower()))
        response_words = set(re.findall(r'\b\w{5,}\b', text.lower()))
        overlap = len(context_words & response_words)
        if context_words and overlap / len(context_words) < 0.1:
            signals.append({"type": "low_context_overlap", "overlap_pct": round(overlap/len(context_words)*100, 1)})
            score += 15

    risk_level = "low" if score < 20 else "medium" if score < 50 else "high"
    return {
        "score":      min(score, 100),
        "risk_level": risk_level,
        "signals":    signals,
        "word_count": len(text.split()),
        "checked_at": datetime.utcnow().isoformat(),
    }

# ── Assertion evaluator ───────────────────────────────────────────────────────

def _eval_assertion(assertion: Assertion, state: dict) -> dict:
    actual = state.get(assertion.key)
    passed = False
    try:
        op = assertion.operator
        exp = assertion.expected
        if op == "==":       passed = actual == exp
        elif op == "!=":     passed = actual != exp
        elif op == ">":      passed = float(actual) > float(exp)
        elif op == "<":      passed = float(actual) < float(exp)
        elif op == ">=":     passed = float(actual) >= float(exp)
        elif op == "<=":     passed = float(actual) <= float(exp)
        elif op == "contains": passed = str(exp).lower() in str(actual).lower()
        elif op == "exists": passed = actual is not None
    except Exception as e:
        return {"key": assertion.key, "passed": False, "actual": actual, "expected": assertion.expected, "error": str(e)}

    return {
        "key":      assertion.key,
        "passed":   passed,
        "actual":   actual,
        "expected": assertion.expected,
        "operator": assertion.operator,
        "message":  f"✓ {assertion.key} {assertion.operator} {assertion.expected}" if passed
                    else f"✕ Expected {assertion.key} {assertion.operator} {assertion.expected}, got {actual}",
    }

# ── Endpoints ─────────────────────────────────────────────────────────────────

test_suite_router = APIRouter(prefix="/test-suites", tags=["testing"])

@test_suite_router.post("/", summary="Create a test suite with multiple test cases")
async def create_suite(body: TestSuiteCreate):
    suite_id = str(uuid.uuid4())
    _suites[suite_id] = {
        "suite_id":    suite_id,
        "name":        body.name,
        "workflow_id": body.workflow_id,
        "description": body.description,
        "cases":       [c.model_dump() for c in body.cases],
        "results":     [],
        "created_at":  datetime.utcnow().isoformat(),
        "last_run":    None,
    }
    return {"suite_id": suite_id, "name": body.name, "case_count": len(body.cases)}

@test_suite_router.get("/", summary="List test suites")
async def list_suites():
    return {"suites": [{"suite_id": s["suite_id"], "name": s["name"], "workflow_id": s["workflow_id"], "case_count": len(s["cases"]), "last_run": s["last_run"]} for s in _suites.values()]}

@test_suite_router.get("/{suite_id}", summary="Get test suite with results")
async def get_suite(suite_id: str):
    s = _suites.get(suite_id)
    if not s:
        raise HTTPException(status_code=404, detail="Suite not found")
    return s

@test_suite_router.post("/{suite_id}/cases", summary="Add a test case to a suite")
async def add_case(suite_id: str, body: TestCase):
    s = _suites.get(suite_id)
    if not s:
        raise HTTPException(status_code=404, detail="Suite not found")
    s["cases"].append(body.model_dump())
    return {"added": True, "case_count": len(s["cases"])}

@test_suite_router.post("/{suite_id}/run", summary="Run all test cases in a suite")
async def run_suite(suite_id: str):
    """
    Runs every test case in the suite against the linked workflow.
    Returns pass/fail per case with assertion-level detail.

    Note: This calls POST /api/execute/workflow/{workflow_id} for each case.
    """
    s = _suites.get(suite_id)
    if not s:
        raise HTTPException(status_code=404, detail="Suite not found")

    results = []
    pass_count = 0

    import httpx
    async with httpx.AsyncClient(timeout=120) as client:
        for case in s["cases"]:
            case_result: dict[str, Any] = {
                "case_name":   case["name"],
                "started_at":  datetime.utcnow().isoformat(),
                "assertions":  [],
                "passed":      False,
                "final_state": {},
            }
            try:
                res = await client.post(
                    f"http://localhost:8000/api/execute/workflow/{s['workflow_id']}",
                    json={"initial_state": case.get("inputs", {}), "max_iterations": 3},
                    timeout=60,
                )
                if res.status_code == 200:
                    data = res.json()
                    final_state = data.get("execution", {}).get("final_state", {})
                    case_result["final_state"] = final_state

                    # Evaluate assertions
                    assertion_results = [_eval_assertion(Assertion(**a), final_state) for a in case.get("assertions", [])]
                    case_result["assertions"] = assertion_results
                    case_result["passed"]     = all(a["passed"] for a in assertion_results)
                    case_result["pass_count"] = sum(1 for a in assertion_results if a["passed"])
                    case_result["fail_count"] = sum(1 for a in assertion_results if not a["passed"])
                else:
                    case_result["error"] = f"Workflow execution failed: {res.status_code}"
            except Exception as e:
                case_result["error"] = str(e)

            case_result["completed_at"] = datetime.utcnow().isoformat()
            if case_result["passed"]:
                pass_count += 1
            results.append(case_result)

    suite_result = {
        "suite_id":    suite_id,
        "run_id":      str(uuid.uuid4()),
        "total_cases": len(s["cases"]),
        "pass_count":  pass_count,
        "fail_count":  len(s["cases"]) - pass_count,
        "pass_rate":   round(pass_count / max(len(s["cases"]), 1) * 100, 1),
        "cases":       results,
        "ran_at":      datetime.utcnow().isoformat(),
    }

    s["results"].append(suite_result)
    s["last_run"] = suite_result["ran_at"]
    return suite_result


# ── Hallucination check endpoint ──────────────────────────────────────────────

hallucination_router = APIRouter(prefix="/hallucination", tags=["testing"])

@hallucination_router.post("/check", summary="Check text for hallucination signals (heuristic)")
async def check_hallucination(body: HallucinationCheckRequest):
    """
    Runs heuristic hallucination detection on a piece of text.

    Returns:
    - risk_level: low | medium | high
    - score: 0-100
    - signals: list of detected signals with types and counts

    **This is a heuristic, not ML-based.** Use as a first-pass filter.
    """
    return detect_hallucination_signals(body.text, body.context)
