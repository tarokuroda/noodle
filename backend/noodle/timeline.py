"""Timeline preview: the course in date order, from real data (week titles, activity dates, announcements)."""

import html
import json
import re
from collections import Counter
from datetime import datetime

from . import demo
from .db import connect
from .paths import ROOT

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DAY_MONTH = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})")


def _start_year(shortname):
    m = re.search(r"_(\d{2})-\d{2}$", shortname)
    return 2000 + int(m.group(1)) if m else datetime.now().year


def _date_in(title, start_year):
    for day, month in DAY_MONTH.findall(title or ""):
        mon = MONTHS.get(month[:3].lower())
        if mon:
            year = start_year if mon >= 8 else start_year + 1
            try:
                return datetime(year, mon, int(day))
            except ValueError:
                return None
    return None


def build(course_id):
    conn = connect()
    course = conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    start = _start_year(course["shortname"])
    files = conn.execute("SELECT * FROM files WHERE course_id=? ORDER BY section_num, ord", (course_id,)).fetchall()
    items, sections = [], {}
    for f in files:
        sections.setdefault(f["section_num"], {"title": f["section"], "tags": Counter(), "files": []})
        s = sections[f["section_num"]]
        tag = demo.tag_for(f["path"], f["name"], f["kind"])
        if tag != "other":
            s["tags"][tag] += 1
            s["files"].append({"id": f["id"], "name": f["name"], "tag": tag})
        if f["section"] == "Announcements":
            m = re.match(r"(\d{4}-\d{2}-\d{2}) (.*)", f["name"])
            if m:
                raw = (ROOT / f["path"]).read_text(encoding="utf-8", errors="replace")
                full = re.search(r"<title>(.*?)</title>", raw, re.S)
                title = html.unescape(full.group(1)).strip() if full else m.group(2)
                items.append({"kind": "announcement", "date": m.group(1), "title": title, "file_id": f["id"]})
    for num, s in sections.items():
        when = _date_in(s["title"], start)
        if when:
            items.append({"kind": "week", "date": when.strftime("%Y-%m-%d"), "title": s["title"],
                          "tags": dict(s["tags"]), "files": s["files"][:6]})
    dates_file = ROOT / course["dir"] / "_dates.json"
    if dates_file.exists():
        for e in json.loads(dates_file.read_text(encoding="utf-8")):
            for d in e["dates"]:
                items.append({"kind": "deadline" if "due" in (d.get("dataid") or "") or "close" in (d.get("dataid") or "") else "date",
                              "date": d["when"][:10], "time": d["when"][11:], "title": e["name"],
                              "label": d["label"].rstrip(":"), "url": e["url"]})
    since = f"{start}-08-01"  # drop leftovers from earlier years of the course
    return sorted((i for i in items if i["date"] >= since), key=lambda i: (i["date"], i["kind"] != "week"))
