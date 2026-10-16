"""Where Noodle keeps things. Everything private lives in .noodle/ and vault/, both gitignored."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT / ".noodle"
CONFIG_PATH = STATE_DIR / "config.json"
MANIFEST_PATH = STATE_DIR / "manifest.json"
DB_PATH = STATE_DIR / "noodle.db"
DEMO_DIR = STATE_DIR / "demo"
MODELS_DIR = STATE_DIR / "models"
VAULT = ROOT / "vault"
NOTES_DIRNAME = "Notes"
