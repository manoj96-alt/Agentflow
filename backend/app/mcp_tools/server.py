"""
FlowForge MCP Tool Server — 5 tools
api_call, api_fetch, db_query, sql_query, db_list_tables
"""
from __future__ import annotations
import asyncio, json, logging, re, time
from datetime import datetime
from typing import Any
import aiosqlite, httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

logger = logging.getLogger(__name__)
server = Server("flowforge-tools")
DB_PATH = ":memory:"
_db_conn: aiosqlite.Connection | None = None

async def get_db() -> aiosqlite.Connection:
    global _db_conn
    if _db_conn is None:
        _db_conn = await aiosqlite.connect(DB_PATH)
        await _db_conn.execute("PRAGMA journal_mode=WAL")
        await _seed_db(_db_conn)
    return _db_conn

async def _seed_db(conn):
    await conn.executescript("""
        CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT,role TEXT,model TEXT,active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,flow_id TEXT,status TEXT,created_at TEXT);
        CREATE TABLE IF NOT EXISTS run_events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,agent_id TEXT,event TEXT,ts TEXT);
        CREATE TABLE IF NOT EXISTS tool_execution_log(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,agent_id TEXT,tool_name TEXT,arguments TEXT,success INTEGER,output TEXT,error TEXT,duration_ms REAL,ts TEXT);
        INSERT OR IGNORE INTO agents VALUES('a1','Orchestrator','orchestrator','claude-sonnet-4-5',1),('a2','Researcher','researcher','claude-sonnet-4-5',1),('a3','Coder','coder','claude-sonnet-4-5',1),('a4','Reviewer','reviewer','claude-haiku-4-5',1);
        INSERT OR IGNORE INTO runs VALUES('r1','flow-001','completed','2025-01-01T10:00:00'),('r2','flow-001','running','2025-01-02T09:00:00'),('r3','flow-002','failed','2025-01-02T11:00:00');
        INSERT OR IGNORE INTO run_events(run_id,agent_id,event,ts) VALUES('r1','a1','started','2025-01-01T10:00:00'),('r1','a2','tool_called','2025-01-01T10:01:00'),('r1','a3','tool_called','2025-01-01T10:02:00'),('r1','a4','completed','2025-01-01T10:03:00');
    """)
    await conn.commit()

@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(name="api_call",
            description="HTTP GET/POST/PUT/PATCH/DELETE to any URL. Returns status, headers, body.",
            inputSchema={"type":"object","required":["url"],"properties":{
                "url":{"type":"string"},"method":{"type":"string","enum":["GET","POST","PUT","PATCH","DELETE"],"default":"GET"},
                "headers":{"type":"object","additionalProperties":{"type":"string"}},
                "body":{"type":"object"},"timeout_seconds":{"type":"number","default":10}}}),
        types.Tool(name="api_fetch",
            description="Simple HTTP GET → returns parsed JSON. Ideal for REST APIs. Supports query params.",
            inputSchema={"type":"object","required":["url"],"properties":{
                "url":{"type":"string"},"headers":{"type":"object","additionalProperties":{"type":"string"}},
                "params":{"type":"object","additionalProperties":{}}}}),
        types.Tool(name="db_query",
            description="Read-only SQL SELECT on FlowForge DB. Tables: agents, runs, run_events, tool_execution_log.",
            inputSchema={"type":"object","required":["sql"],"properties":{
                "sql":{"type":"string"},"params":{"type":"array","items":{}},"limit":{"type":"integer","default":100}}}),
        types.Tool(name="sql_query",
            description="SQL SELECT with named :param placeholders. Returns rows with column metadata.",
            inputSchema={"type":"object","required":["sql"],"properties":{
                "sql":{"type":"string","description":"SQL with :placeholder syntax"},
                "params":{"type":"object","additionalProperties":{}},"limit":{"type":"integer","default":100}}}),
        types.Tool(name="file_tool",
            description=(
                "Read, write, list or check existence of files on the server filesystem. "
                "Supports .txt, .md, .json, .csv, .yaml, .py, .js, .ts files. "
                "Operations: read, write, list (directory), exists."
            ),
            inputSchema={"type":"object","required":["operation","path"],"properties":{
                "operation":{"type":"string","enum":["read","write","list","exists"],"description":"File operation to perform"},
                "path":{"type":"string","description":"File or directory path"},
                "content":{"type":"string","description":"Content to write (for write operation only)"},
            }}),
        types.Tool(name="db_list_tables",
            description="List all tables and column schemas. Use for discovery before writing queries.",
            inputSchema={"type":"object","properties":{"table":{"type":"string","description":"Optional single table name"}}}),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
    t0 = time.perf_counter()
    handlers = {"api_call":_api_call,"api_fetch":_api_fetch,"db_query":_db_query,"sql_query":_sql_query,"db_list_tables":_db_list_tables,"file_tool":_file_tool}
    if name not in handlers:
        raise ValueError(f"Unknown tool: {name!r}")
    result = await handlers[name](arguments)
    elapsed = (time.perf_counter() - t0) * 1000
    try:
        db = await get_db()
        out = result[0].text if result else ""
        ok = 0 if "error" in json.loads(out) else 1
        await db.execute("INSERT INTO tool_execution_log(tool_name,arguments,success,output,duration_ms,ts) VALUES(?,?,?,?,?,?)",
            (name, json.dumps(arguments), ok, out[:2000], round(elapsed,2), datetime.utcnow().isoformat()))
        await db.commit()
    except Exception: pass
    return result

