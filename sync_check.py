"""Command-line sync (the app's Sync button runs the same code from backend/noodle).

    python sync_check.py --site https://moodle.example.ac.uk   # first run: log in, then sync
    python sync_check.py --dry-run                              # show what would download
    python sync_check.py --course 1234 --max-files 20           # limit scope
    python sync_check.py --max-size 50                          # skip files over 50 MB (default 100)
    python sync_check.py --token <TOKEN>                        # token from Moodle > Preferences > Security keys
    python sync_check.py --relogin                              # ignore the saved token
    python sync_check.py --forget 3 --course 1234               # re-download 3 PDFs next sync (demo recording)

Site + token are saved in .noodle/config.json, everything goes to vault/<course>/:
files and pages, "_Section overview.html" (section text + labels), "<assignment>/_Brief.html",
"Announcements/", and "_dates.json" (opens / due / closes dates for the timeline).
After syncing, the files are indexed for the app (page text, keyword + meaning search).
Run it twice: the second run should download nothing.
"""

import argparse
import getpass
import html
import secrets
import sys
import time
from collections import Counter
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from noodle.index import index_sync  # noqa: E402
from noodle.moodle import (LOGIN_TYPES, NEEDED_FUNCTIONS, SERVICE, Moodle, MoodleError, http,  # noqa: E402
                           launch_url, load_json, mask, normalize_site, parse_app_link, probe_site, save_json)
from noodle.paths import CONFIG_PATH, ROOT, VAULT  # noqa: E402
from noodle.sync import course_dir, forget, is_deadline, sync_courses, when  # noqa: E402


def fmt(counter, skip=()):
    return ", ".join(f"{k} {v}" for k, v in counter.most_common() if k not in skip) or "none"


def password_login(site):
    username = input("  Moodle username (leave blank to log in through the browser instead): ").strip()
    if not username:
        return None
    password = getpass.getpass("  Password (not saved): ")
    r = http.post(f"{site}/login/token.php", data={"username": username, "password": password, "service": SERVICE},
                  timeout=60)
    try:
        reply = r.json()
    except ValueError:
        print(f"  ! login/token.php answered HTTP {r.status_code} with something that isn't JSON.")
        return None
    if reply.get("token"):
        return reply["token"]
    print(f"  ! Password login failed: {reply.get('error') or reply.get('errorcode') or reply}")
    return None


def browser_login(site):
    passport = str(secrets.randbelow(10**9))
    print(f"""
  Browser / SSO login:
    1. Open this link in your browser and log in if asked:
         {launch_url(site, passport)}
    2. You should land on a "confirmed" page with a link like "Click here to launch the app" or
       "Click here if the app does not open automatically".
       Right-click that link -> "Copy link address". (Clicking it does nothing - that's fine.)
       If there's no such page: press F12, reopen the link, and look in Console for
       "Failed to launch 'moodlemobile://token=...'".
    3. Paste the moodlemobile://token=... link below.
""")
    pasted = input("  moodlemobile://token=... link: ").strip()
    try:
        token, signature_ok = parse_app_link(pasted, site, passport)
    except (ValueError, IndexError) as e:
        print(f"  ! Couldn't read a token from that ({e}). Try again, or Ctrl+C to quit.")
        return None
    if not signature_ok:
        print("  ! Signature doesn't match this login attempt (old link, or a different site URL). Using it anyway.")
    return token


def login(site, public_cfg):
    token = None
    if public_cfg.get("typeoflogin") in (2, 3):
        print("  This site uses SSO, so logging in through the browser.")
    elif not public_cfg.get("bot_check"):
        token = password_login(site)
    while not token:
        token = browser_login(site)
    return token


def main():
    sys.stdout.reconfigure(errors="replace")
    p = argparse.ArgumentParser(description="Sync Moodle courses into vault/.")
    p.add_argument("--site", help="your Moodle URL, e.g. https://moodle.example.ac.uk")
    p.add_argument("--token", help="use this web-service token instead of logging in")
    p.add_argument("--relogin", action="store_true", help="ignore the saved token and log in again")
    p.add_argument("--dry-run", action="store_true", help="list what would be downloaded, download nothing")
    p.add_argument("--course", type=int, action="append", help="only sync this course id (repeatable)")
    p.add_argument("--max-files", type=int, help="stop after downloading this many files")
    p.add_argument("--max-size", type=float, default=100, metavar="MB", help="skip files bigger than this (default 100)")
    p.add_argument("--forget", type=int, metavar="N", help="forget N downloaded PDFs so the next sync fetches them again")
    p.add_argument("--no-index", action="store_true", help="don't update the app's search index after syncing")
    args = p.parse_args()

    saved = load_json(CONFIG_PATH, {})
    site = normalize_site(args.site or saved.get("site", ""))
    if not site:
        p.error("first run needs --site, e.g. --site https://moodle.example.ac.uk")

    print("[1/5] Checking the site")
    public = probe_site(site)
    for w in public.get("warnings", []):
        print(f"  ! {w}")
    if public.get("sitename"):
        print(f"  Site:       {public.get('sitename')}  ({public.get('wwwroot')})")
        print(f"  Login type: {LOGIN_TYPES.get(public.get('typeoflogin'), public.get('typeoflogin'))}")
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
    save_json(CONFIG_PATH, {**saved, "site": site, "token": token})
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

    if args.forget:
        for c in courses:
            n = forget(args.forget, course_dir(c).relative_to(ROOT).as_posix())
            print(f"  Forgot {n} PDF(s) of {c['shortname']}: the next sync downloads them again.")
        return

    print(f"[5/5] {'Listing' if args.dry_run else 'Syncing'} into {VAULT.relative_to(ROOT)}/")
    results = sync_courses(m, courses, max_size_mb=args.max_size, max_files=args.max_files, dry_run=args.dry_run)
    totals, text, text_state, not_synced, dates = Counter(), Counter(), Counter(), Counter(), []
    for cs in results:
        print(f"\n  == {html.unescape(cs.course.get('fullname', ''))} (id {cs.course['id']})")
        if cs.error:
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

    if not args.dry_run and not args.no_index:
        print("\nIndexing for the app")
        print(f"  {dict(index_sync(results))}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(130)
    except (MoodleError, requests.RequestException) as e:
        print(f"\nERROR: {e}")
        sys.exit(1)
