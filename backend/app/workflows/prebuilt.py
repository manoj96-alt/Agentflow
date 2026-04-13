"""
Prebuilt workflow templates
===========================
Three ready-to-use multi-agent workflows:

1. PDF Summarizer          — extract, chunk, summarise, compose
2. Multi-Agent Reasoning   — orchestrated debate loop with reviewer
3. API Data Fetch + Analysis — fetch, validate, analyse, report

Each template is a complete WorkflowCreate payload that can be
POSTed directly to /api/workflows or seeded via the seeder service.
"""

from __future__ import annotations

from app.models.workflow import WorkflowCreate, WorkflowNode, WorkflowEdge, NodePosition


def _node(
    id: str, role: str, name: str, model: str, prompt: str,
    x: float, y: float, description: str = "", temperature: float = 0.5,
    max_tokens: int = 2048,
) -> WorkflowNode:
    return WorkflowNode(
        id=id, type="agent",
        position=NodePosition(x=x, y=y),
        data={
            "agentName": name,
            "role": role,
            "model": model,
            "prompt": prompt,
            "description": description,
            "temperature": temperature,
            "maxTokens": max_tokens,
            "status": "idle",
        },
    )


def _edge(id: str, source: str, target: str, animated: bool = False, label: str = "") -> WorkflowEdge:
    return WorkflowEdge(
        id=id, source=source, target=target,
        animated=animated, label=label or None,
        style={"stroke": "#f59e0b" if label == "loop" else "#6366f1", "strokeWidth": 2},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. PDF SUMMARIZER
# Flow:  Extractor → Chunker → [Summariser×N] → Composer → Reviewer
# ─────────────────────────────────────────────────────────────────────────────

PDF_SUMMARIZER = WorkflowCreate(
    name="PDF Summarizer",
    description=(
        "Extracts text from a PDF, splits it into semantic chunks, "
        "summarises each chunk in parallel, then composes a structured "
        "executive summary with key takeaways reviewed for accuracy."
    ),
    tags=["prebuilt", "pdf", "summarization", "document"],
    max_iterations=3,
    nodes=[
        _node(
            "pdf-extract", "orchestrator", "PDF Extractor",
            model="claude-haiku-4-5",
            prompt=(
                "You are a document extraction specialist.\n\n"
                "Your task:\n"
                "1. Receive a PDF file path or URL from the shared state key `input:pdf_path`.\n"
                "2. Extract all text content, preserving section headings and page numbers.\n"
                "3. Write the extracted text to `extract:raw_text`.\n"
                "4. Write a metadata summary to `extract:metadata` with: "
                "   {page_count, word_count, detected_sections}.\n\n"
                "If no PDF is provided, write a placeholder indicating extraction is pending."
            ),
            x=300, y=40, description="Extracts raw text from PDF",
            temperature=0.1, max_tokens=4096,
        ),
        _node(
            "pdf-chunk", "researcher", "Text Chunker",
            model="claude-haiku-4-5",
            prompt=(
                "You are a text segmentation expert.\n\n"
                "Read `extract:raw_text` from shared state.\n"
                "Split the document into 3–5 coherent semantic sections "
                "(e.g. Introduction, Methods, Results, Discussion, Conclusion).\n\n"
                "Write to shared state:\n"
                "- `chunk:sections` — array of {title, content, word_count}\n"
                "- `chunk:section_count` — number of sections created\n\n"
                "Ensure each section has enough context to be summarised independently."
            ),
            x=300, y=180, description="Splits text into sections",
            temperature=0.2, max_tokens=2048,
        ),
        _node(
            "pdf-summarise-a", "researcher", "Section Summariser A",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a precise summarisation agent.\n\n"
                "Read `chunk:sections` from shared state. "
                "Summarise the FIRST HALF of the sections (by index).\n\n"
                "For each section produce:\n"
                "- A 2–3 sentence summary\n"
                "- 3 bullet-point key facts\n"
                "- A relevance score (1–5)\n\n"
                "Write your summaries to `summary:part_a` as a JSON array of "
                "{section_title, summary, key_facts, relevance_score}."
            ),
            x=100, y=330, description="Summarises first half",
            temperature=0.3, max_tokens=2048,
        ),
        _node(
            "pdf-summarise-b", "researcher", "Section Summariser B",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a precise summarisation agent.\n\n"
                "Read `chunk:sections` from shared state. "
                "Summarise the SECOND HALF of the sections (by index).\n\n"
                "For each section produce:\n"
                "- A 2–3 sentence summary\n"
                "- 3 bullet-point key facts\n"
                "- A relevance score (1–5)\n\n"
                "Write your summaries to `summary:part_b` as a JSON array of "
                "{section_title, summary, key_facts, relevance_score}."
            ),
            x=500, y=330, description="Summarises second half",
            temperature=0.3, max_tokens=2048,
        ),
        _node(
            "pdf-compose", "coder", "Summary Composer",
            model="claude-sonnet-4-5",
            prompt=(
                "You are an executive communication specialist.\n\n"
                "Read `summary:part_a` and `summary:part_b` from shared state.\n"
                "Merge them into a single structured document:\n\n"
                "# Executive Summary\n"
                "## TL;DR (3 sentences)\n"
                "## Key Findings (top 5 bullets)\n"
                "## Section Summaries (one paragraph each)\n"
                "## Recommended Actions\n\n"
                "Write the final document to `compose:executive_summary` as Markdown.\n"
                "Also write `compose:word_count` and `compose:reading_time_minutes`."
            ),
            x=300, y=480, description="Merges into executive summary",
            temperature=0.4, max_tokens=3000,
        ),
        _node(
            "pdf-review", "reviewer", "Quality Reviewer",
            model="claude-opus-4-5",
            prompt=(
                "You are a rigorous editorial reviewer.\n\n"
                "Read `compose:executive_summary` from shared state.\n"
                "Evaluate it across:\n"
                "- Accuracy: are the claims faithful to the source chunks?\n"
                "- Completeness: are key points from all sections represented?\n"
                "- Clarity: is the language clear and professional?\n"
                "- Brevity: is it appropriately concise?\n\n"
                "Write to shared state:\n"
                "- `review:score` — overall quality score 1–10\n"
                "- `review:feedback` — specific actionable feedback\n"
                "- `review:approved` — true/false\n"
                "- `review:final_summary` — the reviewed (and lightly edited) summary"
            ),
            x=300, y=630, description="Reviews and finalises",
            temperature=0.2, max_tokens=3000,
        ),
    ],
    edges=[
        _edge("e-ex-ch",  "pdf-extract",      "pdf-chunk",        animated=True),
        _edge("e-ch-sa",  "pdf-chunk",         "pdf-summarise-a",  animated=True),
        _edge("e-ch-sb",  "pdf-chunk",         "pdf-summarise-b",  animated=True),
        _edge("e-sa-co",  "pdf-summarise-a",   "pdf-compose"),
        _edge("e-sb-co",  "pdf-summarise-b",   "pdf-compose"),
        _edge("e-co-re",  "pdf-compose",       "pdf-review"),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# 2. MULTI-AGENT REASONING LOOP
# Flow:  Orchestrator → [Proposer, Critic] → Synthesiser → Validator
#        Validator loops back to Orchestrator if quality < threshold
# ─────────────────────────────────────────────────────────────────────────────

REASONING_LOOP = WorkflowCreate(
    name="Multi-Agent Reasoning Loop",
    description=(
        "An adversarial reasoning loop where a Proposer generates arguments, "
        "a Critic challenges them, a Synthesiser reconciles the debate, and "
        "a Validator checks quality — looping back to the Orchestrator if "
        "the answer does not meet the quality threshold."
    ),
    tags=["prebuilt", "reasoning", "debate", "loop", "adversarial"],
    max_iterations=5,
    nodes=[
        _node(
            "rl-orchestrator", "orchestrator", "Debate Orchestrator",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a debate orchestrator managing a multi-round reasoning process.\n\n"
                "On first run:\n"
                "1. Read `input:question` from shared state (the question to reason about).\n"
                "2. Write `orchestrator:round` (start at 1, increment each loop).\n"
                "3. Write `orchestrator:goal` — what a satisfactory answer looks like.\n"
                "4. Write `orchestrator:focus` — which aspect to explore this round.\n\n"
                "On subsequent runs (loop), read `validator:feedback` and "
                "`validator:round_score` to set a sharper focus for the next round."
            ),
            x=300, y=40, description="Manages debate rounds",
            temperature=0.4, max_tokens=1024,
        ),
        _node(
            "rl-proposer", "researcher", "Argument Proposer",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a rigorous argument construction specialist.\n\n"
                "Read from shared state:\n"
                "- `input:question` — the question under discussion\n"
                "- `orchestrator:focus` — the current round's focus area\n"
                "- `orchestrator:round` — current round number\n"
                "- `critic:challenges` (if exists) — previous critiques to address\n\n"
                "Construct a well-reasoned position with:\n"
                "- Clear thesis statement\n"
                "- 3 supporting arguments with evidence\n"
                "- Acknowledgement of limitations\n\n"
                "Write to `proposer:position` as structured JSON with "
                "{thesis, arguments[], limitations[], confidence_score}."
            ),
            x=100, y=210, description="Builds the argument",
            temperature=0.6, max_tokens=2048,
        ),
        _node(
            "rl-critic", "reviewer", "Devil's Advocate Critic",
            model="claude-opus-4-5",
            prompt=(
                "You are a critical thinker tasked with finding flaws.\n\n"
                "Read `proposer:position` from shared state.\n\n"
                "Challenge the argument by identifying:\n"
                "- Logical fallacies\n"
                "- Missing evidence or unsupported claims\n"
                "- Alternative interpretations\n"
                "- Edge cases that break the thesis\n\n"
                "Write to `critic:challenges` as JSON with "
                "{fatal_flaws[], weak_points[], alternative_views[], "
                "strongest_counter_argument, challenge_score}.\n\n"
                "Be rigorous but fair — your goal is to make the final answer stronger."
            ),
            x=500, y=210, description="Challenges the argument",
            temperature=0.7, max_tokens=2048,
        ),
        _node(
            "rl-synthesiser", "coder", "Synthesis Agent",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a synthesis expert who resolves intellectual debates.\n\n"
                "Read from shared state:\n"
                "- `proposer:position` — the argument\n"
                "- `critic:challenges` — the critiques\n"
                "- `orchestrator:round` — iteration number\n\n"
                "Produce a synthesis that:\n"
                "1. Takes the strongest elements of the proposal\n"
                "2. Addresses the valid criticisms\n"
                "3. Arrives at a balanced, defensible conclusion\n\n"
                "Write to `synthesiser:conclusion` as JSON with "
                "{conclusion, reasoning_chain[], caveats[], confidence_score, "
                "unresolved_questions[]}."
            ),
            x=300, y=380, description="Reconciles the debate",
            temperature=0.4, max_tokens=2048,
        ),
        _node(
            "rl-validator", "reviewer", "Quality Validator",
            model="claude-opus-4-5",
            prompt=(
                "You are a quality assurance validator for reasoning outputs.\n\n"
                "Read from shared state:\n"
                "- `synthesiser:conclusion` — the synthesised answer\n"
                "- `input:question` — the original question\n"
                "- `orchestrator:goal` — what a good answer looks like\n\n"
                "Score the conclusion on:\n"
                "- Completeness (0–10): does it fully answer the question?\n"
                "- Rigour (0–10): is the reasoning sound?\n"
                "- Actionability (0–10): can someone act on this?\n\n"
                "Write to shared state:\n"
                "- `validator:round_score` — average of three scores\n"
                "- `validator:approved` — true if round_score >= 7.5\n"
                "- `validator:feedback` — specific gaps to address next round\n"
                "- `validator:final_answer` — the approved conclusion (if approved)"
            ),
            x=300, y=540, description="Validates quality (loops if < 7.5)",
            temperature=0.2, max_tokens=2048,
        ),
    ],
    edges=[
        _edge("e-or-pr",  "rl-orchestrator", "rl-proposer",   animated=True),
        _edge("e-or-cr",  "rl-orchestrator", "rl-critic",     animated=True),
        _edge("e-pr-sy",  "rl-proposer",     "rl-synthesiser"),
        _edge("e-cr-sy",  "rl-critic",       "rl-synthesiser"),
        _edge("e-sy-va",  "rl-synthesiser",  "rl-validator"),
        # Loopback — validator → orchestrator for refinement rounds
        _edge("e-va-or",  "rl-validator",    "rl-orchestrator", animated=True, label="loop"),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# 3. API DATA FETCH + ANALYSIS
# Flow:  Planner → Fetcher → Validator → Analyst → [Statistician, Visualiser]
#         → Reporter
# ─────────────────────────────────────────────────────────────────────────────

API_ANALYSIS = WorkflowCreate(
    name="API Data Fetch + Analysis",
    description=(
        "Fetches data from one or more REST APIs, validates schema and quality, "
        "runs statistical analysis in parallel with trend identification, "
        "then composes an actionable data report with findings and recommendations."
    ),
    tags=["prebuilt", "api", "data", "analysis", "reporting"],
    max_iterations=3,
    nodes=[
        _node(
            "api-planner", "orchestrator", "Request Planner",
            model="claude-sonnet-4-5",
            prompt=(
                "You are an API integration planner.\n\n"
                "Read `input:api_target` from shared state (a URL, endpoint spec, or description).\n\n"
                "Plan the data collection strategy:\n"
                "1. Determine required endpoints and HTTP methods\n"
                "2. Identify authentication requirements\n"
                "3. Define expected response schema\n"
                "4. Set quality thresholds for the data\n\n"
                "Write to shared state:\n"
                "- `plan:endpoints` — array of {url, method, headers, params, purpose}\n"
                "- `plan:expected_schema` — JSON schema of expected data shape\n"
                "- `plan:quality_threshold` — minimum acceptable completeness (0–1)\n"
                "- `plan:analysis_goals` — what insights to extract"
            ),
            x=300, y=40, description="Plans API collection strategy",
            temperature=0.3, max_tokens=2048,
        ),
        _node(
            "api-fetcher", "coder", "API Fetcher",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a data fetching specialist with access to the `api_call` MCP tool.\n\n"
                "Read `plan:endpoints` from shared state.\n\n"
                "For each endpoint:\n"
                "1. Call the API using the api_call tool\n"
                "2. Record the response status, headers, and body\n"
                "3. Note any errors or rate-limits encountered\n\n"
                "Write to shared state:\n"
                "- `fetch:responses` — array of {endpoint, status_code, data, error}\n"
                "- `fetch:success_count` — number of successful calls\n"
                "- `fetch:total_records` — total data records retrieved\n"
                "- `fetch:timestamp` — ISO timestamp of collection"
            ),
            x=300, y=190, description="Fetches data from APIs",
            temperature=0.1, max_tokens=4096,
        ),
        _node(
            "api-validator", "reviewer", "Data Validator",
            model="claude-haiku-4-5",
            prompt=(
                "You are a data quality assurance specialist.\n\n"
                "Read from shared state:\n"
                "- `fetch:responses` — raw API responses\n"
                "- `plan:expected_schema` — what the data should look like\n"
                "- `plan:quality_threshold` — minimum acceptable completeness\n\n"
                "Validate:\n"
                "1. Schema conformance: do fields match expected types?\n"
                "2. Completeness: what percentage of expected fields are present?\n"
                "3. Consistency: are there duplicate or conflicting records?\n"
                "4. Range checks: are numeric values within expected bounds?\n\n"
                "Write to shared state:\n"
                "- `validate:clean_data` — validated, deduplicated records\n"
                "- `validate:quality_score` — completeness ratio (0–1)\n"
                "- `validate:issues` — array of data quality issues found\n"
                "- `validate:record_count` — number of valid records"
            ),
            x=300, y=340, description="Validates data quality",
            temperature=0.1, max_tokens=2048,
        ),
        _node(
            "api-analyst", "researcher", "Statistical Analyst",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a quantitative data analyst.\n\n"
                "Read `validate:clean_data` and `plan:analysis_goals` from shared state.\n\n"
                "Perform statistical analysis:\n"
                "1. Descriptive statistics (mean, median, std, min, max)\n"
                "2. Distribution analysis and outlier detection\n"
                "3. Correlation analysis between key variables\n"
                "4. Time series trends if temporal data exists\n\n"
                "Write to shared state:\n"
                "- `analysis:statistics` — descriptive stats per numeric column\n"
                "- `analysis:outliers` — detected anomalies with explanations\n"
                "- `analysis:correlations` — significant correlations (r > 0.5)\n"
                "- `analysis:key_metrics` — top 5 most important numbers"
            ),
            x=100, y=500, description="Statistical analysis",
            temperature=0.2, max_tokens=3000,
        ),
        _node(
            "api-trend", "researcher", "Trend Identifier",
            model="claude-sonnet-4-5",
            prompt=(
                "You are a strategic insights specialist.\n\n"
                "Read `validate:clean_data` and `plan:analysis_goals` from shared state.\n\n"
                "Identify patterns and trends:\n"
                "1. Emerging trends in the data\n"
                "2. Anomalies that deviate from expected patterns\n"
                "3. Seasonality or cyclical patterns\n"
                "4. Leading indicators of future change\n\n"
                "Write to shared state:\n"
                "- `trends:patterns` — array of {pattern, evidence, confidence}\n"
                "- `trends:anomalies` — unexpected findings that warrant attention\n"
                "- `trends:forecast` — short-term outlook based on current trends\n"
                "- `trends:opportunities` — actionable opportunities identified"
            ),
            x=500, y=500, description="Identifies trends and patterns",
            temperature=0.5, max_tokens=3000,
        ),
        _node(
            "api-reporter", "coder", "Report Composer",
            model="claude-opus-4-5",
            prompt=(
                "You are an executive data reporter.\n\n"
                "Read from shared state:\n"
                "- `analysis:statistics` and `analysis:key_metrics`\n"
                "- `trends:patterns`, `trends:anomalies`, `trends:opportunities`\n"
                "- `validate:quality_score` and `validate:issues`\n"
                "- `plan:analysis_goals`\n\n"
                "Compose a structured data report in Markdown:\n\n"
                "# Data Analysis Report\n"
                "## Executive Summary (3 sentences)\n"
                "## Data Quality (score + caveats)\n"
                "## Key Metrics\n"
                "## Statistical Findings\n"
                "## Trend Analysis\n"
                "## Anomalies & Risks\n"
                "## Recommendations (top 3, prioritised)\n"
                "## Appendix: Raw Statistics\n\n"
                "Write the report to `report:markdown`.\n"
                "Write `report:executive_summary` and `report:top_recommendations` separately."
            ),
            x=300, y=660, description="Composes final report",
            temperature=0.4, max_tokens=4096,
        ),
    ],
    edges=[
        _edge("e-pl-fe",  "api-planner",    "api-fetcher",    animated=True),
        _edge("e-fe-va",  "api-fetcher",    "api-validator",  animated=True),
        _edge("e-va-an",  "api-validator",  "api-analyst"),
        _edge("e-va-tr",  "api-validator",  "api-trend"),
        _edge("e-an-re",  "api-analyst",    "api-reporter"),
        _edge("e-tr-re",  "api-trend",      "api-reporter"),
    ],
)


# ── Registry ──────────────────────────────────────────────────────────────────

PREBUILT_TEMPLATES: list[WorkflowCreate] = [
    PDF_SUMMARIZER,
    REASONING_LOOP,
    API_ANALYSIS,
]

TEMPLATE_BY_KEY: dict[str, WorkflowCreate] = {
    "pdf_summarizer":     PDF_SUMMARIZER,
    "reasoning_loop":     REASONING_LOOP,
    "api_analysis":       API_ANALYSIS,
}
