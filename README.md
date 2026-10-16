# Noodle

Moodle hides your course behind a hundred clicks. Noodle syncs it to your laptop with one button and turns it into a study workspace: read and highlight your lecture PDFs, take linked notes, see the whole module as a map, and ask questions that are answered only from your own files, with the page each answer came from.

Built for a student hackathon ("something to help students") and tested on UCL Moodle. It works with any Moodle site that allows the official Moodle app.

## What it does

- **One-click sync.** Log in through Moodle's own page, tick your courses, press **Sync**. Files, Moodle pages, section text, assignment briefs, announcements and deadlines land in a tidy folder on your laptop. A second sync only fetches what changed. Files over 100 MB, and the few that Moodle's bot protection blocks, stay listed with an **Open in Moodle** button.
- **Library.** Course → weeks → files, colour-coded by type (lecture, tutorial, past paper, assignment, reading). Filter with chips, or search by words **and by meaning**: "why do rockets need a wider exit" finds the Lecture 7 slide on why exit nozzles have that shape.
- **Read and highlight.** PDFs open in the app. Select text and press **Highlight**: the quote goes into that file's note with a `p.N` link back to the page. Moodle pages open as clean, readable text; slides and Word files open in their Windows app.
- **Linked notes.** Plain Markdown files, Obsidian-compatible. Type `[[` to link a lecture or another note. Open the same folder in Obsidian whenever you like.
- **Course graph.** Every file, note and topic in the module on one map. Files are linked by the topics they share and by your notes; hover to focus, click a topic to see its summary and the files that cover it.
- **Ask.** Answers come only from your files, with citation chips like "Lecture 7 — p.36" that open the PDF at that page. If the answer isn't in your files, Noodle says so and shows the closest pages instead of guessing.
- **Coming next (preview pages):** a Timeline of weeks, deadlines and announcements, and Friends, for sharing notes with classmates.

## How the AI works in this build

Be clear about this before watching the video:

- **Search by meaning is live.** A small embedding model (`BAAI/bge-small-en-v1.5`, via fastembed) runs on the laptop and indexes every page at sync time. Keyword search uses SQLite FTS5. No API key, no cost.
- **Tags, topics and the Ask answers in the video are pre-generated.** We had no API key for the hackathon, so Claude (in Claude Code) read the real course files once and wrote the file tags, the topics per file, a one-line summary per topic, and the answers to three demo questions with their page citations. The app loads that data from `.noodle/demo/`. The pages retrieved under each answer are found live by the local search. Any other question gets a friendly message listing the demo questions.
- **Live mode is one API key away** (not built yet):
  - Claude Haiku 5.5 would tag each file and extract its topics once, at sync time: about $0.001 per file, so roughly $0.05–0.10 for one course.
  - Ask would send the ~10 best-matching pages to Claude Opus 5.5 (or Sonnet 5.5) with the Citations feature turned on, each page titled "file — p.N", so every claim links to a real page. About $0.07–0.10 per question on Opus 5.5, $0.03–0.05 on Sonnet 5.5.

## Run it (Windows)

You need Python 3.11+ and Node 22+.

```powershell
pip install -r requirements.txt
.\start.ps1
```

`start.ps1` installs the web app's packages the first time, builds it, starts the backend and opens http://localhost:8765. On first launch Noodle shows the login screen: enter your Moodle site, press **Open Moodle login**, sign in, then copy the "launch the app" link from the confirmation page and paste it into Noodle. Your password never reaches Noodle; the token is saved in `.noodle/config.json` on your laptop.

For development, run the backend and the Vite dev server separately:

```powershell
python -m uvicorn noodle.app:app --app-dir backend --port 8765
npm --prefix frontend run dev        # http://localhost:5173, proxies /api to the backend
python -m pytest backend/tests -q    # backend smoke tests
```

Prefer the command line? `python sync_check.py --course <id>` runs the same sync and index (`--dry-run` lists what would download, `--help` shows the rest).

**Antivirus HTTPS scanning** (e.g. Avast) re-signs TLS traffic. Noodle's HTTP clients trust the Windows certificate store, so this works out of the box. If `npm install` fails with certificate errors, run it with `NODE_OPTIONS=--use-system-ca`.

## How it's built

| Part | What |
|---|---|
| `backend/noodle/moodle.py`, `sync.py` | Moodle web-service client and course sync. Page HTML comes from the API, assignment dates from the course contents plus submission status, labels become a section overview. Requests are sequential with a pause. |
| `backend/noodle/index.py`, `search.py` | PyMuPDF text per page, SQLite FTS5, local embeddings, hybrid ranking (reciprocal rank fusion). |
| `backend/noodle/notes.py`, `graph.py` | Markdown notes with `[[wikilinks]]`, highlight quotes, and the course graph. |
| `backend/noodle/app.py` | FastAPI routes; also serves the built web app. |
| `frontend/` | React + Vite: `react-pdf` viewer with a custom highlight layer, `react-force-graph-2d`, CodeMirror with `[[` autocomplete. |

Everything private stays out of git: `vault/` (your course files and notes), `.noodle/` (token, sync manifest, search index, pre-generated demo data) and `.env`.

## Ground rules we kept

- Noodle never tries to get around Moodle's bot protection. Files it blocks are shown as **Open in Moodle** links.
- You do every Moodle login yourself, in your own browser.
- Course material is copyrighted, so none of it is in this repository, including the pre-generated demo answers that quote it.

## Limitations

- Tested on UCL Moodle only.
- The graph shows one course at a time.
- Highlights work on PDFs only; slides and Word files open in their own apps.
- Timeline and Friends are previews: Timeline uses the course's real dates, Friends uses sample data.
