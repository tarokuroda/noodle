"""Friends: share notes and highlights through a folder that you and your friends all sync, such as a OneDrive
folder shared with classmates. No accounts and no server.

    <folder>/people/<id>.json    one card per person: {id, name, color, updated}
    <folder>/shares/<id>.json    one bundle per share: who from, who to, the notes and their highlights

Only notes and highlights travel, never course files (they're copyrighted). A highlight carries its file's hash,
name and place in the course, and each friend's Noodle finds its own copy of that file by hash, else by name.
Each laptop only writes its own card and its own shares, so the cloud folder never has two writers on one file.
Bundles are built from named fields only: the Moodle token and keys never go in.
"""

import json
import os
import secrets
import time
from pathlib import Path

from . import notes
from .db import connect
from .moodle import load_json, save_json
from .paths import FRIENDS_PATH, NOTES_DIRNAME, NOTES_ROOT, PROFILE, ROOT

COLORS = ["#4f5bd5", "#2fa36b", "#d6336c", "#f08c00", "#8e4ec6", "#1c7ed6", "#0ca678"]


def state():
    return load_json(FRIENDS_PATH, {})


def save(st):
    save_json(FRIENDS_PATH, st)


def suggested_folder():
    base = os.environ.get("OneDriveCommercial") or os.environ.get("OneDrive")
    return str(Path(base) / "Noodle Friends") if base else ""


def _folder(st):
    if not st.get("me") or not st.get("folder"):
        raise ValueError("Set up Friends first: pick your name and the shared folder.")
    return Path(st["folder"])


def _write(path, data):
    """Write a whole file at once, so a syncing cloud folder never sees half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _read_all(folder):
    out = []
    for p in sorted(folder.glob("*.json")) if folder.exists() else []:
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):  # still syncing, or not ours: skip it this time
            continue
    return out


# ---------- you and your friends ----------

def setup(name, folder):
    name = " ".join((name or "").split())[:40]
    if not name:
        raise ValueError("Tell your friends who you are.")
    path = Path(os.path.expandvars((folder or "").strip().strip('"'))).expanduser()
    if not path.is_absolute():
        raise ValueError("Pick the full path of a folder, for example in your OneDrive.")
    try:
        (path / "people").mkdir(parents=True, exist_ok=True)
        (path / "shares").mkdir(exist_ok=True)
    except OSError as e:
        raise ValueError(f"Noodle can't use that folder ({e.strerror}).")
    st = state()
    me = st.get("me") or {"id": secrets.token_hex(4)}
    me.update(name=name, color=me.get("color") or COLORS[int(me["id"], 16) % len(COLORS)])
    st.update(me=me, folder=str(path))
    st.setdefault("friends", {})
    st.setdefault("imported", {})
    save(st)
    _write(path / "people" / f"{me['id']}.json", {**me, "updated": time.time()})
    return overview()


def people(st):
    me = st.get("me", {}).get("id")
    return [c for c in _read_all(_folder(st) / "people") if c.get("id") and c.get("id") != me]


def add(friend_id):
    st = state()
    card = next((c for c in people(st) if c["id"] == friend_id), None)
    if card is None:
        raise ValueError("That person isn't in the shared folder (yet). Ask them to set up Noodle with it.")
    st["friends"][friend_id] = {"name": card.get("name") or "Friend", "color": card.get("color") or COLORS[0],
                                "added": time.time()}
    save(st)
    return overview()


def remove(friend_id):
    st = state()
    st.get("friends", {}).pop(friend_id, None)
    save(st)
    return overview()


# ---------- sharing ----------

def _course_of(note_file):
    """The synced course whose Notes folder holds this note."""
    for c in connect().execute("SELECT * FROM courses"):
        if (NOTES_ROOT / c["dir"] / NOTES_DIRNAME).resolve() == note_file.parent.resolve():
            return c
    raise ValueError("That note isn't in a synced course.")


def bundle(note_paths, me, to):
    """The share: notes plus your own highlights in them. Nothing else from this laptop goes in."""
    conn = connect()
    course, out_notes, out_highlights = None, [], []
    for rel in note_paths:
        p = notes.note_path(rel)
        c = _course_of(p)
        course = course or c
        if c["id"] != course["id"]:
            raise ValueError("Share notes from one course at a time.")
        out_notes.append({"title": p.stem, "content": p.read_text(encoding="utf-8")})
        for h in conn.execute("SELECT h.page, h.rects, h.text, h.file_hash, f.path, f.ext, f.hash FROM highlights h "
                              "JOIN files f ON f.id=h.file_id WHERE h.note_path=? AND h.friend_id IS NULL ORDER BY h.id",
                              (rel,)):
            prefix = course["dir"] + "/"
            out_highlights.append({
                "note": p.stem, "page": h["page"], "rects": json.loads(h["rects"]), "text": h["text"],
                "file": {"hash": h["file_hash"] or h["hash"], "name": Path(h["path"]).name, "ext": h["ext"],
                         "relpath": h["path"][len(prefix):] if h["path"].startswith(prefix) else Path(h["path"]).name},
            })
    if not out_notes:
        raise ValueError("Pick at least one note to share.")
    return {"kind": "noodle-share", "version": 1, "id": secrets.token_hex(6), "created": time.time(),
            "from": {k: me[k] for k in ("id", "name", "color")}, "to": to,
            "course": {"shortname": course["shortname"], "fullname": course["fullname"]},
            "notes": out_notes, "highlights": out_highlights}


def share(note_paths, to_ids):
    st = state()
    folder = _folder(st)
    to = [i for i in to_ids if i in st.get("friends", {})]
    if not to:
        raise ValueError("Pick at least one friend to share with.")
    b = bundle(note_paths, st["me"], to)
    _write(folder / "shares" / f"{b['id']}.json", b)
    return {"id": b["id"], "notes": len(b["notes"]), "highlights": len(b["highlights"])}


def match_file(conn, info, course_dir):
    """Your copy of a friend's file: same content hash, else the same place in the course, else the same name."""
    if info.get("hash"):
        r = conn.execute("SELECT id FROM files WHERE hash=? AND status='ok' AND twin_id IS NULL", (info["hash"],)).fetchone()
        if r:
            return r["id"]
    if course_dir:
        r = conn.execute("SELECT id FROM files WHERE path=? AND status='ok'", (f"{course_dir}/{info.get('relpath')}",)).fetchone()
        if r:
            return r["id"]
        rows = conn.execute("SELECT id, path FROM files WHERE path LIKE ? AND status='ok' AND twin_id IS NULL",
                            (f"{course_dir}/%",)).fetchall()
        same = [r["id"] for r in rows if Path(r["path"]).name.lower() == (info.get("name") or "").lower()]
        if len(same) == 1:
            return same[0]
    return None


