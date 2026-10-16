"""The Timeline: deadlines and events across every enrolled course, from Moodle's calendar, plus the
week-by-week shape of the synced courses (week titles, announcements, activity dates).

Only read-only functions are called, sequentially and rarely:
- core_course_get_enrolled_courses_by_timeline_classification   your visible courses (1 s; the full enrolment
                                                list takes 30 s at UCL)
- core_calendar_get_action_events_by_timesort   deadlines that need you (with links and "overdue")
- core_calendar_get_calendar_events             everything else in the window (e.g. already-submitted work)
- core_course_get_course_module + mod_assign_get_submission_status
                                                submitted / draft / not submitted, for upcoming assignments
At UCL a calendar event's "instance" is the activity's course-module id (the id in its view.php link), not the
assignment id, so the assignment id comes from the synced _dates.json or core_course_get_course_module.
The result is cached in .noodle/timeline.json for 10 minutes and kept when Moodle can't be reached.
"""

import html
import json
import re
import time
from datetime import datetime

import requests

from . import demo
from .db import connect
from .moodle import MoodleError, load_json, save_json
from .paths import ROOT, SHARED_DIR

CACHE_PATH = SHARED_DIR / "timeline.json"  # one Moodle account per laptop, so profiles share it
TTL = 600
BACK, AHEAD = 30 * 86400, 365 * 86400  # the calendar window around now
STATUS_DAYS, STATUS_MAX = 180, 12  # submission status for assignments due this soon, at most this many calls
PAUSE = 0.2
DEADLINE_TYPES = {"due", "close", "cutoff"}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DAY_MONTH = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})")


# ---------- fetching from Moodle ----------

def fetch(m, course_ids, now=None):
    """One sequential pass over the calendar. Returns the raw replies; merge_events() makes items of them."""
    now = int(now or time.time())
    start, end = now - BACK, now + AHEAD
    action, after = [], None
    for _ in range(4):
        params = {"timesortfrom": start, "timesortto": end, "limitnum": 50, "limittononsuspendedevents": 1}
        if after:
            params["aftereventid"] = after
        reply = m.call("core_calendar_get_action_events_by_timesort", **params)
        events = reply.get("events") or []
        action += events
        if len(events) < 50:
            break
        after = reply.get("lastid") or events[-1]["id"]
        time.sleep(PAUSE)
    time.sleep(PAUSE)
    params = {"options[userevents]": 1, "options[siteevents]": 1, "options[timestart]": start,
              "options[timeend]": end, "options[ignorehidden]": 1}
    for i, cid in enumerate(course_ids):
        params[f"events[courseids][{i}]"] = cid
    raw = m.call("core_calendar_get_calendar_events", **params).get("events") or []

    statuses = {}
    known = synced_instances()
    soon = sorted((e for e in [*action, *raw] if e.get("modulename") == "assign" and e.get("eventtype") == "due"
                   and now <= _ts(e) <= now + STATUS_DAYS * 86400), key=_ts)
    for e in soon:
        cmid = cmid_of(e)
        if not cmid or str(cmid) in statuses or len(statuses) >= STATUS_MAX:
            continue
        try:
            assign_id = known.get(cmid)
            if not assign_id:
                time.sleep(PAUSE)
                assign_id = m.call("core_course_get_course_module", cmid=cmid)["cm"]["instance"]
            time.sleep(PAUSE)
            statuses[str(cmid)] = submission_state(m.call("mod_assign_get_submission_status", assignid=assign_id))
        except (MoodleError, requests.RequestException, KeyError):
            statuses[str(cmid)] = None
    return {"action": action, "raw": raw, "statuses": statuses}


def cmid_of(e):
    """The activity's course-module id: from its view.php link, else the event's instance (see the docstring)."""
    m = re.search(r"/mod/\w+/view\.php\?id=(\d+)", e.get("url") or "")
    return int(m.group(1)) if m else e.get("instance")


def synced_instances():
    """cmid -> activity instance id, from the synced courses' _dates.json (saves a call per assignment)."""
    out = {}
    for c in connect().execute("SELECT dir FROM courses"):
        for e in load_json(ROOT / c["dir"] / "_dates.json", []):
            if e.get("cmid") and e.get("instance"):
                out[e["cmid"]] = e["instance"]
    return out


