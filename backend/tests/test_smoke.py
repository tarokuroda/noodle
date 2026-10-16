"""Backend smoke tests. Run from the repo root: python -m pytest backend/tests -q"""

import base64
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noodle.db import connect  # noqa: E402
from noodle.moodle import clean, mask, normalize_site, parse_app_link  # noqa: E402


def test_clean_makes_safe_windows_names():
    assert clean('a:b/c?"d') == "a_b_c__d"
    assert clean("CON.txt") == "_CON.txt"
    assert clean("trailing dot. ") == "trailing dot"


def test_normalize_site():
    assert normalize_site("moodle.ucl.ac.uk/my/") == "https://moodle.ucl.ac.uk"
    assert normalize_site("https://moodle.ucl.ac.uk/login/index.php?x=1") == "https://moodle.ucl.ac.uk"


def test_parse_app_link_and_mask():
    site, passport, token = "https://moodle.example", "12345", "a" * 32
    sig = hashlib.md5((site + passport).encode()).hexdigest()
    link = "moodlemobile://token=" + base64.b64encode(f"{sig}:::{token}".encode()).decode()
    assert parse_app_link(link, site, passport) == (token, True)
    assert parse_app_link(token, site, passport) == (token, True)
    assert token not in mask(token)


def test_search_finds_course_material():
    from noodle.search import search
    course = connect().execute("SELECT id FROM courses ORDER BY synced_at DESC").fetchone()
    if course is None:
        return  # nothing synced on this machine
    hits = search("nozzle flow", course["id"])
    assert hits and all({"file_id", "page", "name", "snippet"} <= set(h) for h in hits)


def test_wikilinks_parse_and_resolve():
    from noodle import notes
    found = notes.links("See [[Lecture 3.pdf#page=12|p.12]] and [[My note]].")
    assert found == [("Lecture 3.pdf", "page=12", "p.12"), ("My note", None, None)]
    course = connect().execute("SELECT id FROM courses ORDER BY synced_at DESC").fetchone()
    if course is None:
        return
    targets = notes.link_targets(course["id"])
    pdf = next(t for t in targets if t["kind"] == "pdf")
    assert notes.resolve(pdf["link"], course["id"], targets) == ("file", pdf["id"])