def _summary(b, st, conn):
    course = conn.execute("SELECT dir FROM courses WHERE shortname=?", (b["course"]["shortname"],)).fetchone()
    matched = sum(1 for h in b["highlights"] if match_file(conn, h["file"], course["dir"] if course else None))
    names = {i: f["name"] for i, f in st.get("friends", {}).items()}
    imported = st.get("imported", {}).get(b["id"])
    return {"id": b["id"], "created": b["created"], "from": b["from"], "to": [names.get(i, "a friend") for i in b["to"]],
            "course": b["course"]["shortname"].split("_")[0], "have_course": bool(course),
            "notes": [n["title"] for n in b["notes"]], "highlights": len(b["highlights"]), "matched": matched,
            "imported": imported["notes"] if imported else None}


def overview():
    st = state()
    base = {"profile": PROFILE, "suggested_folder": suggested_folder()}
    if not st.get("me"):
        return {**base, "me": None}
    folder = Path(st["folder"])
    if not folder.exists():
        return {**base, "me": st["me"], "folder": str(folder), "folder_missing": True, "friends": [], "people": [],
                "inbox": [], "sent": []}
    me, friends = st["me"]["id"], st.get("friends", {})
    shares = [b for b in _read_all(folder / "shares") if b.get("kind") == "noodle-share" and b.get("from")]
    conn = connect()
    inbox = [_summary(b, st, conn) for b in shares if me in b.get("to", []) and b["from"].get("id") in friends]
    sent = [_summary(b, st, conn) for b in shares if b["from"].get("id") == me]
    cards = {c["id"]: c for c in people(st)}
    return {**base, "me": st["me"], "folder": str(folder),
            "friends": [{"id": i, **f, "in_folder": i in cards} for i, f in friends.items()],
            "people": [c for i, c in cards.items() if i not in friends],
            "inbox": sorted(inbox, key=lambda s: -s["created"]), "sent": sorted(sent, key=lambda s: -s["created"])}


def import_share(share_id):
    """Add a friend's share to your notes: the notes are copied in and their highlights land on your own files."""
    st = state()
    folder = _folder(st)
    b = next((x for x in _read_all(folder / "shares") if x.get("id") == share_id), None)
    if not b or st["me"]["id"] not in b.get("to", []) or b["from"].get("id") not in st.get("friends", {}):
        raise ValueError("That share isn't for you, or it's from someone you haven't added.")
    conn = connect()
    course = conn.execute("SELECT * FROM courses WHERE shortname=?", (b["course"]["shortname"],)).fetchone()
    if course is None:
        raise ValueError(f"Sync {b['course']['shortname'].split('_')[0]} first, so the highlights have files to land on.")
    old = st.get("imported", {}).get(share_id)  # importing again replaces the earlier copy
    conn.execute("DELETE FROM highlights WHERE share_id=?", (share_id,))
    for rel in (old or {}).get("notes", []):
        (ROOT / rel).unlink(missing_ok=True)

    who = b["from"]["name"]
    stamp = time.strftime("%d %b %Y", time.localtime(b["created"]))
    d = NOTES_ROOT / course["dir"] / NOTES_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    paths = {}
    for n in b["notes"]:
        p = d / f"{notes.safe_title(n['title'] + f' (from {who})')}.md"
        lines = n["content"].splitlines()
        head = lines[:1] if lines and lines[0].startswith("# ") else []
        body = "\n".join(head + ["", f"*Shared by {who} on {stamp}.*", ""] + lines[len(head):])
        p.write_text(body.rstrip("\n") + "\n", encoding="utf-8")
        paths[n["title"]] = p.relative_to(ROOT).as_posix()
    matched = 0
    for h in b["highlights"]:
        fid = match_file(conn, h["file"], course["dir"])
        if not fid:
            continue
        matched += 1
        conn.execute("INSERT INTO highlights(file_id, file_hash, page, rects, text, note_path, created, friend_id, "
                     "friend_name, share_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (fid, h["file"].get("hash"), h["page"], json.dumps(h["rects"]), h["text"],
                      paths.get(h["note"]), time.time(), b["from"]["id"], who, share_id))
    conn.commit()
    st.setdefault("imported", {})[share_id] = {"notes": list(paths.values()), "at": time.time()}
    save(st)
    return {"notes": list(paths.values()), "matched": matched, "unmatched": len(b["highlights"]) - matched,
            "course_id": course["id"]}
