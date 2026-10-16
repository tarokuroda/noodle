"""Rough check that Moodle syncing works for your site.

    python sync_check.py --site https://moodle.example.ac.uk   # first run: log in, then sync
    python sync_check.py --dry-run                              # show what would download
    python sync_check.py --course 1234 --max-files 20           # limit scope
    python sync_check.py --max-size 50                          # skip files over 50 MB
    python sync_check.py --token <TOKEN>                        # token from Moodle > Preferences > Security keys
    python sync_check.py --relogin                              # ignore the saved token

Site + token are saved in .noodle/config.json, everything goes to vault/<course>/:
files and pages, "_Section overview.html" (section text + labels), "<assignment>/_Brief.html",
"Announcements/", and "_dates.json" (opens / due / closes dates for the timeline).
Run it twice: the second run should download nothing.
"""

import argparse
import base64
import getpass
import hashlib
import html
import json
import os
import re
import secrets
import ssl
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

import certifi
import requests
from requests.adapters import HTTPAdapter

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / ".noodle"
CONFIG_PATH = STATE_DIR / "config.json"
MANIFEST_PATH = STATE_DIR / "manifest.json"
VAULT = ROOT / "vault"

SERVICE = "moodle_mobile_app"
TIMEOUT = 60
NEEDED_FUNCTIONS = ["core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents"]
LOGIN_TYPES = {1: "username/password", 2: "SSO in browser", 3: "SSO in embedded browser"}
WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}

class OSTrustAdapter(HTTPAdapter):
    """Trust the OS certificate store as well as certifi, so antivirus/campus HTTPS scanning doesn't break TLS."""

    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.load_verify_locations(certifi.where())
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


http = requests.Session()
http.mount("https://", OSTrustAdapter())
http.headers["User-Agent"] = "noodle-sync-check/0.1"


class MoodleError(Exception):
    pass


# ---------- helpers ----------

def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def mask(token):
    return f"{token[:4]}...{token[-4:]}" if len(token) > 8 else "****"


def normalize_site(url):
    """Turn whatever the user pasted (e.g. .../my/ or .../login/index.php) into the site root."""
    url = url.strip().split("?")[0]
    if url and "://" not in url:
        url = "https://" + url
    url = re.sub(r"/(login|my|course|user|admin)(/.*)?$", "", url)
    url = re.sub(r"/index\.php$", "", url)
    return url.rstrip("/")


def clean(name, limit=40):
    """Make a string safe to use as one Windows path component (short, to stay under MAX_PATH)."""
    name = html.unescape(name or "")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()
    if len(name) > limit:
        stem, ext = os.path.splitext(name)
        if len(ext) > 8 or " " in ext:  # "Task 1.3 Review ..." has no real extension
            stem, ext = name, ""
        name = stem[: limit - len(ext)] + ext
    name = name.rstrip(". ")  # Windows silently drops trailing dots/spaces, which breaks paths
    if name.split(".")[0].upper() in WINDOWS_RESERVED:
        name = "_" + name
    return name or "_"


def fmt(counter, skip=()):
    return ", ".join(f"{k} {v}" for k, v in counter.most_common() if k not in skip) or "none"


# ---------- site check + login ----------

