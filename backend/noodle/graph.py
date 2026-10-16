"""The course graph: files (coloured by tag), notes and AI topics shared by 2+ files.

Edges: course structure (files chained in page order within a section), [[links]] in notes, file -> topic.
Without AI topics (no .noodle/demo/ai.json) each file links to the files most like it instead, by the local
embeddings, and the app gathers files around their course section. Highlights are not nodes. One course at a
time keeps it readable.
"""

from collections import defaultdict

import numpy as np

from . import demo, notes, search
from .db import connect
from .index import viewer_for
from .paths import ROOT

MAX_TOPICS_PER_FILE = 8
SIMILAR_PER_FILE = 3  # without AI topics, link each file to this many of its closest files...
SIMILAR_MIN = 0.8  # ...when they're at least this close (cosine of the files' mean page embeddings)


def similar_links(course_id, rows):
    """file <-> file edges by meaning. Files only look among files, so hiding Moodle pages doesn't strand them."""
    keys, mat = search._matrix(course_id)
    pages = defaultdict(list)
    for (fid, _page), vec in zip(keys, mat):
        pages[fid].append(vec)
    rows = [r for r in rows if r["id"] in pages]
    if len(rows) < 3:
        return []
    vecs = np.vstack([np.mean(pages[r["id"]], axis=0) for r in rows])
    vecs /= np.maximum(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-9)
    sims = vecs @ vecs.T
    np.fill_diagonal(sims, -1)
    is_page = np.array([r["kind"] == "page" for r in rows])
    pairs = set()
    for a in range(len(rows)):
        cand = sims[a] if is_page[a] else np.where(is_page, -1, sims[a])
        for b in np.argsort(-cand)[:SIMILAR_PER_FILE]:
            if cand[b] >= SIMILAR_MIN:
                pairs.add((min(a, b), max(a, b)))
    return [{"source": f"f{rows[a]['id']}", "target": f"f{rows[b]['id']}", "kind": "similar"} for a, b in sorted(pairs)]


def build(course_id):
    rows = connect().execute("SELECT * FROM files WHERE course_id=? AND twin_id IS NULL ORDER BY section_num, ord",
                             (course_id,)).fetchall()
    nodes, links = [], []
    topic_files = defaultdict(list)
    prev_in_section = {}
    for r in rows:
        nid = f"f{r['id']}"
        nodes.append({"id": nid, "type": "file", "label": r["name"], "file_id": r["id"], "kind": r["kind"],
                      "viewer": viewer_for(r),
                      "tag": demo.tag_for(r["path"], r["name"], r["kind"]), "status": r["status"],
                      "section": r["section"], "section_num": r["section_num"]})
        prev = prev_in_section.get(r["section_num"])
        if prev:
            links.append({"source": prev, "target": nid, "kind": "structure"})
        prev_in_section[r["section_num"]] = nid
        for t in demo.topics_for(r["path"])[:MAX_TOPICS_PER_FILE]:
            topic_files[t].append(nid)

    summaries = demo.ai().get("topics", {})
    for topic, fids in topic_files.items():
        if len(fids) < 2:  # prune: only topics that connect files
            continue
        tid = f"t:{topic}"
        nodes.append({"id": tid, "type": "topic", "label": topic, "summary": summaries.get(topic, ""),
                      "count": len(fids)})
        links += [{"source": fid, "target": tid, "kind": "topic"} for fid in fids]
    if not any(n["type"] == "topic" for n in nodes):
        links += similar_links(course_id, rows)

    targets = notes.link_targets(course_id)
    for n in notes.list_notes(course_id):
        nid = f"n:{n['path']}"
        nodes.append({"id": nid, "type": "note", "label": n["title"], "path": n["path"]})
        text = (ROOT / n["path"]).read_text(encoding="utf-8", errors="replace")
        seen = set()
        for target, _anchor, _alias in notes.links(text):
            hit = notes.resolve(target, course_id, targets)
            if not hit:
                continue
            other = f"f{hit[1]}" if hit[0] == "file" else f"n:{hit[1]}"
            if other != nid and other not in seen:
                seen.add(other)
                links.append({"source": nid, "target": other, "kind": "link"})
    return {"nodes": nodes, "links": links}
