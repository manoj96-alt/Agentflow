"""
WorkflowSeeder
==============
Seeds the database with prebuilt workflow templates on startup.

Design:
  - Idempotent: checks for existing workflows by name before inserting
  - Uses a dedicated DB session (not request-scoped)
  - Logs what was seeded vs what already existed
  - Called from the FastAPI lifespan hook after db_connect()

Usage (automatic):
    Called from main.py lifespan — nothing to configure.

Usage (manual / one-shot):
    python -m app.workflows.seeder
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.workflow_orm import WorkflowORM
from app.repositories.workflow_repository import workflow_repo
from app.workflows.prebuilt import PREBUILT_TEMPLATES, WorkflowCreate

logger = logging.getLogger(__name__)


class WorkflowSeeder:

    async def seed(self, db: AsyncSession) -> dict[str, list[str]]:
        """
        Seed all prebuilt templates into the database.

        Returns a report dict with keys 'created' and 'skipped'
        containing workflow names.
        """
        report: dict[str, list[str]] = {"created": [], "skipped": []}

        for template in PREBUILT_TEMPLATES:
            existing = await self._find_by_name(db, template.name)
            if existing:
                logger.info("Seeder: skipping '%s' (already exists id=%s)", template.name, existing.id)
                report["skipped"].append(template.name)
            else:
                workflow = await workflow_repo.create(db, template)
                await db.commit()
                logger.info("Seeder: created '%s' id=%s", workflow.name, workflow.id)
                report["created"].append(workflow.name)

        return report

    @staticmethod
    async def _find_by_name(db: AsyncSession, name: str) -> WorkflowORM | None:
        result = await db.execute(
            select(WorkflowORM).where(WorkflowORM.name == name).limit(1)
        )
        return result.scalar_one_or_none()


workflow_seeder = WorkflowSeeder()


# ─── Standalone entry point ───────────────────────────────────────────────────

async def run_seed() -> None:
    """Run the seeder once using its own DB session."""
    import asyncio
    from app.core.database import connect, disconnect

    logging.basicConfig(level=logging.INFO)
    await connect()
    async with AsyncSessionLocal() as db:
        report = await workflow_seeder.seed(db)
    await disconnect()
    print(f"Seeder complete — created: {report['created']}, skipped: {report['skipped']}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(run_seed())
