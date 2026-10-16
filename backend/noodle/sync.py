"""Course sync (moved from sync_check.py). Keeps every UCL workaround:

- page HTML comes from mod_page_get_pages_by_courses, not the (often Cloudflare-blocked) pluginfile URL
- assignment dates come from core_course_get_contents -> module.dates, plus mod_assign_get_submission_status
  (mod_assign_get_assignments fails at UCL with invalidresponse)
- labels are written into "_Section overview.html", news-forum posts into Announcements/
- files blocked by Cloudflare are recorded as "blocked" and shown as "Open in Moodle" links; never worked around

New here: every file the sync sees is recorded (downloaded / skipped / blocked / failed) so the library can
show it, and a progress callback drives the progress bar.
"""

import html
import json
import re
import time
from collections import Counter

import requests

from .moodle import BlockedError, MoodleError, clean, load_json, save_json
from .paths import MANIFEST_PATH, ROOT, VAULT


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


def course_dir(course):
    return VAULT / clean(course["shortname"])


class CourseSync:
    """One course: files and pages, section overviews (labels), assignment briefs, announcements, activity dates."""

    def __init__(self, m, course, manifest, claimed, *, max_size_mb=100, max_files=None, dry_run=False,
                 log=print, progress=None):
        self.m, self.course = m, course
        self.manifest, self.claimed = manifest, claimed
        self.max_size_mb, self.dry_run = max_size_mb, dry_run
        self.budget = max_files if max_files is not None else float("inf")
        self.log, self.progress = log, progress or (lambda done, total, name: None)
        self.files, self.text, self.text_state = Counter(), Counter(), Counter()
        self.modtypes, self.not_synced = Counter(), Counter()
        self.dates, self.records = [], []
        self.ctx = {}
        self.done = self.total = 0
        self.dir = course_dir(course)

    def try_call(self, function, **params):
        """Calls for the extras: a failure is reported but doesn't stop the rest of the course."""
        try:
            return self.m.call(function, **params)
        except (MoodleError, requests.RequestException) as e:
            self.log(f"    ! {self.m.scrub(e)}")
            return None

    def module_url(self, module):
        return f"{self.m.site}/mod/{module['modname']}/view.php?id={module['id']}"

    def set_ctx(self, section, i, module=None, **extra):
        self.ctx = {"section_num": section.get("section", i), "section": html.unescape(section.get("name") or "Section"),
                    "module": html.unescape(module["name"]) if module else "",
                    "modname": module["modname"] if module else "",
                    "moodle_url": self.module_url(module) if module else f"{self.m.site}/course/view.php?id={self.course['id']}",
                    **extra}

    def run(self):
        cid = self.course["id"]
        sections = self.m.call("core_course_get_contents", courseid=cid)
        self.total = sum(1 for s in sections for mod in s.get("modules", [])
                         for c in mod.get("contents") or [] if c.get("type") == "file")
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
                self.set_ctx(section, i, module)
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
            self.set_ctx(section, i)
            self.section_overview(section_dir, section, labels)

        if self.dates:
            self.write_text(self.dir / "_dates.json", json.dumps(self.dates, indent=2, ensure_ascii=False),
                            "date lists", record=False)

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
                self.total += 1
                self.file(f["fileurl"], folder / clean(f["filename"], 80), f.get("timemodified"), f.get("filesize"),
                          module["id"])

    def announcements(self, forum):
        folder = self.dir / "Announcements"
        saved_ctx = self.ctx
        for page in range(20):
            reply = self.try_call("mod_forum_get_forum_discussions", forumid=forum["id"], page=page, perpage=50) or {}
            discussions = reply.get("discussions") or []
            for d in discussions:
                name = clean(f"{time.strftime('%Y-%m-%d', time.localtime(d['created']))} {d.get('subject') or 'Announcement'}")
                url = f"{self.m.site}/mod/forum/discuss.php?d={d['discussion']}"
                self.ctx = {**saved_ctx, "section_num": 999, "section": "Announcements", "moodle_url": url}
                byline = (f"<p>{html.escape(d.get('userfullname') or '')} - {when(d['created'])} - "
                          f'<a href="{url}">Open in Moodle</a></p>')
                self.write_text(folder / f"{name}.html", html_doc(d.get("subject"), byline, d.get("message") or ""),
                                "announcements")
                for f in d.get("attachments") or []:
                    self.total += 1
                    self.file(f["fileurl"], folder / name / clean(f["filename"], 80), f.get("timemodified"),
                              f.get("filesize"), d["discussion"])
            if len(discussions) < 50:
                break
        self.ctx = saved_ctx

    def collect_dates(self, section, module):
        """Activity dates (opens / due / closes) for the timeline. They come free with the course contents."""
        dates = [{**d, "when": when(d["timestamp"])} for d in module.get("dates") or [] if d.get("timestamp")]
        if dates:
            self.dates.append({"course": self.course["shortname"], "section": section.get("name"),
                               "type": module["modname"], "name": html.unescape(module["name"]),
                               "url": self.module_url(module), "dates": dates})

    # --- writing ---

    def record(self, dest, status, url=None, size=None):
        self.records.append({**self.ctx, "path": dest.relative_to(ROOT).as_posix(), "url": url,
                             "size": size, "status": status})

    def write_text(self, dest, text, kind, record=True):
        """Text we generate ourselves: rewritten only when it changed."""
        data = text.encode("utf-8")
        state = "unchanged" if dest.exists() and dest.read_bytes() == data else "updated" if dest.exists() else "new"
        self.text[kind] += 1
        if state != "unchanged" and not self.dry_run:
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            except OSError as e:
                state = "failed"
                self.log(f"    FAILED {dest.relative_to(ROOT).as_posix()}: {e}")
        self.text_state[state] += 1
        if record:
            self.record(dest, "failed" if state == "failed" else "ok", size=len(data))

    def file(self, url, dest, timemodified, filesize, tag, page_html=None):
        """Download a Moodle file unless the manifest says we already have this version."""
        if self.claimed.get(dest, url) != url:  # same filename twice in one folder
            dest = dest.with_name(f"{dest.stem} ({tag}){dest.suffix}")
        self.claimed[dest] = url
        rel = dest.relative_to(ROOT).as_posix()
        self.done += 1
        self.progress(self.done, max(self.total, self.done), dest.name)

        old = self.manifest.get(url)
        if (old and old["path"] == rel and old["timemodified"] == timemodified
                and old["filesize"] == filesize and dest.exists()):
            self.files["unchanged"] += 1
            self.record(dest, "ok", url, filesize)
            return
        state = "updated" if old else "new"
        if self.max_size_mb and (filesize or 0) > self.max_size_mb * 1e6:
            self.files["skipped (--max-size)"] += 1
            self.record(dest, "skipped", url, filesize)
            return
        if self.dry_run:
            self.files[state] += 1
            self.files["bytes"] += filesize or 0
            self.log(f"    would download [{state}] {rel}")
            return
        if self.budget <= 0:
            self.files["skipped (--max-files)"] += 1
            self.record(dest, "skipped", url, filesize)
            return
        self.budget -= 1
        try:
            if page_html is not None:
                data = page_html.encode("utf-8")
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                size = len(data)
            else:
                size = self.m.download(url, dest)
        except (requests.RequestException, MoodleError, OSError) as e:
            blocked = isinstance(e, BlockedError)
            self.files["blocked" if blocked else "failed"] += 1
            self.log(f"    {'BLOCKED' if blocked else 'FAILED'} {rel}: {self.m.scrub(e)}")
            self.record(dest, "blocked" if blocked else "failed", url, filesize)
            return
        self.files[state] += 1
        self.files["bytes"] += size
        self.manifest[url] = {"path": rel, "timemodified": timemodified, "filesize": filesize}
        self.record(dest, "ok", url, size)
        self.log(f"    {state:<8} {rel}  ({size / 1e6:.1f} MB)")
        time.sleep(0.2)  # be gentle with the uni server


