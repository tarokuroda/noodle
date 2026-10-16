"""Moodle web-service client and login helpers (moved from sync_check.py, proven against UCL).

Cloudflare sits in front of UCL Moodle: login/token.php and the public config are bot-checked for scripts,
so the only login that works is the browser SSO flow ending in a moodlemobile://token=... link that the
user pastes. Never try to get around the bot check.
"""

import base64
import hashlib
import html
import json
import os
import re
import ssl
from urllib.parse import unquote

import certifi
import requests
import truststore
from requests.adapters import HTTPAdapter

# Trust the Windows certificate store everywhere, before any SSLContext exists: injecting it later (the embedding
# model download does) breaks contexts made earlier with a RecursionError on every new connection.
truststore.inject_into_ssl()

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
http.headers["User-Agent"] = "noodle/0.1"


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


# ---------- site check + login ----------

def probe_site(site):
    """Ask the site how the Moodle app should log in. Needs no account. Returns the config plus 'warnings'."""
    body = [{"index": 0, "methodname": "tool_mobile_get_public_config", "args": {}}]
    try:
        r = http.post(f"{site}/lib/ajax/service-nologin.php", params={"info": "tool_mobile_get_public_config"},
                      json=body, timeout=TIMEOUT)
    except requests.ConnectionError as e:
        raise MoodleError(f"Can't reach {site} ({type(e).__name__}). Check the site URL.")
    if r.headers.get("cf-mitigated") == "challenge":
        return {"bot_check": True, "warnings": [
            "Cloudflare's bot check blocks the login endpoints for scripts, so logging in through your browser."]}
    try:
        r.raise_for_status()
        reply = r.json()[0]
    except (requests.RequestException, ValueError, LookupError) as e:
        return {"warnings": [f"Could not read the public config ({e}). Mobile web services may be disabled, "
                             "or the URL is wrong. Trying to log in anyway."]}
    if reply.get("error"):
        return {"warnings": [f"Public config error: {reply.get('exception', {}).get('message')}"]}
    cfg = reply.get("data") or {}
    warnings = []
    if cfg.get("enablemobilewebservice") in (0, False):
        warnings.append("Mobile web services are DISABLED on this site - the app API will not work here.")
    if cfg.get("maintenanceenabled"):
        warnings.append("Site is in maintenance mode.")
    cfg["warnings"] = warnings
    return cfg


def launch_url(site, passport):
    # confirmed=1 makes Moodle show a page with a "Click here to launch the app" link
    # instead of silently redirecting to moodlemobile://, which browsers just ignore.
    return (f"{site}/admin/tool/mobile/launch.php?service={SERVICE}&passport={passport}"
            f"&urlscheme=moodlemobile&confirmed=1")


def parse_app_link(text, site, passport):
    """Pull the token out of a moodlemobile://token=<base64> link (or accept a bare token).

    Returns (token, signature_ok)."""
    text = text.strip()
    if re.fullmatch(r"[0-9a-fA-F]{32}", text):
        return text, True
    m = re.search(r"token=([A-Za-z0-9+/=%_-]+)", text)
    if not m:
        raise ValueError("no 'token=' in it")
    blob = unquote(m.group(1))
    decoded = base64.b64decode(blob + "=" * (-len(blob) % 4)).decode()
    signature, token = decoded.split(":::")[:2]
    return token, signature == hashlib.md5((site + str(passport)).encode()).hexdigest()


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
            hint = " (token rejected - log in again)" if reply.get("errorcode") == "invalidtoken" else ""
            raise MoodleError(f"{function}: {reply.get('message')} [{reply.get('errorcode')}]{hint}")
        return reply

    def download(self, fileurl, dest):
        with http.get(fileurl, params={"token": self.token}, stream=True, timeout=TIMEOUT) as r:
            if r.headers.get("cf-mitigated") == "challenge":
                raise BlockedError("blocked by Cloudflare's bot check")
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


class BlockedError(MoodleError):
    """Cloudflare's bot check answered instead of the file. Shown as 'Open in Moodle'; never worked around."""
