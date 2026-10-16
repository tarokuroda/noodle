"""Noodle's local API. Run from the repo root:

    python -m uvicorn noodle.app:app --app-dir backend --port 8765
"""

import json
import os
import re
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse, HTMLResponse

from . import account, demo, graph, notes, timeline
from .db import connect
from .paths import ROOT
from .search import search as run_search

app = FastAPI(title="Noodle")

PAGE_STYLE = """<base target="_blank"><style>
body{font-family:"Segoe UI",system-ui,sans-serif;color:#1E2235;max-width:72ch;margin:32px auto;padding:0 28px;
line-height:1.65;font-size:16px}h1{font-size:1.7em;line-height:1.2;margin:.2em 0 .8em}h2,h3{line-height:1.3}
a{color:#4F5BD5}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #E3E6EF;padding:6px 10px}
</style>"""


def file_row(fid):
    row = connect().execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
    if row is None:
        raise HTTPException(404, "That file isn't in the library.")
    return row


def file_out(row):
    d = dict(row)
    d.pop("indexed_mtime", None)
    d.pop("url", None)  # Moodle file URLs are only used by the sync
    d["tag"] = demo.tag_for(row["path"], row["name"], row["kind"])
    return d


@app.get("/api/courses")
def courses():
    rows = connect().execute(
        "SELECT c.id, c.shortname, c.fullname, c.dir, c.synced_at, "
        "(SELECT COUNT(*) FROM files f WHERE f.course_id=c.id) AS files, "
        "(SELECT COUNT(*) FROM pages p JOIN files f ON f.id=p.file_id WHERE f.course_id=c.id) AS pages "
        "FROM courses c ORDER BY c.shortname").fetchall()
    picked = set(account.config().get("courses") or [])
    return [dict(r) for r in rows if not picked or r["id"] in picked]


@app.get("/api/files")
def files(course: int):
    rows = connect().execute("SELECT * FROM files WHERE course_id=? ORDER BY section_num, ord", (course,)).fetchall()
    return [file_out(r) for r in rows]


@app.get("/api/files/{fid}")
def file_info(fid: int):
    return file_out(file_row(fid))


@app.get("/api/files/{fid}/raw")
def file_raw(fid: int):
    row = file_row(fid)
    path = ROOT / row["path"]
    if row["status"] != "ok" or not path.exists():
        raise HTTPException(404, "This file isn't on your laptop. Open it in Moodle instead.")
    return FileResponse(path)


@app.get("/api/files/{fid}/html", response_class=HTMLResponse)
def file_html(fid: int):
    row = file_row(fid)
    raw = (ROOT / row["path"]).read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<script[^>]*>.*?</script>", "", raw)
    raw = re.sub(r"(?is)\son\w+\s*=\s*(\"[^\"]*\"|'[^']*')", "", raw)
    return HTMLResponse(PAGE_STYLE + raw, headers={"Content-Security-Policy": "script-src 'none'"})


@app.post("/api/files/{fid}/open")
def file_open(fid: int):
    """Slides and Word docs open in their default Windows app."""
    row = file_row(fid)
    path = ROOT / row["path"]
    if row["status"] != "ok" or not path.exists():
        raise HTTPException(404, "This file isn't on your laptop. Open it in Moodle instead.")
    os.startfile(path)  # noqa: S606 - local app, the user's own file
    return {"ok": True}


@app.get("/api/search")
def search(q: str, course: int):
    return run_search(q, course)


# ---------- Ask (pre-generated answers in this build; retrieval is live) ----------

class AskIn(BaseModel):
    q: str
    course: int


def _hit(h):
    return {k: h[k] for k in ("file_id", "name", "kind", "page", "snippet")}


@app.get("/api/ask/suggestions")
def ask_suggestions():
    return [{"q": q["q"], "kind": q["kind"]} for q in demo.qa().get("questions", [])]


@app.post("/api/ask")
def ask(body: AskIn):
    conn = connect()
    course = conn.execute("SELECT shortname FROM courses WHERE id=?", (body.course,)).fetchone()
    name = (course["shortname"] if course else "course").split("_")[0]
    item = demo.match_question(body.q)
    hits = run_search(item.get("search", item["q"]) if item else body.q, body.course)
    out = {"q": body.q, "course": name, "retrieved": [_hit(h) for h in hits[:5]], "suggestions": ask_suggestions()}
    if item is None:
        return {**out, "kind": "unknown"}
    if item["kind"] == "not_found":
        return {**out, "kind": "not_found", "closest": [_hit(h) for h in hits[:4]]}
    citations = []
    for n, cite in enumerate(item["citations"], 1):
        row = conn.execute("SELECT id FROM files WHERE path=?", (cite["path"],)).fetchone()
        if row:
            citations.append({"n": n, "file_id": row["id"], "page": cite["page"], "label": cite["label"]})
    return {**out, "kind": "answer", "answer": item["answer"], "citations": citations}