def sync_courses(m, courses, *, max_size_mb=100, max_files=None, dry_run=False, log=print, progress=None):
    """Sync several courses with one shared manifest. Returns the finished CourseSync objects (failed ones too)."""
    manifest = load_json(MANIFEST_PATH, {})
    claimed, done = {}, []
    try:
        for c in courses:
            cs = CourseSync(m, c, manifest, claimed, max_size_mb=max_size_mb, max_files=max_files, dry_run=dry_run,
                            log=log, progress=(lambda d, t, n, c=c: progress(c, d, t, n)) if progress else None)
            try:
                cs.run()
                cs.error = None
            except (MoodleError, requests.RequestException) as e:
                cs.error = m.scrub(e)
                log(f"    FAILED to read course contents: {cs.error}")
            done.append(cs)
    finally:
        if not dry_run:
            save_json(MANIFEST_PATH, manifest)
    return done


def forget(n, course_dir_rel=None):
    """Drop n PDFs from the manifest so the next sync downloads them again (for recording a demo sync)."""
    manifest = load_json(MANIFEST_PATH, {})
    keys = [k for k, v in manifest.items() if v["path"].lower().endswith(".pdf")
            and (not course_dir_rel or v["path"].startswith(course_dir_rel))][-n:]
    for k in keys:
        del manifest[k]
    save_json(MANIFEST_PATH, manifest)
    return len(keys)
