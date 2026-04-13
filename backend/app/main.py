from __future__ import annotations
import os, sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import redis as redis_store
from app.core.database import connect as db_connect, disconnect as db_disconnect
from app.workflows.seeder import workflow_seeder
from app.core.database import AsyncSessionLocal
from app.core.mcp_client import mcp_pool, StdioServerConfig
from app.routers import flows, agents, runs, mcp, llm, workflows, execution, execution_runs, optimizer_plugins, generate, mcp_servers, auth, triggers, test_suites, copilot, tool_recommendations


@asynccontextmanager
async def lifespan(app: FastAPI):
    await redis_store.connect()
    await db_connect()
    # Seed prebuilt templates (idempotent)
    async with AsyncSessionLocal() as _seed_db:
        _seed_report = await workflow_seeder.seed(_seed_db)
        if _seed_report["created"]:
            import logging; logging.getLogger(__name__).info("Seeded workflows: %s", _seed_report["created"])
    mcp_pool.register("flowforge", StdioServerConfig(
        command=sys.executable,
        args=["-m", "app.mcp_tools.server"],
        env={**os.environ},
    ))
    yield
    await redis_store.disconnect()
    await db_disconnect()


app = FastAPI(
    title="FlowForge API",
    description=(
        "Multi-agent workflow builder — Redis state + MCP tools + LLM abstraction.\n\n"
        "**LLM layer:** `POST /api/llm/generate` · `POST /api/llm/generate/select` · `GET /api/llm/models`\n\n"
        "**Agents:** `POST /api/mcp/agents/{id}/execute`\n\n"
        "**Run state:** `POST /api/runs/{id}/state/read` · `POST /api/runs/{id}/state/write`"
    ),
    version="6.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        os.getenv("FRONTEND_URL", ""),
    ],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

app.include_router(flows.router,  prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(runs.router,   prefix="/api")
app.include_router(mcp.router,    prefix="/api")
app.include_router(llm.router,    prefix="/api")
app.include_router(workflows.router, prefix="/api")
app.include_router(execution.router,  prefix="/api")
app.include_router(execution_runs.router, prefix="/api")
app.include_router(optimizer_plugins.optimizer_router, prefix="/api")
app.include_router(optimizer_plugins.plugin_router,    prefix="/api")
app.include_router(generate.router,                    prefix="/api")
app.include_router(mcp_servers.router,                prefix="/api")
app.include_router(auth.router,                        prefix="/api")
app.include_router(triggers.router,                    prefix="/api")
app.include_router(test_suites.test_suite_router,      prefix="/api")
app.include_router(test_suites.hallucination_router,   prefix="/api")
app.include_router(copilot.router,                     prefix="/api")
app.include_router(tool_recommendations.router,       prefix="/api")


@app.get("/api/health", tags=["meta"])
async def health_check():
    return {
        "status": "ok",
        "service": "FlowForge API",
        "version": "6.0.0",
        "redis": "live" if redis_store.is_redis_live() else "fallback (in-memory)",
        "mcp_servers": mcp_pool.list_servers(),
    }
