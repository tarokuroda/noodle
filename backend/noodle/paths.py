"""Where Noodle keeps things. Everything private lives in .noodle/ and vault/, both gitignored.

NOODLE_PROFILE=<name> runs a second person on the same laptop (for trying Friends with yourself): their database,
friends list and notes move to .noodle/profiles/<name>/, while the Moodle login, the synced course files and the
caches stay shared.
"""

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHARED_DIR = ROOT / ".noodle"
PROFILE = re.sub(r"[^\w-]", "", os.environ.get("NOODLE_PROFILE", ""))[:32]
STATE_DIR = SHARED_DIR / "profiles" / PROFILE if PROFILE else SHARED_DIR
CONFIG_PATH = SHARED_DIR / "config.json"
MANIFEST_PATH = SHARED_DIR / "manifest.json"
MAIN_DB_PATH = SHARED_DIR / "noodle.db"
DB_PATH = STATE_DIR / "noodle.db"
FRIENDS_PATH = STATE_DIR / "friends.json"
DEMO_DIR = SHARED_DIR / "demo"
MODELS_DIR = SHARED_DIR / "models"
CONVERTED_DIR = SHARED_DIR / "converted"  # slides and Word docs as PDF, named by the source file's sha1
VAULT = ROOT / "vault"
NOTES_ROOT = STATE_DIR if PROFILE else ROOT  # notes live in <NOTES_ROOT>/<course dir>/Notes/
NOTES_DIRNAME = "Notes"