# ---------- graph + notes ----------

@app.get("/api/graph")
def course_graph(course: int):
    return graph.build(course)


@app.get("/api/notes")
def notes_list(course: int):
    return notes.list_notes(course)


@app.get("/api/linktargets")
def link_targets(course: int):
    return notes.link_targets(course)


@app.get("/api/resolve")
def resolve_link(course: int, target: str):
    hit = notes.resolve(target, course)
    if not hit:
        raise HTTPException(404, f"Nothing called “{target}” in this course.")
    return {"type": hit[0], "id": hit[1] if hit[0] == "file" else None, "path": hit[1] if hit[0] == "note" else None}


class NoteIn(BaseModel):
    course: int
    title: str = "Untitled"
    body: str = ""


class NoteSave(BaseModel):
    path: str
    content: str


@app.post("/api/notes")
def note_create(body: NoteIn):
    p = notes.create_note(body.course, body.title, body.body)
    return {"path": p.relative_to(ROOT).as_posix(), "title": p.stem}


@app.get("/api/note")
def note_read(path: str):
    p = notes.note_path(path)
    if not p.exists():
        raise HTTPException(404, "That note doesn't exist any more.")
    return {"path": path, "title": p.stem, "content": p.read_text(encoding="utf-8")}


@app.put("/api/note")
def note_save(body: NoteSave):
    p = notes.note_path(body.path)
    p.write_text(body.content, encoding="utf-8")
    return {"ok": True}


# ---------- highlights ----------

class HighlightIn(BaseModel):
    file_id: int
    page: int
    rects: list[dict]
    text: str


def _highlight_out(r):
    return {"id": r["id"], "page": r["page"], "rects": json.loads(r["rects"]), "text": r["text"], "note_path": r["note_path"]}


@app.get("/api/highlights")
def highlights(file: int):
    rows = connect().execute("SELECT * FROM highlights WHERE file_id=? ORDER BY id", (file,)).fetchall()
    return [_highlight_out(r) for r in rows]


@app.post("/api/highlights")
def add_highlight(body: HighlightIn):
    row = file_row(body.file_id)
    note = notes.append_quote(row["course_id"], row, body.page, body.text)
    rel = note.relative_to(ROOT).as_posix()
    conn = connect()
    cur = conn.execute("INSERT INTO highlights(file_id, file_hash, page, rects, text, note_path, created) VALUES(?,?,?,?,?,?,?)",
                       (row["id"], row["hash"], body.page, json.dumps(body.rects), body.text, rel, time.time()))
    conn.commit()
    hl = conn.execute("SELECT * FROM highlights WHERE id=?", (cur.lastrowid,)).fetchone()
    return {"highlight": _highlight_out(hl), "note_path": rel}


@app.get("/api/files/{fid}/note")
def file_note(fid: int, create: bool = False):
    row = file_row(fid)
    p = notes.file_note(row["course_id"], row, create=create)
    return {"path": p.relative_to(ROOT).as_posix() if p else None}


# ---------- login, courses, sync ----------

class SiteIn(BaseModel):
    site: str


class LinkIn(BaseModel):
    link: str


class SyncIn(BaseModel):
    courses: list[int]


@app.get("/api/auth/status")
def auth_status():
    return account.status()


@app.post("/api/auth/start")
def auth_start(body: SiteIn):
    try:
        return account.start_login(body.site)
    except account.MoodleError as e:
        raise HTTPException(400, str(e))


@app.post("/api/auth/paste")
def auth_paste(body: LinkIn):
    try:
        return account.finish_login(body.link)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/moodle/courses")
def moodle_courses():
    synced = {r["id"] for r in connect().execute("SELECT id FROM courses")}
    return [{**c, "synced": c["id"] in synced} for c in account.courses()]


@app.post("/api/sync")
def sync_start(body: SyncIn):
    try:
        return account.start_sync(body.courses)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/sync/status")
def sync_status():
    return dict(account.JOB)


@app.get("/api/timeline")
def course_timeline(course: int):
    return timeline.build(course)


# ---------- the built app (npm run build) on the same port; keep this last so /api routes win ----------
_DIST = ROOT / "frontend" / "dist"
if _DIST.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="app")
