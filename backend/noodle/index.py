"""Build the library index from sync records: file rows, page text (PyMuPDF), FTS5 and local embeddings.

    python -m noodle.index            # (from backend/) re-index every synced course and print counts
"""

import hashlib
import html
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

from .db import connect
from .paths import MODELS_DIR, ROOT

KINDS = {"pdf": "pdf", "html": "page", "htm": "page",
         **{e: "office" for e in ("ppt", "pptx", "doc", "docx", "xls", "xlsx", "odt", "odp")},
         **{e: "media" for e in ("mp4", "mov", "mp3", "m4a", "avi", "mkv", "wav")}}
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_CHARS = 1500

_model = None
_model_error = None


def get_model():
    """The local embedding model, or None if it can't be loaded (then search is keyword-only)."""
    global _model, _model_error
    if _model is None and _model_error is None:
        try:
            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
            os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
            import truststore
            truststore.inject_into_ssl()  # Avast re-signs TLS; the model download needs the Windows trust store
            from fastembed import TextEmbedding
            _model = TextEmbedding(EMBED_MODEL, cache_dir=str(MODELS_DIR))
        except Exception as e:  # noqa: BLE001 - any failure means keyword-only search
            _model_error = f"{type(e).__name__}: {e}"
            print(f"  ! Embedding model unavailable, keyword search only ({_model_error})")
    return _model


def display_name(path):
    p = Path(path)
    if p.name == "_Section overview.html":
        return f"{p.parent.name[3:] or p.parent.name} overview"
    if p.name == "_Brief.html":
        return f"{p.parent.name} (brief)"
    return p.stem if p.suffix.lower() in (".html", ".htm") else p.name


def upsert_course(course, course_dir_rel):
    conn = connect()
    conn.execute("INSERT INTO courses(id, shortname, fullname, dir, synced_at) VALUES(?,?,?,?,?) "
                 "ON CONFLICT(id) DO UPDATE SET shortname=excluded.shortname, fullname=excluded.fullname, "
                 "dir=excluded.dir, synced_at=excluded.synced_at",
                 (course["id"], html.unescape(course["shortname"]), html.unescape(course.get("fullname", "")),
                  course_dir_rel, time.time()))
    conn.commit()


def upsert_records(course_id, records):
    """File rows from one complete sync of a course. Ids stay stable across syncs (highlights point at them)."""
    conn = connect()
    seen = []
    for order, r in enumerate(records):
        ext = Path(r["path"]).suffix.lower().lstrip(".")
        conn.execute(
            "INSERT INTO files(course_id, path, url, name, ext, kind, section_num, section, module, modname, "
            "moodle_url, size, status, ord) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(path) DO UPDATE SET course_id=excluded.course_id, url=excluded.url, name=excluded.name, "
            "ext=excluded.ext, kind=excluded.kind, section_num=excluded.section_num, section=excluded.section, "
            "module=excluded.module, modname=excluded.modname, moodle_url=excluded.moodle_url, "
            "size=excluded.size, status=excluded.status, ord=excluded.ord",
            (course_id, r["path"], r.get("url"), display_name(r["path"]), ext, KINDS.get(ext, "other"),
             r.get("section_num"), r.get("section"), r.get("module"), r.get("modname"), r.get("moodle_url"),
             r.get("size"), r["status"], order))
        seen.append(r["path"])
    if seen:  # files that disappeared from Moodle
        marks = ",".join("?" * len(seen))
        gone = [row[0] for row in conn.execute(
            f"SELECT id FROM files WHERE course_id=? AND path NOT IN ({marks})", (course_id, *seen))]
        for fid in gone:
            drop_text(conn, fid)
            conn.execute("DELETE FROM files WHERE id=?", (fid,))
    conn.commit()


def drop_text(conn, fid):
    conn.execute("DELETE FROM pages WHERE file_id=?", (fid,))
    conn.execute("DELETE FROM pages_fts WHERE file_id=?", (fid,))
    conn.execute("DELETE FROM embeddings WHERE file_id=?", (fid,))


def html_to_text(raw):
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<(br|/p|/div|/li|/h\d|/tr)[^>]*>", "\n", raw)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def extract_pages(path):
    """[(page_number, text)] for a PDF or a Moodle page."""
    if path.suffix.lower() == ".pdf":
        import fitz
        with fitz.open(path) as doc:
            return [(i + 1, page.get_text("text")) for i, page in enumerate(doc)]
    return [(1, html_to_text(path.read_text(encoding="utf-8", errors="replace")))]


