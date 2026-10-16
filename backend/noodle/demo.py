"""Pre-generated AI data (no live model calls in this build).

.noodle/demo/ai.json   {"files": {"<path>": {"tag": "...", "topics": [...]}}, "topics": {"<topic>": "<one line>"}}
.noodle/demo/qa.json   {"course": "...", "questions": [{"q": "...", "aliases": [...], "kind": "answer"|"not_found",
                         "answer": "markdown with [1] markers", "citations": [{"path": "...", "page": N, "label": "..."}],
                         "closest_query": "..."}]}

Both were written by the build session reading the real course files, so citations open real pages.
Tags fall back to filename rules for anything the data doesn't cover.
"""

import difflib
import json
import re

from .paths import DEMO_DIR

TAGS = ["lecture", "tutorial", "past paper", "assignment", "reading", "other"]
RULES = [
    ("past paper", r"exam|past paper|mock|\bpaper 20\d\d"),
    ("assignment", r"assignment|coursework|\(brief\)|submission|report"),
    ("tutorial", r"tutorial|problem|worksheet|exercise|solution|sheet|example"),
    ("lecture", r"lecture|slides|delivered|topic \d"),
    ("reading", r"reading|chapter|textbook|handout|notes|tables|data book|formula"),
]

_cache = {}


def _load(name):
    path = DEMO_DIR / name
    mtime = path.stat().st_mtime if path.exists() else None
    if name not in _cache or _cache[name][0] != mtime:
        _cache[name] = (mtime, json.loads(path.read_text(encoding="utf-8")) if mtime else {})
    return _cache[name][1]


def ai():
    return _load("ai.json")


def qa():
    return _load("qa.json")


def tag_for(path, name, kind):
    entry = ai().get("files", {}).get(path)
    if entry and entry.get("tag") in TAGS:
        return entry["tag"]
    if kind not in ("pdf", "office", "media"):
        return "other"
    low = name.lower()
    for tag, pattern in RULES:
        if re.search(pattern, low):
            return tag
    return "other"


def topics_for(path):
    return (ai().get("files", {}).get(path) or {}).get("topics", [])


def _norm(text):
    return " ".join(re.findall(r"[a-z0-9]+", (text or "").lower()))


def match_question(question):
    """The demo question this matches (typed exactly or close to it), or None."""
    q = _norm(question)
    best, best_score = None, 0.0
    for item in qa().get("questions", []):
        for variant in [item["q"], *item.get("aliases", [])]:
            score = difflib.SequenceMatcher(None, q, _norm(variant)).ratio()
            if score > best_score:
                best, best_score = item, score
    return best if best_score >= 0.8 else None
