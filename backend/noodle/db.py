"""SQLite in .noodle/noodle.db: the file index, page text + FTS5, embeddings and highlights."""

import sqlite3
import threading

from .paths import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS courses(
  id INTEGER PRIMARY KEY, shortname TEXT, fullname TEXT, dir TEXT, synced_at REAL);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY, course_id INTEGER, path TEXT UNIQUE, url TEXT, name TEXT, ext TEXT, kind TEXT,
  section_num INTEGER, section TEXT, module TEXT, modname TEXT, moodle_url TEXT,
  size INTEGER, status TEXT, ord INTEGER, hash TEXT, pages INTEGER, indexed_mtime REAL);
CREATE TABLE IF NOT EXISTS pages(file_id INTEGER, page INTEGER, text TEXT, PRIMARY KEY(file_id, page));
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  text, file_id UNINDEXED, page UNINDEXED, tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS embeddings(file_id INTEGER, page INTEGER, vec BLOB, PRIMARY KEY(file_id, page));
CREATE TABLE IF NOT EXISTS highlights(
  id INTEGER PRIMARY KEY, file_id INTEGER, file_hash TEXT, page INTEGER, rects TEXT, text TEXT,
  note_path TEXT, created REAL);
"""

# Columns added after the first release; ensure_columns() adds them to an existing database.
ADDED_COLUMNS = {
    "files": {"twin_id": "INTEGER", "pdf": "TEXT"},  # a .pptx with a same-name PDF; a converted deck's PDF
}

_local = threading.local()


def ensure_columns(conn):
    for table, cols in ADDED_COLUMNS.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, kind in cols.items():
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")
    conn.commit()


def connect():
    """One connection per thread (FastAPI runs sync routes in a thread pool)."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        ensure_columns(conn)
        _local.conn = conn
    return conn
