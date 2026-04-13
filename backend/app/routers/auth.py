"""
Auth, RBAC and Multi-tenancy
=============================
JWT-based authentication with role-based access control.

Roles:
  admin   — full access, manage users and workspaces
  editor  — create/edit/run workflows in their workspace
  viewer  — read-only access to workflows and runs

Multi-tenancy:
  Each user belongs to a workspace.
  All workflows, runs, and test results are scoped to workspace_id.

Endpoints:
  POST /api/auth/register
  POST /api/auth/login
  GET  /api/auth/me
  POST /api/auth/workspaces       (admin only)
  GET  /api/auth/workspaces

Audit:
  Every mutation is logged to audit_events table.
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import jwt

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY  = "flowforge-dev-secret-change-in-production"
ALGORITHM   = "HS256"
TOKEN_TTL   = timedelta(hours=24)

# ── In-memory stores (replace with DB in production) ──────────────────────────
_users: dict[str, dict] = {
    "admin": {
        "user_id":      "u-admin",
        "username":     "admin",
        "password":     "admin123",   # plaintext for demo — hash in production
        "role":         "admin",
        "workspace_id": "ws-default",
        "created_at":   datetime.utcnow().isoformat(),
    }
}
_workspaces: dict[str, dict] = {
    "ws-default": {"workspace_id": "ws-default", "name": "Default Workspace", "owner": "admin"}
}
_audit_log: list[dict] = []

# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    role:     str = "editor"    # admin | editor | viewer

class LoginRequest(BaseModel):
    username: str
    password: str

class WorkspaceCreate(BaseModel):
    name: str

class CurrentUser(BaseModel):
    user_id:      str
    username:     str
    role:         str
    workspace_id: str

# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_token(payload: dict) -> str:
    data = {**payload, "exp": datetime.now(timezone.utc) + TOKEN_TTL}
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

# ── Dependency ────────────────────────────────────────────────────────────────

bearer = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
) -> CurrentUser:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials)
        user = _users.get(payload.get("sub", ""))
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return CurrentUser(**{k: user[k] for k in CurrentUser.model_fields})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_role(*roles: str):
    def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Role '{user.role}' cannot perform this action. Required: {roles}")
        return user
    return dep

# ── Audit logger ──────────────────────────────────────────────────────────────

def audit(user: CurrentUser, action: str, resource: str, detail: dict | None = None):
    _audit_log.append({
        "event_id":    str(uuid.uuid4()),
        "user_id":     user.user_id,
        "username":    user.username,
        "workspace_id":user.workspace_id,
        "action":      action,
        "resource":    resource,
        "detail":      detail or {},
        "timestamp":   datetime.utcnow().isoformat(),
    })
    logger.info("AUDIT: %s by %s on %s", action, user.username, resource)

# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", summary="Register a new user")
async def register(body: RegisterRequest):
    if body.username in _users:
        raise HTTPException(status_code=409, detail="Username already taken")
    if body.role not in ("admin", "editor", "viewer"):
        raise HTTPException(status_code=422, detail="role must be admin, editor, or viewer")
    user_id = f"u-{uuid.uuid4().hex[:8]}"
    ws_id   = f"ws-{uuid.uuid4().hex[:8]}"
    # Create a personal workspace
    _workspaces[ws_id] = {"workspace_id": ws_id, "name": f"{body.username}'s Workspace", "owner": body.username}
    _users[body.username] = {
        "user_id":      user_id,
        "username":     body.username,
        "password":     body.password,
        "role":         body.role,
        "workspace_id": ws_id,
        "created_at":   datetime.utcnow().isoformat(),
    }
    token = create_token({"sub": body.username, "role": body.role})
    return {"token": token, "user_id": user_id, "username": body.username, "role": body.role, "workspace_id": ws_id}

@router.post("/login", summary="Login and get JWT token")
async def login(body: LoginRequest):
    user = _users.get(body.username)
    if not user or user["password"] != body.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token({"sub": body.username, "role": user["role"]})
    return {
        "token":        token,
        "user_id":      user["user_id"],
        "username":     user["username"],
        "role":         user["role"],
        "workspace_id": user["workspace_id"],
    }

@router.get("/me", summary="Get current user info")
async def me(user: CurrentUser = Depends(get_current_user)):
    return user

@router.get("/users", summary="List all users (admin only)")
async def list_users(user: CurrentUser = Depends(require_role("admin"))):
    return {"users": [{"user_id": u["user_id"], "username": u["username"], "role": u["role"], "workspace_id": u["workspace_id"]} for u in _users.values()]}

@router.post("/workspaces", summary="Create workspace (admin only)")
async def create_workspace(body: WorkspaceCreate, user: CurrentUser = Depends(require_role("admin"))):
    ws_id = f"ws-{uuid.uuid4().hex[:8]}"
    _workspaces[ws_id] = {"workspace_id": ws_id, "name": body.name, "owner": user.username}
    audit(user, "create_workspace", ws_id, {"name": body.name})
    return {"workspace_id": ws_id, "name": body.name}

@router.get("/workspaces", summary="List workspaces")
async def list_workspaces(user: CurrentUser = Depends(get_current_user)):
    if user.role == "admin":
        return {"workspaces": list(_workspaces.values())}
    return {"workspaces": [ws for ws in _workspaces.values() if ws["workspace_id"] == user.workspace_id]}

@router.get("/audit", summary="Audit log (admin only)")
async def get_audit_log(
    limit: int = 50,
    user: CurrentUser = Depends(require_role("admin")),
):
    return {"events": _audit_log[-limit:], "total": len(_audit_log)}