def probe_site(site):
    """Ask the site how the Moodle app should log in. Needs no account."""
    body = [{"index": 0, "methodname": "tool_mobile_get_public_config", "args": {}}]
    try:
        r = http.post(f"{site}/lib/ajax/service-nologin.php", params={"info": "tool_mobile_get_public_config"},
                      json=body, timeout=TIMEOUT)
    except requests.ConnectionError as e:
        raise MoodleError(f"Can't reach {site} ({type(e).__name__}). Check the --site URL.")
    if r.headers.get("cf-mitigated") == "challenge":
        print("  ! Cloudflare's bot check blocks the login endpoints for scripts, so logging in through your browser.")
        return {"bot_check": True}
    try:
        r.raise_for_status()
        reply = r.json()[0]
    except (requests.RequestException, ValueError, LookupError) as e:
        print(f"  ! Could not read the public config ({e}).")
        print("    Mobile web services may be disabled, or the URL is wrong. Trying to log in anyway.")
        return {}
    if reply.get("error"):
        print(f"  ! Public config error: {reply.get('exception', {}).get('message')}")
        return {}
    cfg = reply.get("data") or {}
    print(f"  Site:       {cfg.get('sitename')}  ({cfg.get('wwwroot')})")
    print(f"  Login type: {LOGIN_TYPES.get(cfg.get('typeoflogin'), cfg.get('typeoflogin'))}")
    if cfg.get("identityproviders"):
        print(f"  SSO options: {', '.join(p.get('name', '?') for p in cfg['identityproviders'])}")
    if cfg.get("enablemobilewebservice") in (0, False):
        print("  !! Mobile web services are DISABLED on this site - the app API will not work here.")
    if cfg.get("maintenanceenabled"):
        print("  !! Site is in maintenance mode.")
    return cfg


def password_login(site):
    username = input("  Moodle username (leave blank to log in through the browser instead): ").strip()
    if not username:
        return None
    password = getpass.getpass("  Password (not saved): ")
    r = http.post(f"{site}/login/token.php", data={"username": username, "password": password, "service": SERVICE},
                  timeout=TIMEOUT)
    try:
        reply = r.json()
    except ValueError:
        print(f"  ! login/token.php answered HTTP {r.status_code} with something that isn't JSON.")
        return None
    if reply.get("token"):
        return reply["token"]
    print(f"  ! Password login failed: {reply.get('error') or reply.get('errorcode') or reply}")
    return None


def parse_app_link(text, site, passport):
    """Pull the token out of a moodlemobile://token=<base64> link (or accept a bare token)."""
    if re.fullmatch(r"[0-9a-fA-F]{32}", text):
        return text
    m = re.search(r"token=([A-Za-z0-9+/=%_-]+)", text)
    if not m:
        raise ValueError("no 'token=' in it")
    blob = unquote(m.group(1))
    decoded = base64.b64decode(blob + "=" * (-len(blob) % 4)).decode()
    signature, token = decoded.split(":::")[:2]
    if signature != hashlib.md5((site + passport).encode()).hexdigest():
        print("  ! Signature doesn't match this login attempt (old link, or a different site URL). Using it anyway.")
    return token


def browser_login(site):
    passport = str(secrets.randbelow(10**9))
    # confirmed=1 makes Moodle show a page with a "Click here to launch the app" link
    # instead of silently redirecting to moodlemobile://, which browsers just ignore.
    url = (f"{site}/admin/tool/mobile/launch.php?service={SERVICE}&passport={passport}"
           f"&urlscheme=moodlemobile&confirmed=1")
    print(f"""
  Browser / SSO login:
    1. Open this link in your browser and log in if asked:
         {url}
    2. You should land on a "confirmed" page with a link like "Click here to launch the app" or
       "Click here if the app does not open automatically".
       Right-click that link -> "Copy link address". (Clicking it does nothing - that's fine.)
       If there's no such page: press F12, reopen the link, and look in Console for
       "Failed to launch 'moodlemobile://token=...'".
    3. Paste the moodlemobile://token=... link below.
""")
    pasted = input("  moodlemobile://token=... link: ").strip()
    try:
        return parse_app_link(pasted, site, passport)
    except (ValueError, IndexError) as e:
        print(f"  ! Couldn't read a token from that ({e}). Try again, or Ctrl+C to quit.")
        return None


def login(site, public_cfg):
    token = None
    if public_cfg.get("typeoflogin") in (2, 3):
        print("  This site uses SSO, so logging in through the browser.")
    elif not public_cfg.get("bot_check"):
        token = password_login(site)
    while not token:
        token = browser_login(site)
    return token


# ---------- web service client ----------