def file_hash(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def index_text(course_id=None, log=print, progress=None):
    """Extract text for new/changed PDFs and pages, then embed pages that have no vector yet."""
    conn = connect()
    where = "status='ok' AND kind IN ('pdf','page')" + (" AND course_id=?" if course_id else "")
    rows = conn.execute(f"SELECT id, path, name, indexed_mtime FROM files WHERE {where}",
                        (course_id,) if course_id else ()).fetchall()
    changed = 0
    for n, row in enumerate(rows):
        path = ROOT / row["path"]
        if progress:
            progress("Reading files", n + 1, len(rows))
        if not path.exists():
            continue
        mtime = path.stat().st_mtime
        if row["indexed_mtime"] == mtime:
            continue
        try:
            pages = extract_pages(path)
        except Exception as e:  # noqa: BLE001 - a broken PDF shouldn't stop the index
            log(f"  ! Couldn't read {row['path']}: {e}")
            continue
        drop_text(conn, row["id"])
        conn.executemany("INSERT INTO pages(file_id, page, text) VALUES(?,?,?)",
                         [(row["id"], p, t) for p, t in pages])
        conn.executemany("INSERT INTO pages_fts(text, file_id, page) VALUES(?,?,?)",
                         [(f"{row['name']}\n{t}", row["id"], p) for p, t in pages])
        conn.execute("UPDATE files SET hash=?, pages=?, indexed_mtime=? WHERE id=?",
                     (file_hash(path), len(pages), mtime, row["id"]))
        changed += 1
    conn.commit()
    embedded = embed_missing(course_id, log, progress)
    return {"files": len(rows), "reindexed": changed, "embedded": embedded}


def embed_missing(course_id=None, log=print, progress=None):
    model = get_model()
    if model is None:
        return 0
    conn = connect()
    q = ("SELECT p.file_id, p.page, p.text, f.name FROM pages p JOIN files f ON f.id=p.file_id "
         "LEFT JOIN embeddings e ON e.file_id=p.file_id AND e.page=p.page WHERE e.vec IS NULL"
         + (" AND f.course_id=?" if course_id else ""))
    todo = [r for r in conn.execute(q, (course_id,) if course_id else ()) if len(r["text"].strip()) >= 20]
    batch = 64
    for start in range(0, len(todo), batch):
        chunk = todo[start:start + batch]
        if progress:
            progress("Indexing for search", start + len(chunk), len(todo))
        vecs = list(model.passage_embed([f"{r['name']}\n{r['text'][:EMBED_CHARS]}" for r in chunk]))
        conn.executemany("INSERT OR REPLACE INTO embeddings(file_id, page, vec) VALUES(?,?,?)",
                         [(r["file_id"], r["page"], np.asarray(v, dtype=np.float32).tobytes())
                          for r, v in zip(chunk, vecs)])
        conn.commit()
    from . import search
    search.invalidate()
    return len(todo)


def index_sync(results, log=print, progress=None):
    """After sync_courses(): store the file records of every course that synced, then index its text."""
    from .sync import course_dir
    totals = Counter()
    for cs in results:
        if cs.error:
            continue
        upsert_course(cs.course, course_dir(cs.course).relative_to(ROOT).as_posix())
        upsert_records(cs.course["id"], cs.records)
        totals.update(index_text(cs.course["id"], log, progress))
    return totals


def main():
    sys.stdout.reconfigure(errors="replace")
    t = time.time()
    print(index_text())
    conn = connect()
    for row in conn.execute("SELECT c.shortname, f.kind, f.status, COUNT(*) n FROM files f JOIN courses c "
                            "ON c.id=f.course_id GROUP BY 1,2,3 ORDER BY 1,2,3"):
        print(f"  {row['shortname']:<16} {row['kind']:<7} {row['status']:<8} {row['n']}")
    print(f"  pages: {conn.execute('SELECT COUNT(*) FROM pages').fetchone()[0]}, "
          f"vectors: {conn.execute('SELECT COUNT(*) FROM embeddings').fetchone()[0]}  ({time.time() - t:.1f}s)")


if __name__ == "__main__":
    main()