async def _api_call(args):
    url=args["url"]; method=args.get("method","GET").upper()
    headers=args.get("headers",{}); body=args.get("body"); timeout=min(float(args.get("timeout_seconds",10)),30)
    try:
        async with httpx.AsyncClient(timeout=timeout,follow_redirects=True) as c:
            r = await c.request(method=method,url=url,headers=headers,json=body)
        try: rb=r.json()
        except: rb=r.text[:2000]
        res={"status_code":r.status_code,"headers":dict(r.headers),"body":rb,"url":str(r.url),"elapsed_ms":round(r.elapsed.total_seconds()*1000,1)}
    except httpx.TimeoutException: res={"error":"timeout","url":url}
    except Exception as e: res={"error":str(e),"url":url}
    return [types.TextContent(type="text",text=json.dumps(res,indent=2))]

async def _api_fetch(args):
    url=args["url"]; headers=args.get("headers",{}); params=args.get("params",{})
    try:
        async with httpx.AsyncClient(timeout=15,follow_redirects=True) as c:
            r = await c.get(url,headers=headers,params=params)
        try: data=r.json()
        except: data=r.text[:2000]
        res={"data":data,"status_code":r.status_code,"url":str(r.url)}
    except Exception as e: res={"error":str(e),"url":url}
    return [types.TextContent(type="text",text=json.dumps(res,indent=2))]

async def _db_query(args):
    sql=args["sql"].strip(); params=args.get("params",[]); limit=min(int(args.get("limit",100)),500)
    if not sql.upper().startswith("SELECT"):
        return [types.TextContent(type="text",text=json.dumps({"error":"Only SELECT permitted"}))]
    if "LIMIT" not in sql.upper(): sql=f"{sql} LIMIT {limit}"
    try:
        db=await get_db()
        async with db.execute(sql,params) as cur:
            cols=[d[0] for d in cur.description] if cur.description else []
            rows=await cur.fetchall()
        res={"columns":cols,"rows":[dict(zip(cols,r)) for r in rows],"row_count":len(rows),"sql":sql}
    except Exception as e: res={"error":str(e),"sql":sql}
    return [types.TextContent(type="text",text=json.dumps(res,indent=2))]

async def _sql_query(args):
    sql=args["sql"].strip(); params=args.get("params",{}); limit=min(int(args.get("limit",100)),500)
    if not sql.upper().startswith("SELECT"):
        return [types.TextContent(type="text",text=json.dumps({"error":"Only SELECT permitted"}))]
    names=re.findall(r":(\w+)",sql); pos=[params.get(p) for p in names]
    sql_pos=re.sub(r":\w+","?",sql)
    if "LIMIT" not in sql_pos.upper(): sql_pos=f"{sql_pos} LIMIT {limit}"
    try:
        db=await get_db()
        async with db.execute(sql_pos,pos) as cur:
            cols=[d[0] for d in cur.description] if cur.description else []
            ctypes=[str(d[1] or "TEXT") for d in cur.description] if cur.description else []
            rows=await cur.fetchall()
        res={"columns":[{"name":c,"type":t} for c,t in zip(cols,ctypes)],"rows":[dict(zip(cols,r)) for r in rows],"row_count":len(rows),"sql":sql,"params_used":params}
    except Exception as e: res={"error":str(e),"sql":sql}
    return [types.TextContent(type="text",text=json.dumps(res,indent=2))]