class Moodle:
    def __init__(self, site, token):
        self.site, self.token = site, token

    def call(self, function, **params):
        data = {"wstoken": self.token, "wsfunction": function, "moodlewsrestformat": "json", **params}
        r = http.post(f"{self.site}/webservice/rest/server.php", data=data, timeout=TIMEOUT)
        r.raise_for_status()
        reply = r.json()
        if isinstance(reply, dict) and "exception" in reply:
            hint = " (token rejected - rerun with --relogin to log in again)" if reply.get("errorcode") == "invalidtoken" else ""
            raise MoodleError(f"{function}: {reply.get('message')} [{reply.get('errorcode')}]{hint}")
        return reply

    def download(self, fileurl, dest):
        with http.get(fileurl, params={"token": self.token}, stream=True, timeout=TIMEOUT) as r:
            if r.headers.get("cf-mitigated") == "challenge":
                raise MoodleError("blocked by Cloudflare's bot check")
            r.raise_for_status()
            ctype = r.headers.get("Content-Type", "")
            if ctype.startswith("application/json") and dest.suffix.lower() != ".json":
                err = r.json()
                raise MoodleError((err.get("message") or err.get("error")) if isinstance(err, dict) else err)
            if ctype.startswith("text/html") and dest.suffix.lower() not in (".html", ".htm"):
                raise MoodleError("got an HTML page instead of the file (probably a login or error page)")
            dest.parent.mkdir(parents=True, exist_ok=True)
            part = dest.with_name(dest.name + ".part")
            size = 0
            with open(part, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
                    size += len(chunk)
            os.replace(part, dest)
            return size

    def scrub(self, text):
        """Download URLs carry the token, so never print it."""
        return str(text).replace(self.token, mask(self.token))


# ---------- sync ----------

def destination(section_dir, module, content):
    filename = content["filename"]
    if module["modname"] == "resource":
        return section_dir / clean(filename, 80)
    if module["modname"] == "page" and filename == "index.html":
        return section_dir / clean(f"{module['name']}.html", 80)
    subdirs = [clean(p) for p in (content.get("filepath") or "/").split("/") if p]
    return section_dir.joinpath(clean(module["name"]), *subdirs, clean(filename, 80))


def when(ts):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)) if ts else ""


def has_text(fragment):
    return bool(re.sub(r"<[^>]+>|&nbsp;|\s", "", fragment or ""))


def html_doc(title, *parts):
    title = html.escape(html.unescape(title or ""))
    body = "\n".join(p for p in parts if p)
    return f'<!doctype html>\n<meta charset="utf-8">\n<title>{title}</title>\n<h1>{title}</h1>\n{body}\n'


def is_deadline(date):
    dataid = date.get("dataid") or ""
    return any(w in dataid for w in ("due", "close", "deadline", "cutoff")) and "grading" not in dataid


