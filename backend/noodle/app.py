"""Noodle's local API. Run from the repo root:

    python -m uvicorn noodle.app:app --app-dir backend --port 8765
"""

import os
import re

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from . import demo
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
    return [dict(r) for r in rows]


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
