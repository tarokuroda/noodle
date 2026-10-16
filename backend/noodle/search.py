"""Local hybrid search: FTS5 keywords + embedding cosine (on the laptop), fused by reciprocal rank.

    python -m noodle.search "how do jet engines produce thrust"
"""

import re
import sys

import numpy as np

from .db import connect
from .index import get_model

_vectors = {}  # course_id -> (keys [(file_id, page)], matrix)


def invalidate():
    _vectors.clear()


def _matrix(course_id):
    if course_id not in _vectors:
        rows = connect().execute(
            "SELECT e.file_id, e.page, e.vec FROM embeddings e JOIN files f ON f.id=e.file_id WHERE f.course_id=?",
            (course_id,)).fetchall()
        keys = [(r["file_id"], r["page"]) for r in rows]
        mat = np.vstack([np.frombuffer(r["vec"], dtype=np.float32) for r in rows]) if rows else np.zeros((0, 384))
        if len(mat):
            mat = mat / np.linalg.norm(mat, axis=1, keepdims=True)
        _vectors[course_id] = (keys, mat)
    return _vectors[course_id]


def _fts_query(q):
    words = [w for w in re.findall(r"\w+", q.lower()) if len(w) > 1]
    return " OR ".join(f'"{w}"*' for w in words)


def keyword_hits(q, course_id, limit=200):
    fq = _fts_query(q)
    if not fq:
        return []
    rows = connect().execute(
        "SELECT t.file_id, t.page, snippet(pages_fts, 0, '<<', '>>', '…', 14) AS snip FROM pages_fts t "
        "JOIN files f ON f.id=t.file_id WHERE pages_fts MATCH ? AND f.course_id=? ORDER BY bm25(pages_fts) LIMIT ?",
        (fq, course_id, limit)).fetchall()
    return [((r["file_id"], r["page"]), r["snip"]) for r in rows]


def meaning_hits(q, course_id, limit=200):
    model = get_model()
    keys, mat = _matrix(course_id)
    if model is None or not len(keys):
        return []
    qv = np.asarray(next(iter(model.query_embed([q]))), dtype=np.float32)
    sims = mat @ (qv / np.linalg.norm(qv))
    top = np.argsort(-sims)[:limit]
    return [(keys[i], float(sims[i])) for i in top]


def search(q, course_id, limit=12):
    """Ranked files, each with its best page and a snippet."""
    q = (q or "").strip()
    if not q:
        return []
    kw, mn = keyword_hits(q, course_id, 80), meaning_hits(q, course_id, 60)
    score, how, snips = {}, {}, {}
    for rank, (key, snip) in enumerate(kw):
        score[key] = score.get(key, 0) + 1 / (60 + rank)
        how.setdefault(key, set()).add("keyword")
        snips[key] = snip
    for rank, (key, _sim) in enumerate(mn):
        score[key] = score.get(key, 0) + 1 / (60 + rank)
        how.setdefault(key, set()).add("meaning")

    best, extra = {}, {}  # file_id -> [score, page, matched, snippet]
    for (fid, page), s in sorted(score.items(), key=lambda kv: -kv[1]):
        if fid not in best:
            best[fid] = [s, page, how[(fid, page)], snips.get((fid, page))]
        elif extra.get(fid, 0) < 2:  # a little credit for a couple of other matching pages, not long files
            extra[fid] = extra.get(fid, 0) + 1
            best[fid][0] += s * 0.15
    ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:limit]
    if not ranked:
        return []

    conn = connect()
    out = []
    for fid, (s, page, matched, snip) in ranked:
        f = conn.execute("SELECT id, name, path, kind, section FROM files WHERE id=?", (fid,)).fetchone()
        if snip is None:
            text = conn.execute("SELECT text FROM pages WHERE file_id=? AND page=?", (fid, page)).fetchone()
            snip = re.sub(r"\s+", " ", text["text"] if text else "")[:180]
        out.append({"file_id": fid, "name": f["name"], "path": f["path"], "kind": f["kind"], "section": f["section"],
                    "page": page, "snippet": re.sub(r"\s+", " ", snip).strip(), "score": round(s, 4),
                    "matched": sorted(matched)})
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(errors="replace")
    course = connect().execute("SELECT id FROM courses ORDER BY synced_at DESC").fetchone()["id"]
    for hit in search(" ".join(sys.argv[1:]), course):
        print(f"{hit['score']:.4f} {'+'.join(hit['matched']):<15} p.{hit['page']:<3} {hit['name']}  | {hit['snippet'][:90]}")