class CourseSync:
    """One course: files and pages, section overviews (labels), assignment briefs, announcements, activity dates."""

    def __init__(self, m, course, args, manifest, budget, claimed):
        self.m, self.course, self.args = m, course, args
        self.manifest, self.budget, self.claimed = manifest, budget, claimed
        self.files, self.text, self.text_state = Counter(), Counter(), Counter()
        self.modtypes, self.not_synced = Counter(), Counter()
        self.dates = []
        self.dir = VAULT / clean(course["shortname"])

    def try_call(self, function, **params):
        """Calls for the extras: a failure is reported but doesn't stop the rest of the course."""
        try:
            return self.m.call(function, **params)
        except (MoodleError, requests.RequestException) as e:
            print(f"    ! {self.m.scrub(e)}")
            return None

    def module_url(self, module):
        return f"{self.m.site}/mod/{module['modname']}/view.php?id={module['id']}"

    def run(self):
        cid = self.course["id"]
        sections = self.m.call("core_course_get_contents", courseid=cid)
        # Page HTML comes straight from the API: its pluginfile URL is often behind Cloudflare's bot check.
        pages = {p["coursemodule"]: p for p in
                 (self.try_call("mod_page_get_pages_by_courses", **{"courseids[0]": cid}) or {}).get("pages", [])}
        forums = {f["cmid"]: f for f in self.try_call("mod_forum_get_forums_by_courses", **{"courseids[0]": cid}) or []}

        for i, section in enumerate(sections):
            section_dir = self.dir / clean(f"{section.get('section', i):02d} {section.get('name') or 'Section'}")
            labels = []
            for module in section.get("modules", []):
                modname = module.get("modname", "?")
                self.modtypes[modname] += 1
                self.collect_dates(section, module)
                if modname == "label":
                    labels.append(module.get("description") or "")
                    continue
                if modname == "assign":
                    self.assignment(section_dir, module)
                    continue
                if modname == "forum" and forums.get(module["id"], {}).get("type") == "news":
                    self.announcements(forums[module["id"]])
                    continue
                contents = [c for c in module.get("contents") or [] if c.get("type") in ("file", "url")]
                if not contents:
                    self.not_synced[modname] += 1
                    continue
                for content in contents:
                    if content["type"] == "url":
                        self.files["links"] += 1
                        continue
                    page = pages.get(module["id"]) if modname == "page" and content["filename"] == "index.html" else None
                    self.file(content["fileurl"], destination(section_dir, module, content),
                              content.get("timemodified"), content.get("filesize"), module["id"],
                              page_html=(page.get("content") or "") if page else None)
            self.section_overview(section_dir, section, labels)

        if self.dates:
            self.write_text(self.dir / "_dates.json", json.dumps(self.dates, indent=2, ensure_ascii=False), "date lists")

    # --- the extras ---

    def section_overview(self, section_dir, section, labels):
        """Section summary + the text blocks (labels) on the course page, in page order."""
        parts = [p for p in [section.get("summary") or "", *labels] if has_text(p)]
        if parts:
            self.write_text(section_dir / "_Section overview.html",
                            html_doc(section.get("name") or "Section", *parts), "section overviews")

    def assignment(self, section_dir, module):
        folder = section_dir / clean(module["name"])
        rows = "".join(f"<li>{html.escape(d['label'])} {when(d['timestamp'])}</li>" for d in module.get("dates") or [])
        # mod_assign_get_assignments errors on some sites; submission status is what the Moodle app uses instead.
        status = self.try_call("mod_assign_get_submission_status", assignid=module["instance"]) or {}
        data = status.get("assignmentdata") or {}
        self.write_text(folder / "_Brief.html", html_doc(
            module["name"],
            f"<ul>{rows}</ul>" if rows else "",
            module.get("description") or "",
            data.get("intro") or "",
            data.get("activity") or "",
            f'<p><a href="{self.module_url(module)}">Open in Moodle</a></p>',
        ), "assignment briefs")
        for files in (data.get("attachments") or {}).values():
            for f in files:
                self.file(f["fileurl"], folder / clean(f["filename"], 80), f.get("timemodified"), f.get("filesize"),
                          module["id"])

    def announcements(self, forum):
        folder = self.dir / "Announcements"
        for page in range(20):
            reply = self.try_call("mod_forum_get_forum_discussions", forumid=forum["id"], page=page, perpage=50) or {}
            discussions = reply.get("discussions") or []
            for d in discussions:
                name = clean(f"{time.strftime('%Y-%m-%d', time.localtime(d['created']))} {d.get('subject') or 'Announcement'}")
                byline = (f"<p>{html.escape(d.get('userfullname') or '')} - {when(d['created'])} - "
                          f'<a href="{self.m.site}/mod/forum/discuss.php?d={d["discussion"]}">Open in Moodle</a></p>')
                self.write_text(folder / f"{name}.html", html_doc(d.get("subject"), byline, d.get("message") or ""),
                                "announcements")
                for f in d.get("attachments") or []:
                    self.file(f["fileurl"], folder / name / clean(f["filename"], 80), f.get("timemodified"),
                              f.get("filesize"), d["discussion"])
            if len(discussions) < 50:
                break

    def collect_dates(self, section, module):
        """Activity dates (opens / due / closes) for the timeline. They come free with the course contents."""
        dates = [{**d, "when": when(d["timestamp"])} for d in module.get("dates") or [] if d.get("timestamp")]
        if dates:
            self.dates.append({"course": self.course["shortname"], "section": section.get("name"),
                               "type": module["modname"], "name": html.unescape(module["name"]),
                               "url": self.module_url(module), "dates": dates})

    # --- writing ---

    def write_text(self, dest, text, kind):
        """Text we generate ourselves: rewritten only when it changed."""
        data = text.encode("utf-8")
        state = "unchanged" if dest.exists() and dest.read_bytes() == data else "updated" if dest.exists() else "new"
        self.text[kind] += 1
        if state != "unchanged" and not self.args.dry_run:
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            except OSError as e:
                state = "failed"
                print(f"    FAILED {dest.relative_to(ROOT).as_posix()}: {e}")
        self.text_state[state] += 1

    def file(self, url, dest, timemodified, filesize, tag, page_html=None):
        """Download a Moodle file unless the manifest says we already have this version."""
        if self.claimed.get(dest, url) != url:  # same filename twice in one folder
            dest = dest.with_name(f"{dest.stem} ({tag}){dest.suffix}")
        self.claimed[dest] = url
        rel = dest.relative_to(ROOT).as_posix()

        old = self.manifest.get(url)
        if (old and old["path"] == rel and old["timemodified"] == timemodified
                and old["filesize"] == filesize and dest.exists()):
            self.files["unchanged"] += 1
            return
        state = "updated" if old else "new"
        if self.args.max_size and (filesize or 0) > self.args.max_size * 1e6:
            self.files["skipped (--max-size)"] += 1
            return
        if self.args.dry_run:
            self.files[state] += 1
            self.files["bytes"] += filesize or 0
            print(f"    would download [{state}] {rel}")
            return
        if self.budget["left"] <= 0:
            self.files["skipped (--max-files)"] += 1
            return
        self.budget["left"] -= 1
        try:
            if page_html is not None:
                data = page_html.encode("utf-8")
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                size = len(data)
            else:
                size = self.m.download(url, dest)
        except (requests.RequestException, MoodleError, OSError) as e:
            self.files["failed"] += 1
            print(f"    FAILED {rel}: {self.m.scrub(e)}")
            return
        self.files[state] += 1
        self.files["bytes"] += size
        self.manifest[url] = {"path": rel, "timemodified": timemodified, "filesize": filesize}
        print(f"    {state:<8} {rel}  ({size / 1e6:.1f} MB)")
        time.sleep(0.2)  # be gentle with the uni server


