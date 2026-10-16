"""Login state, the course list and the background Sync job behind the app's Sync button.

The user does every Moodle login in their own browser; Noodle only reads the moodlemobile:// link they paste.
The token never leaves this machine and is only ever shown masked.
"""

import html
import secrets
import threading
import time

import requests

from .index import index_sync
from .moodle import Moodle, MoodleError, launch_url, load_json, mask, normalize_site, parse_app_link, probe_site, save_json
from .paths import CONFIG_PATH
from .sync import sync_courses

MAX_SIZE_MB = 100
_lock = threading.Lock()
_pending = {}  # site, passport of the login in progress
_cache = {}  # small TTL cache for site info and the course list
JOB = {"running": False, "phase": "", "done": 0, "total": 0, "current": "", "message": "", "error": None,
       "new_files": 0, "finished_at": None}


def config():
    return load_json(CONFIG_PATH, {})


def save_config(**changes):
    save_json(CONFIG_PATH, {**config(), **changes})


def client():
    cfg = config()
    if not cfg.get("site") or not cfg.get("token"):
        return None
    return Moodle(cfg["site"], cfg["token"])


def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def status():
    cfg = config()
    m = client()
    if m is None:
        return {"logged_in": False, "site": cfg.get("site") or "https://moodle.ucl.ac.uk"}
    try:
        info = _cached(("info", m.token), 600, lambda: m.call("core_webservice_get_site_info"))
    except MoodleError as e:
        return {"logged_in": False, "site": m.site, "reason": m.scrub(e)}
    except requests.RequestException:  # offline: trust the saved token, the library still works
        return {"logged_in": True, "offline": True, "site": m.site, "token": mask(m.token)}
    return {"logged_in": True, "site": m.site, "user": info.get("fullname"), "userid": info.get("userid"),
            "sitename": info.get("sitename"), "token": mask(m.token)}


def start_login(site):
    site = normalize_site(site)
    public = probe_site(site)
    if public.get("wwwroot"):
        site = public["wwwroot"].rstrip("/")
    passport = str(secrets.randbelow(10**9))
    _pending.update(site=site, passport=passport)
    return {"site": site, "launch_url": launch_url(site, passport), "warnings": public.get("warnings", [])}


def finish_login(link):
    site, passport = _pending.get("site") or config().get("site"), _pending.get("passport", "")
    if not site:
        raise ValueError("Press “Open Moodle login” first.")
    try:
        token, _signature_ok = parse_app_link(link, site, passport)
    except (ValueError, IndexError, UnicodeDecodeError):
        raise ValueError("That doesn't look like a Moodle app link. It should start with moodlemobile://token=")
    try:
        Moodle(site, token).call("core_webservice_get_site_info")
    except (MoodleError, requests.RequestException):
        raise ValueError("Moodle didn't accept that link. Open the login again and copy a fresh link.")
    save_config(site=site, token=token)
    _cache.clear()
    return status()


def courses():
    m = client()
    st = status()
    if m is None or not st.get("logged_in") or st.get("offline"):
        return []
    rows = _enrolled(m, st["userid"])
    selected = set(config().get("courses", []))
    return [{"id": c["id"], "shortname": html.unescape(c.get("shortname", "")), "fullname": html.unescape(c.get("fullname", "")),
             "selected": c["id"] in selected} for c in rows]


def _enrolled(m, userid):
    return _cached(("courses", m.token), 300, lambda: m.call("core_enrol_get_users_courses", userid=userid))


def start_sync(course_ids):
    with _lock:
        if JOB["running"]:
            return dict(JOB)
        m = client()
        if m is None:
            raise ValueError("Log in to Moodle first.")
        save_config(courses=list(course_ids))
        chosen = [c for c in _enrolled(m, status()["userid"]) if c["id"] in set(course_ids)]
        JOB.update(running=True, phase="Checking Moodle", done=0, total=0, current="", message="", error=None,
                   new_files=0, finished_at=None)
    threading.Thread(target=_run, args=(m, chosen), daemon=True).start()
    return dict(JOB)


def _run(m, chosen):
    def on_file(course, done, total, name):
        JOB.update(phase=f"Syncing {html.unescape(course['shortname']).split('_')[0]}", done=done, total=total,
                   current=name)

    def on_index(phase, done, total):
        JOB.update(phase=phase, done=done, total=total, current="")

    try:
        results = sync_courses(m, chosen, max_size_mb=MAX_SIZE_MB, log=lambda *_: None, progress=on_file)
        new = sum(cs.files["new"] + cs.files["updated"] for cs in results)
        JOB.update(new_files=new)
        index_sync(results, log=lambda *_: None, progress=on_index)
        failed = [cs.course["shortname"] for cs in results if cs.error]
        JOB.update(message=(f"{new} new file{'s' if new != 1 else ''}" if new else "You're up to date: nothing new on Moodle")
                   + (f" (couldn't read {', '.join(failed)})" if failed else ""))
    except Exception as e:  # noqa: BLE001 - shown in the UI instead of killing the thread silently
        JOB.update(error=m.scrub(e))
    finally:
        JOB.update(running=False, finished_at=time.time())