def submission_state(reply):
    attempt = reply.get("lastattempt") or {}
    sub = attempt.get("submission") or attempt.get("teamsubmission") or {}
    status = sub.get("status")
    if status == "submitted":
        return {"state": "done", "text": "Submitted"}
    if status == "draft":
        return {"state": "draft", "text": "Draft saved"}
    if status in ("new", "reopened", None) and attempt:
        return {"state": "todo", "text": "Not submitted"}
    return None


def _ts(e):
    return e.get("timesort") or e.get("timestart") or 0


# ---------- turning replies into timeline items ----------

def merge_events(action, raw, statuses, courses, site, now=None):
    """Calendar items: action events win (they carry the link and 'overdue'), raw events fill the gaps."""
    now = now or time.time()
    by_id = {}
    for e in raw:
        by_id[e["id"]] = dict(e)
    for e in action:
        by_id[e["id"]] = {**by_id.get(e["id"], {}), **e, "_action": True}
    items = []
    for e in by_id.values():
        etype = e.get("eventtype") or ""
        if etype == "gradingdue":  # a teacher's marking deadline, not yours
            continue
        ts = _ts(e)
        course = e.get("course") or {}
        cid = course.get("id") or e.get("courseid")
        cmid = cmid_of(e) if e.get("modulename") else None
        status = statuses.get(str(cmid)) if e.get("modulename") == "assign" else None
        deadline = etype in DEADLINE_TYPES
        items.append({
            "id": f"ev{e['id']}", "kind": "deadline" if deadline else "event", "ts": ts, "allday": False,
            "title": html.unescape(e.get("name") or "Event"), "label": _label(etype),
            "course_id": cid if cid and cid > 1 else None,
            "course": html.unescape(course.get("shortname") or "").split("_")[0] or courses.get(cid),
            "modname": e.get("modulename"), "cmid": cmid,
            "url": e.get("url") or f"{site}/calendar/view.php?view=day&time={ts}",
            "status": status, "overdue": deadline and bool(e.get("overdue")) and not status_done(status),
        })
    return items


def status_done(status):
    return bool(status) and status.get("state") == "done"


def _label(etype):
    return {"due": "Due", "close": "Closes", "open": "Opens", "cutoff": "Cut-off", "expectcompletionon": "Complete by",
            "course": "Course event", "user": "Your event", "site": "Site event", "group": "Group event"}.get(etype, "")


def _start_year(shortname):
    m = re.search(r"_(\d{2})-\d{2}$", shortname)
    return 2000 + int(m.group(1)) if m else datetime.now().year


def _date_in(title, start_year):
    for day, month in DAY_MONTH.findall(title or ""):
        mon = MONTHS.get(month[:3].lower())
        if mon:
            year = start_year if mon >= 8 else start_year + 1
            try:
                return datetime(year, mon, int(day), 9)
            except ValueError:
                return None
    return None


def local_items(before=None):
    """Weeks, announcements and activity dates of the synced courses (activity dates only before `before`)."""
    conn = connect()
    items = []
    for course in conn.execute("SELECT * FROM courses").fetchall():
        code = course["shortname"].split("_")[0]
        start = _start_year(course["shortname"])
        since = datetime(start, 8, 1).timestamp()  # drop leftovers from earlier years of the course
        sections = {}
        for f in conn.execute("SELECT * FROM files WHERE course_id=? AND twin_id IS NULL ORDER BY section_num, ord",
                              (course["id"],)).fetchall():
            s = sections.setdefault(f["section_num"], {"title": f["section"], "files": []})
            tag = demo.tag_for(f["path"], f["name"], f["kind"])
            if tag != "other":
                s["files"].append({"id": f["id"], "name": f["name"], "tag": tag})
            m = re.match(r"(\d{4}-\d{2}-\d{2}) (.*)", f["name"]) if f["section"] == "Announcements" else None
            if m:
                raw = (ROOT / f["path"]).read_text(encoding="utf-8", errors="replace") if f["status"] == "ok" else ""
                full = re.search(r"<title>(.*?)</title>", raw, re.S)
                items.append({"id": f"an{f['id']}", "kind": "announcement", "allday": True,
                              "ts": datetime.strptime(m.group(1), "%Y-%m-%d").replace(hour=9).timestamp(),
                              "title": html.unescape(full.group(1)).strip() if full else m.group(2),
                              "course_id": course["id"], "course": code, "file_id": f["id"], "url": f["moodle_url"]})
        for num, s in sections.items():
            when = _date_in(s["title"], start)
            if when:
                items.append({"id": f"wk{course['id']}-{num}", "kind": "week", "allday": True, "ts": when.timestamp(),
                              "title": s["title"], "course_id": course["id"], "course": code, "files": s["files"][:6]})
        dates_file = ROOT / course["dir"] / "_dates.json"
        for e in load_json(dates_file, []) if dates_file.exists() else []:
            for d in e["dates"]:
                if before is not None and d["timestamp"] >= before:
                    continue  # the calendar covers this part
                etype = d.get("dataid") or ""
                deadline = any(w in etype for w in ("due", "close", "cutoff")) and "grading" not in etype
                items.append({"id": f"dt{course['id']}-{e['url']}-{etype}", "kind": "deadline" if deadline else "event",
                              "allday": False, "ts": d["timestamp"], "title": e["name"],
                              "label": d["label"].rstrip(":"), "course_id": course["id"], "course": code,
                              "modname": e["type"], "cmid": e.get("cmid"), "url": e["url"], "status": None,
                              "overdue": False})
        items = [i for i in items if i["course_id"] != course["id"] or i["ts"] >= since]
    return items


