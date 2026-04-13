# Contributing to AgentFlow

Thank you for your interest in contributing! This guide covers everything you need to get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)

---

## Code of Conduct

Be respectful, constructive, and welcoming. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## How to Contribute

### Good first issues
Look for issues labelled `good first issue` — these are self-contained and well-scoped for new contributors.

### Ways to help
- **Bug fixes** — open an issue first if the fix is non-trivial
- **Documentation** — improve README, add inline comments, fix typos
- **New templates** — add to `frontend/src/utils/templates.ts`
- **New MCP tools** — add to `backend/app/mcp_tools/server.py`
- **Tests** — we need both backend (pytest) and frontend (Vitest) coverage
- **UI polish** — improve CSS variables, accessibility, responsive layout

---

## Development Setup

### Prerequisites
- Python 3.11 or 3.12
- Node.js 18+ and npm
- PostgreSQL 14+
- Redis 6+

### 1. Fork and clone
```bash
git clone https://github.com/YOUR_USERNAME/agentflow.git
cd agentflow
```

### 2. Backend
```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in .env with your API keys and database credentials

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
npm install

cp .env.example .env
# Set VITE_API_BASE_URL=http://localhost:8000

npm run dev
```

Open http://localhost:5173.

---

## Project Structure

```
agentflow/
├── backend/
│   ├── app/
│   │   ├── core/           # MCP client, tool registry, database
│   │   ├── llm/            # LLM router, provider adapters
│   │   ├── mcp_tools/      # Built-in MCP server (6 tools)
│   │   ├── plugins/        # Plugin system (agent/tool/connector)
│   │   ├── routers/        # FastAPI route handlers
│   │   ├── services/       # Business logic (optimizer, tool selector)
│   │   └── workflows/      # Prebuilt workflow definitions
│   ├── alembic/            # Database migrations
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/          # useAgentFlow — central state hook
│   │   ├── utils/          # Execution engine, planner, templates, API client
│   │   └── types/          # TypeScript type definitions
│   ├── .env.example
│   └── package.json
│
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Code Style

### Backend (Python)
- Follow PEP 8
- Use type hints on all function signatures
- Async functions for all I/O operations
- Docstrings on public functions and classes
- Keep routers thin — business logic belongs in `services/`

### Frontend (TypeScript / React)
- Functional components only (no class components except ErrorBoundary)
- All colors via CSS variables — no hardcoded hex
- All backend calls through `src/utils/api.ts` — no raw `fetch('localhost...')`
- Props interfaces defined in the same file or `types/index.ts`
- No default exports except for page-level components

### Commit messages
Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add file_tool MCP integration
fix: CORS missing port 5173
docs: add deployment guide to README
refactor: extract LogDetail from ExecutionPanel
test: add pytest cases for auth endpoints
```

---

## Submitting a Pull Request

1. Create a branch: `git checkout -b feat/your-feature-name`
2. Make your changes and commit with conventional commit messages
3. Run the checks:
   ```bash
   # Backend
   cd backend && python -m pytest tests/ -v

   # Frontend
   cd frontend && npm run lint && npm run build
   ```
4. Push and open a PR against `main`
5. Fill in the PR template — describe what changed and why
6. Request a review

### PR checklist
- [ ] No `.env` files committed
- [ ] No hardcoded `localhost:8000` URLs in frontend
- [ ] New features have at least one test
- [ ] `requirements.txt` updated if new Python deps added
- [ ] `package.json` updated if new npm packages added

---

## Reporting Bugs

Open a GitHub Issue with:
- **Steps to reproduce** — exact steps from a clean state
- **Expected behavior** — what should happen
- **Actual behavior** — what actually happens
- **Environment** — OS, Python version, Node version, browser
- **Logs** — backend terminal output and browser console errors

---

## Questions?

Open a GitHub Discussion or start a thread in the Issues section.