async def _db_list_tables(args):
    single=args.get("table")
    try:
        db=await get_db()
        if single:
            async with db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",(single,)) as c:
                row=await c.fetchone()
            tables={single:row[0] if row else None}
        else:
            async with db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") as c:
                names=[r[0] for r in await c.fetchall()]
            tables={}
            for n in names:
                async with db.execute(f"PRAGMA table_info({n})") as c:
                    cols=await c.fetchall()
                tables[n]=[{"name":c[1],"type":c[2],"notnull":bool(c[3]),"pk":bool(c[5])} for c in cols]
        res={"tables":tables,"count":len(tables)}
    except Exception as e: res={"error":str(e)}
    return [types.TextContent(type="text",text=json.dumps(res,indent=2))]

async def main():
    logging.basicConfig(level=logging.INFO)
    await get_db()
    async with stdio_server() as (r,w):
        await server.run(r,w,server.create_initialization_options())

if __name__=="__main__":
    asyncio.run(main())


# ─── File tool ────────────────────────────────────────────────────────────────

import os
import base64
import pathlib

_ALLOWED_EXTENSIONS = {'.txt', '.md', '.json', '.csv', '.yaml', '.yml', '.log', '.py', '.js', '.ts'}
_MAX_FILE_SIZE = 1024 * 512   # 512 KB read limit


async def _file_tool(args: dict[str, Any]) -> list[types.TextContent]:
    operation = args.get("operation", "read")
    path_str  = args.get("path", "")

    if not path_str:
        return [types.TextContent(type="text", text=json.dumps({"error": "path is required"}))]

    p = pathlib.Path(path_str).resolve()

    # Safety: only allow files within the current working directory or /tmp
    cwd = pathlib.Path.cwd()
    try:
        p.relative_to(cwd)
    except ValueError:
        if not str(p).startswith("/tmp"):
            return [types.TextContent(type="text", text=json.dumps({"error": f"Access denied: {path_str}"}))]

    if operation == "read":
        try:
            if p.stat().st_size > _MAX_FILE_SIZE:
                return [types.TextContent(type="text", text=json.dumps({"error": f"File too large (max 512KB): {p.stat().st_size} bytes"}))]
            content = p.read_text(encoding="utf-8", errors="replace")
            return [types.TextContent(type="text", text=json.dumps({
                "path": str(p), "content": content,
                "size_bytes": p.stat().st_size, "extension": p.suffix,
            }))]
        except FileNotFoundError:
            return [types.TextContent(type="text", text=json.dumps({"error": f"File not found: {path_str}"}))]
        except Exception as e:
            return [types.TextContent(type="text", text=json.dumps({"error": str(e)}))]

    elif operation == "write":
        content = args.get("content", "")
        if p.suffix not in _ALLOWED_EXTENSIONS:
            return [types.TextContent(type="text", text=json.dumps({"error": f"Extension {p.suffix} not allowed for writing"}))]
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
            return [types.TextContent(type="text", text=json.dumps({"path": str(p), "bytes_written": len(content.encode()), "success": True}))]
        except Exception as e:
            return [types.TextContent(type="text", text=json.dumps({"error": str(e)}))]

    elif operation == "list":
        try:
            if not p.is_dir():
                return [types.TextContent(type="text", text=json.dumps({"error": f"Not a directory: {path_str}"}))]
            entries = []
            for child in sorted(p.iterdir())[:100]:
                entries.append({
                    "name": child.name, "type": "dir" if child.is_dir() else "file",
                    "size": child.stat().st_size if child.is_file() else None,
                    "extension": child.suffix if child.is_file() else None,
                })
            return [types.TextContent(type="text", text=json.dumps({"path": str(p), "entries": entries, "count": len(entries)}))]
        except Exception as e:
            return [types.TextContent(type="text", text=json.dumps({"error": str(e)}))]

    elif operation == "exists":
        return [types.TextContent(type="text", text=json.dumps({"path": str(p), "exists": p.exists(), "is_file": p.is_file(), "is_dir": p.is_dir()}))]

    return [types.TextContent(type="text", text=json.dumps({"error": f"Unknown operation: {operation}"}))]
