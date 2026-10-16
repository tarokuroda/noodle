"""Notes: one Obsidian-compatible Markdown file per note in vault/<course>/Notes/.

Links use Obsidian syntax, so the vault opens in Obsidian unchanged:
    [[Lecture 3.pdf]]                     a file (basename when unique, else its path inside the course)
    [[Lecture 3.pdf#page=12|p.12]]        a PDF page
    [[My note]]                           another note
"""

import re
import time
from pathlib import Path

from fastapi import HTTPException

from .db import connect
from .paths import NOTES_DIRNAME, ROOT

WIKILINK = re.compile(r"\[\[([^\[\]|#]+)(?:#([^\[\]|]*))?(?:\|([^\[\]]*))?\]\]")


def course_row(course_id):
    row = connect().execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "That course isn't synced.")
    return row


def notes_dir(course_id):
    return ROOT / course_row(course_id)["dir"] / NOTES_DIRNAME


def list_notes(course_id):
    d = notes_dir(course_id)
    if not d.exists():
        return []
    notes = [{"path": p.relative_to(ROOT).as_posix(), "title": p.stem, "mtime": p.stat().st_mtime}
             for p in d.glob("*.md")]
    return sorted(notes, key=lambda n: -n["mtime"])


def note_path(rel):
    """A note path from the client, checked to be a .md inside some course's Notes folder."""
    p = (ROOT / rel).resolve()
    if p.suffix != ".md" or p.parent.name != NOTES_DIRNAME or ROOT.resolve() not in p.parents:
        raise HTTPException(400, "That isn't a note.")
    return p


def safe_title(title):
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f#^\[\]]', " ", title or "").strip().rstrip(". ")
    return re.sub(r"\s+", " ", title)[:80] or "Untitled"


def create_note(course_id, title, body=""):
    d = notes_dir(course_id)
    d.mkdir(parents=True, exist_ok=True)
    base = safe_title(title)
    p, n = d / f"{base}.md", 2
    while p.exists():
        p, n = d / f"{base} {n}.md", n + 1
    p.write_text(body or f"# {p.stem}\n\n", encoding="utf-8")
    return p


def links(text):
    return [(m.group(1).strip(), m.group(2), m.group(3)) for m in WIKILINK.finditer(text or "")]


def link_targets(course_id):
    """Everything a [[link]] can point at, with the text to insert."""
    c = course_row(course_id)
    prefix = c["dir"] + "/"
    rows = connect().execute("SELECT id, path, name, kind FROM files WHERE course_id=? AND status='ok' "
                             "ORDER BY section_num, ord", (course_id,)).fetchall()
    base_count = {}
    for r in rows:
        base = Path(r["path"]).name
        base_count[base] = base_count.get(base, 0) + 1
    out = []
    for r in rows:
        base = Path(r["path"]).name
        link = base if base_count[base] == 1 else r["path"][len(prefix):]
        out.append({"type": "file", "id": r["id"], "name": r["name"], "kind": r["kind"], "link": link})
    for n in list_notes(course_id):
        out.append({"type": "note", "path": n["path"], "name": n["title"], "kind": "note", "link": n["title"]})
    return out


def resolve(target, course_id, targets=None):
    """('file', id) | ('note', path) | None for a [[target]]."""
    targets = targets if targets is not None else link_targets(course_id)
    t = target.strip().lower()
    for cand in targets:  # exact link text first
        if cand["link"].lower() == t:
            return (cand["type"], cand.get("id") or cand.get("path"))
    for cand in targets:  # then by name or file stem, Obsidian-style
        names = {cand["name"].lower(), Path(cand["link"]).stem.lower(), Path(cand["link"]).name.lower()}
        if t in names or Path(t).name in names:
            return (cand["type"], cand.get("id") or cand.get("path"))
    return None


def append_quote(course_id, file_row, page, text):
    """A highlight lands in that file's note as a quote with a p.N link back to the page."""
    title = f"Notes on {Path(file_row['path']).stem}"
    d = notes_dir(course_id)
    p = d / f"{safe_title(title)}.md"
    link = next((t["link"] for t in link_targets(course_id) if t.get("id") == file_row["id"]), Path(file_row["path"]).name)
    if not p.exists():
        d.mkdir(parents=True, exist_ok=True)
        p.write_text(f"# {title}\n\nSource: [[{link}]]\n\n", encoding="utf-8")
    quote = "\n".join(f"> {line}" for line in text.strip().splitlines() or [""])
    block = f"{quote}\n> — [[{link}#page={page}|p.{page}]]\n\n"
    existing = p.read_text(encoding="utf-8")
    p.write_text(existing.rstrip("\n") + "\n\n" + block, encoding="utf-8")
    return p, time.time()
