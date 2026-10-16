"""The course graph: files (coloured by tag), notes and AI topics shared by 2+ files.

Edges: course structure (files chained in page order within a section), [[links]] in notes, file -> topic.
Sections are a colour/filter, not nodes; highlights are not nodes. One course at a time keeps it readable.
"""

from collections import defaultdict

from . import demo, notes
from .db import connect
from .index import viewer_for
from .paths import ROOT

MAX_TOPICS_PER_FILE = 8


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
