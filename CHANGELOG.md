# Changelog

All notable changes to AgentFlow are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2025

### Added

#### Core Canvas
- React Flow canvas with drag-and-drop agent placement
- 8 agent roles: orchestrator, planner, worker, evaluator, researcher, coder, reviewer, custom
- Inline node editing — click any text to edit without a modal
- Role icon cycling — click the icon badge to cycle through roles
- Conditional edge editor — double-click any edge to add a JS expression condition
- Loopback edge support with amber dashed styling and ↺ indicator
- QuickAdd bar — floating + Add Agent button with role picker

#### AI Workflow Builder
- Natural language workflow generation via Claude (POST /api/generate-workflow)
- 6 suggestion chips covering common enterprise patterns
- 6 prebuilt templates: PDF Summarizer, Reasoning Loop, API Analyzer, Supplier Risk, Code Review, Research Report
- Auto layout engine using dependency-based tree positioning
- Smart defaults: Opus for reviewers, Sonnet for coders, Haiku for simple tasks

#### Execution Engine
- Real LLM calls to Anthropic and OpenAI per agent node
- Parallel execution using Kahn's topological algorithm + asyncio.gather
- `## STATE_UPDATES` protocol for structured agent-to-state communication
- DFS back-edge detection for cycle identification
- Max iteration limit per loopback edge (default: 5)
- Conditional routing evaluated against live shared FlowState
- Test mode: seed inputs, evaluate assertions, no results saved

#### Planner Mode (Dynamic Execution)
- Planner agent generates a JSON execution plan at runtime
- Worker agents execute in dependency order (parallel where deps allow)
- Evaluator validates outputs and triggers revision loop if score < 75
- Typed message passing between agents: instruction / result / question / feedback
- PlannerModePanel with Execution Plan and Agent Messages tabs

#### MCP Tool Integration
- Built-in MCP server with 6 tools: api_call, api_fetch, db_query, sql_query, file_tool, db_list_tables
- Dynamic MCP server registration via POST /api/mcp/servers/ (no code changes needed)
- LLM-powered tool selection per agent (claude-haiku picks the best tool for each task)
- Tool Registry UI with server tabs, category filter, live test, and attach/detach
- file_tool: read, write, list, exists operations with safety restrictions

#### Observability
- Step-by-step execution log panel with input/prompt/output/state tabs per step
- Execution Replay: step through with node highlighting and timeline scrubbing
- Metrics Dashboard: timing bars, model usage breakdown, estimated cost, routing stats
- Live State Viewer: grouped state tree with diff highlighting (NEW badges on changed keys)

#### Testing Framework
- Test Run panel: inject test inputs, define assertions, see expected vs actual
- 8 assertion operators: ==, !=, >, <, >=, <=, contains, exists
- Multi-test-case suites via POST /api/test-suites/ with per-case pass/fail detail
- Hallucination detection heuristic: uncertainty markers, numeric claims, entity density, context overlap

#### Agent Optimizer (Self-Improving Agents)
- Per-agent performance tracking: success rate, error rate, avg latency, tool hit rate
- LLM analysis (claude-haiku) generates: prompt improvements, model recommendation, priority
- OptimizerPanel with 8 metric tiles, one-click model apply, prompt suggestion copy

#### Plugin System
- AgentPlugin, ToolPlugin, ConnectorPlugin abstract base classes
- Plugin registry with dynamic registration at import time
- 3 built-in plugins: SummarizerAgent, EchoTool, WebhookConnector
- REST API: list, execute, call plugins by type

#### Marketplace
- MarketplacePanel: browse templates and saved workflows
- Import workflow from JSON paste
- Export any saved workflow as .json download

#### Backend & Infrastructure
- FastAPI backend with PostgreSQL (SQLAlchemy async) and Redis
- Alembic migrations for workflows and execution_runs tables
- JWT authentication with bcrypt password hashing
- RBAC: admin, editor, viewer roles
- Multi-tenancy: workspaces scoped per user
- Audit log for all mutating operations
- Webhook and API triggers for event-driven execution
- Swagger UI at /api/docs (auto-generated)
- Headless execution: POST /api/execute/workflow/{id}

#### Developer Experience
- React ErrorBoundary — friendly error screen instead of blank crash
- CSS variable system — full light theme via :root tokens
- TypeScript strict mode enabled
- .env.example files for both frontend and backend
- Comprehensive .gitignore
- VITE_API_BASE_URL — no hardcoded localhost URLs

---

## Roadmap

### [1.1.0] — Planned
- [ ] Auth middleware on all protected routes
- [ ] Workspace-scoped workflow isolation
- [ ] PostgreSQL storage for users, triggers, and test suites (currently in-memory)
- [ ] Frontend `api.ts` client used everywhere (replace remaining fetch calls)
- [ ] Docker Compose for one-command local setup

### [1.2.0] — Planned
- [ ] Python SDK for headless workflow execution
- [ ] GitHub Actions CI with pytest and Vitest
- [ ] Dark/light theme toggle
- [ ] Collaborative real-time editing (WebSocket)
- [ ] Versioned workflow snapshots