def main():
    sys.stdout.reconfigure(errors="replace")
    p = argparse.ArgumentParser(description="Rough check that Moodle syncing works.")
    p.add_argument("--site", help="your Moodle URL, e.g. https://moodle.example.ac.uk")
    p.add_argument("--token", help="use this web-service token instead of logging in")
    p.add_argument("--relogin", action="store_true", help="ignore the saved token and log in again")
    p.add_argument("--dry-run", action="store_true", help="list what would be downloaded, download nothing")
    p.add_argument("--course", type=int, action="append", help="only sync this course id (repeatable)")
    p.add_argument("--max-files", type=int, help="stop after downloading this many files")
    p.add_argument("--max-size", type=float, metavar="MB", help="skip files bigger than this many MB")
    args = p.parse_args()

    saved = load_json(CONFIG_PATH, {})
    site = normalize_site(args.site or saved.get("site", ""))
    if not site:
        p.error("first run needs --site, e.g. --site https://moodle.example.ac.uk")

    print("[1/5] Checking the site")
    public = probe_site(site)
    if public.get("wwwroot"):
        site = public["wwwroot"].rstrip("/")

    print("[2/5] Logging in")
    token = args.token
    if not token and not args.relogin and saved.get("site") == site:
        token = saved.get("token")
        if token:
            print(f"  Using saved token {mask(token)}")
    if not token:
        token = login(site, public)
    save_json(CONFIG_PATH, {"site": site, "token": token})
    m = Moodle(site, token)

    print("[3/5] Site info")
    info = m.call("core_webservice_get_site_info")
    print(f"  Logged in as {info.get('fullname')} (user id {info.get('userid')}), Moodle {info.get('release')}")
    print(f"  Token saved to {CONFIG_PATH.relative_to(ROOT)} ({mask(token)})")
    if not info.get("downloadfiles"):
        print("  !! This site does NOT allow file downloads through the app API (downloadfiles = 0).")
    available = {f["name"] for f in info.get("functions", [])}
    missing = [f for f in NEEDED_FUNCTIONS if f not in available]
    if missing:
        print(f"  !! Not available to this token: {', '.join(missing)}")

    print("[4/5] Courses")
    courses = m.call("core_enrol_get_users_courses", userid=info["userid"])
    for c in courses:
        print(f"  {c['id']:>6}  {html.unescape(c.get('shortname', ''))[:30]:<30}  {html.unescape(c.get('fullname', ''))}")
    if args.course:
        courses = [c for c in courses if c["id"] in args.course]
    print(f"  {len(courses)} course(s) to sync")

    print(f"[5/5] {'Listing' if args.dry_run else 'Syncing'} into {VAULT.relative_to(ROOT)}/")
    manifest = load_json(MANIFEST_PATH, {})
    budget = {"left": args.max_files if args.max_files is not None else float("inf")}
    claimed = {}
    totals, text, text_state, not_synced, dates = Counter(), Counter(), Counter(), Counter(), []
    try:
        for c in courses:
            print(f"\n  == {html.unescape(c.get('fullname', ''))} (id {c['id']})")
            cs = CourseSync(m, c, args, manifest, budget, claimed)
            try:
                cs.run()
            except (MoodleError, requests.RequestException) as e:
                print(f"    FAILED to read course contents: {m.scrub(e)}")
                totals["courses failed"] += 1
                continue
            print(f"    modules: {fmt(cs.modtypes)}")
            print(f"    files:   {fmt(cs.files, skip={'bytes'})}")
            print(f"    text:    {fmt(cs.text)}  ({fmt(cs.text_state)})")
            totals.update(cs.files)
            text.update(cs.text)
            text_state.update(cs.text_state)
            not_synced.update(cs.not_synced)
            dates += cs.dates
    finally:
        if not args.dry_run:
            save_json(MANIFEST_PATH, manifest)

    print("\nSummary" + (" (dry run - nothing written)" if args.dry_run else ""))
    print(f"  files: {fmt(totals, skip={'bytes'})}")
    print(f"  {'would download' if args.dry_run else 'downloaded'}: {totals['bytes'] / 1e6:.1f} MB")
    print(f"  text:  {fmt(text)}  ({fmt(text_state)})")
    upcoming = sorted(((d["timestamp"], d["label"], e) for e in dates for d in e["dates"]
                       if is_deadline(d) and d["timestamp"] > time.time()), key=lambda x: x[0])
    if upcoming:
        print("  upcoming deadlines:")
        for ts, label, e in upcoming[:10]:
            print(f"    {when(ts)}  {label:<9} {e['course'][:22]:<22} {e['name'][:60]}")
    if not_synced:
        print(f"  not synced (no files, need other APIs): {fmt(not_synced)}")
    changed = totals["new"] + totals["updated"] + totals["failed"] + text_state["new"] + text_state["updated"]
    if not args.dry_run and (totals["unchanged"] or text_state["unchanged"]) and not changed:
        print("  Nothing new - incremental sync works.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(130)
    except (MoodleError, requests.RequestException) as e:
        print(f"\nERROR: {e}")
        sys.exit(1)