def link_files(items):
    """Point items at their file in Noodle when we have it: an assignment's brief, or the activity's own file."""
    conn = connect()
    by_url = {}
    for r in conn.execute("SELECT id, path, moodle_url FROM files WHERE status='ok' AND twin_id IS NULL "
                          "AND moodle_url LIKE '%/mod/%'"):
        if r["moodle_url"] not in by_url or r["path"].endswith("_Brief.html"):
            by_url[r["moodle_url"]] = r["id"]
    urls = {}  # cmid -> activity URL, from the synced courses' _dates.json
    for c in conn.execute("SELECT dir FROM courses"):
        for e in load_json(ROOT / c["dir"] / "_dates.json", []):
            if e.get("cmid"):
                urls[e["cmid"]] = e["url"]
    for it in items:
        if it.get("file_id"):
            continue
        if "/calendar/" in (it.get("url") or "") and it.get("cmid") in urls:
            it["url"] = urls[it["cmid"]]  # a raw event without a link: use the activity's page
        it["file_id"] = by_url.get(it.get("url"))
    return items


# ---------- cache + the API ----------

def refresh(m=None, force=False):
    """Fetch the calendar again if the cache is older than TTL (or force). Never raises."""
    cache = load_json(CACHE_PATH, {})
    if not force and cache.get("fetched_at") and time.time() - cache["fetched_at"] < TTL:
        return cache
    from . import account
    m = m or account.client()
    if m is None:
        return cache
    try:
        st = account.status()
        if not st.get("logged_in") or st.get("offline"):
            return {**cache, "offline": True}
        visible = m.call("core_course_get_enrolled_courses_by_timeline_classification", classification="all",
                         limit=0, customfieldname="", customfieldvalue="").get("courses") or []
        courses = {c["id"]: html.unescape(c.get("shortname") or "").split("_")[0] for c in visible}
        for c in connect().execute("SELECT id, shortname FROM courses"):  # synced courses, even if hidden in Moodle
            courses.setdefault(c["id"], c["shortname"].split("_")[0])
        time.sleep(PAUSE)
        data = fetch(m, list(courses))
        cache = {"fetched_at": time.time(), "site": m.site, "courses": {str(k): v for k, v in courses.items()}, **data,
                 "offline": False, "error": None}
    except requests.RequestException:
        return {**cache, "offline": True}
    except MoodleError as e:
        return {**cache, "error": m.scrub(e)}
    save_json(CACHE_PATH, cache)
    return cache


def build(cached_only=False):
    cache = load_json(CACHE_PATH, {}) if cached_only else refresh()
    now = time.time()
    courses = {int(k): v for k, v in (cache.get("courses") or {}).items()}
    items = []
    window_start = None
    if cache.get("fetched_at"):
        window_start = cache["fetched_at"] - BACK
        items += merge_events(cache.get("action", []), cache.get("raw", []), cache.get("statuses", {}), courses,
                              cache.get("site", ""), now)
    items = link_files(items + local_items(before=window_start))
    for it in items:
        if it.get("course") is None and it.get("course_id") in courses:
            it["course"] = courses[it["course_id"]]
    items.sort(key=lambda i: (i["ts"], i["kind"] != "week"))
    used = sorted({i["course"] for i in items if i.get("course")})
    return {"now": now, "fetched_at": cache.get("fetched_at"), "offline": bool(cache.get("offline")),
            "error": cache.get("error"), "courses": used, "items": items}
