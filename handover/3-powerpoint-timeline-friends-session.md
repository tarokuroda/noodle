# Prompt for session 3: PowerPoint support, real Timeline, real Friends

Written at the end of session 2 (Fri 16 Oct 2026, 13:46). Start a new Claude Code session in `C:\Users\iamta\Documents\noodle`, switch it to **plan mode**, and paste everything below the line.

---

You're continuing my hackathon project, Noodle. Session 2 built the whole MVP; it's committed on `main` and public at https://github.com/tarokuroda/noodle. I now want three more things: **PowerPoint support**, a **Timeline that works properly** and **Friends that works properly**.

Before planning, read these in full:
- `README.md`: what Noodle is today.
- `handover/REQUIREMENTS.md`: the original decisions. **This request overrides three of its "Won't" items:** converting slides to PDF, a real Timeline, and real Friends sharing. Everything else in it still holds.
- `handover/CONTEXT.md`: UCL Moodle quirks and environment.
- The "State of the code" section at the end of this prompt.

## 1. PowerPoint support
**Now:** `.pptx` files open in their Windows app; nothing in them is searchable, highlightable or citable.

**What we checked:**
- PowerPoint is installed (`C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE`). LibreOffice is not.
- Already installed in Python: `pywin32` 306 and `python-pptx` 1.0.2.
- MECH0024 has 9 decks:
  - Lectures 1–3 (weeks 1–3) exist **only** as `.pptx`, so those weeks have no searchable lecture content today.
  - Lectures 4–8 have both a `.pptx` and a same-name `.pdf`.
  - `QMUL+UCLWindTunnel.pptx` is 494 MB, so it's skipped by the 100 MB cap.
  - There's also one tiny `.docx`.
- The pre-generated tags and topics in `.noodle/demo/ai.json` already cover the `.pptx` paths.

**Suggested approach (your call):**
- At index time, convert each `.pptx` (and `.docx`) to PDF:
  - Use PowerPoint COM: `pythoncom.CoInitialize()`, `Presentations.Open(path, ReadOnly=True, WithWindow=False)`, `SaveAs(out, 32)`. Word uses `ExportAsFixedFormat`.
  - Run one file at a time, with a timeout.
  - Cache the output in a gitignored place, e.g. `.noodle/converted/<sha1>.pdf`, and skip conversion when the hash hasn't changed.
- If conversion fails, fall back to `python-pptx` text with one page per slide, so search and Ask still work.
- Converted decks open in the existing PDF viewer, with page navigation, highlights, notes, search, Ask retrieval and graph. Keep an "Open in PowerPoint" button.
- Decide how to show decks that have a PDF twin, so search results and the graph don't show every lecture twice.

**Done when:**
- Lectures 1–3 open in the in-app viewer.
- A highlight on a slide lands in that deck's note.
- A search for a phrase from Lecture 2 finds the right slide.
- `python sync_check.py --course 49542` and the app's Sync both convert new decks.

## 2. Timeline that works properly
**Now:** a "Preview" page built only from MECH0024: week titles (dates parsed from the titles), `_dates.json` and announcements. MECH0024 is a 2025/26 course, so every date is in the past.

**Make it real:**
- Show upcoming deadlines and events across my enrolled courses, from Moodle's read-only calendar functions, which this token can call. Examples: `core_calendar_get_action_events_by_timesort` (with `timesortfrom` = now), `core_calendar_get_calendar_events` and `core_calendar_get_calendar_monthly_view`.
- **Only call `get` functions.** Never call `core_calendar_create_calendar_events` or `core_calendar_delete_calendar_events`.
- Cache the results and keep requests sequential and few.
- Add a "Today" marker, an Upcoming/Past switch and a course filter.
- Link each item to its file in Noodle when we have it, otherwise to Moodle.
- Show submission status where it's cheap: `mod_assign_get_submission_status` is already used by the sync. `mod_assign_get_assignments` is broken at UCL.
- Refresh on Sync and when the page opens (cached for about 10 minutes). Keep working offline from the last cached data.
- Remove the Preview badge.

**Done when:** the Timeline lists my real upcoming deadlines, the dates match Moodle, and past MECH0024 items still show under Past.

## 3. Friends that works properly
**Now:** a "Preview" page with fictional sample data.

**First, ask me how sharing should travel between laptops.** This needs something shared between machines, and that's my decision. Options to put to me, with your recommendation:
- **(a) Supabase (free tier):**
  - Email magic-link login.
  - Postgres tables: profiles, friends or groups, shared notes, shared highlights, with row-level security.
  - The keys go in a gitignored `.env`.
  - I create the Supabase project and sign in myself. You never create accounts or type credentials.
- **(b) A shared cloud folder** (OneDrive, Google Drive or Dropbox) that friends both sync. Noodle reads and writes JSON bundles there. No accounts, no server.
- **(c) Export/import a share file** that I send however I like.

**Rules for any option:**
- Share **notes and highlights only, never course files** (they're copyrighted).
- Match a friend's highlight to my own copy of the file by content hash, falling back to the file name.
- Every share is an explicit action; I choose which note or course to share.
- The Moodle token and any keys never leave my laptop.

**Testing on one laptop:** let a second instance run with its own state (for example a `NOODLE_PROFILE` environment variable that moves `.noodle/` and the notes folder) on another port.

**Done when:** two instances can add each other, one shares a note with highlights, and the other sees the note and the highlights on its own copy of the PDF.

## Planning (plan mode)
- Plan the three features in this order: PowerPoint (smallest, and it fills weeks 1–3), Timeline, then Friends (largest; needs my decision).
- For each feature, list the files to change, how you'll verify it, and the risks.
- Only ask me what's genuinely open: the Friends sharing method, how to show `.pptx`/`.pdf` twins, and anything else this prompt doesn't settle. Then present the plan.

## Implementing
- Work feature by feature and keep the task list updated.
- After each feature: run `python -m pytest backend/tests -q`, click through the feature at desktop size (see screenshots below), and **commit to `main`**.
- **Keep the demo path working.** The demo path is: Library, search, PDF highlight → note → `[[link]]`, Ask with citations, Graph, Sync.
- If the hackathon code freeze (17:15 on 16 Oct) is close and a feature isn't finished, leave the Preview version showing behind a flag rather than shipping it half-done.
- Update `README.md`: drop "preview" for whatever becomes real, and explain the PowerPoint conversion and how Friends shares.
- **Ask me before every `git push`.** The repo is public.
- Stop and ask if something turns out much bigger than planned.

## Rules (unchanged)
- **Never try to get around Cloudflare's bot check.** Blocked files stay "Open in Moodle" links.
- **Never type my Moodle password**, and never create accounts or enter credentials anywhere. I do every login myself. The saved token is for read-only API calls and downloads of my own courses, sequential and gentle.
- **Never commit** `vault/`, `.noodle/`, `.env` or keys. Before every commit, check `git status` and `git ls-files`.
- **Avast re-signs TLS.**
  - Python: use the existing `OSTrustAdapter` for `requests`, or `truststore.inject_into_ssl()`. This applies to `httpx`/`supabase` too.
  - Node: if you see certificate errors, use `NODE_OPTIONS=--use-system-ca`.
- Windows 11, Python 3.11.4, Node 22.15.0. There's no Claude API key and no live Claude API calls, unless I say otherwise.
- **Clean up after testing.** Delete the notes and highlights your tests create: notes in `vault/MECH0024_25-26/Notes/`, highlights in the `highlights` table. The vault is my real data.

## State of the code (end of session 2)
**Running it:**
- `.\start.ps1` builds the app and serves everything at http://localhost:8765.
- For development, run the backend and Vite separately (the "backend" and "frontend" entries in `.claude/launch.json`):
  - Backend: `python -m uvicorn noodle.app:app --app-dir backend --port 8765`.
  - Vite: `npm --prefix frontend run dev` at http://localhost:5173, which proxies `/api` to the backend.
- **Port 8000 is taken** by another program on this laptop. That's why the backend uses 8765.

**Restart the backend by hand after backend edits.** `uvicorn --reload` hung on this machine after the first reload.

**Backend** (`backend/noodle/`):

| File | What it holds |
|---|---|
| `moodle.py` | Moodle client, login helpers, `OSTrustAdapter` (moved from `sync_check.py`) |
| `sync.py` | `CourseSync`, which records every file as ok, skipped, blocked or failed; `sync_courses`; `forget` |
| `index.py` | PyMuPDF text per page, FTS5, fastembed `bge-small` vectors (model cached in `.noodle/models`) |
| `search.py` | Hybrid search with reciprocal-rank fusion |
| `notes.py` | Markdown notes in `vault/<course>/Notes/`; Obsidian `[[file.pdf#page=N\|p.N]]` links; `file_note`, `append_quote` |
| `graph.py` | The course graph |
| `demo.py` | Pre-generated tags, topics and Q&A from `.noodle/demo/*.json`; filename-rule fallback |
| `account.py` | Auth status, login link parsing, course list, background Sync job |
| `timeline.py` | The current preview Timeline |
| `app.py` | All `/api` routes, and serves `frontend/dist` last |

**Data:**
- SQLite at `.noodle/noodle.db`, with tables `courses`, `files` (`kind` is pdf/page/office/media/other), `pages`, `pages_fts`, `embeddings` and `highlights` (rects normalised to the page).
- `.noodle/config.json` holds the site, the token and `courses` (the ticked course ids).
- MECH0024 is course id **49542**: synced, 109 files, 782 pages indexed.

**Frontend** (`frontend/src/`, React 18 + Vite, plain JSX):

| File | What it holds |
|---|---|
| `App.jsx` | State: view, open file, side note, notes |
| `Sidebar.jsx` | Navigation, tag chips, search, file tree, notes |
| `Library.jsx` | `FileViewer`, `LibraryView` |
| `PdfViewer.jsx` | `react-pdf`, lazy pages, jump-to-page, highlight layer |
| `NotePanel.jsx` | Reading mode with link chips; CodeMirror editor with `[[` autocomplete |
| `Ask.jsx` | Ask view |
| `Graph.jsx` | `react-force-graph-2d` |
| `Courses.jsx` | Course picker and noodle-wave progress bar |
| `Login.jsx` | Login screen |
| `Timeline.jsx`, `Friends.jsx` | The preview pages |
| `styles.css` | Design tokens on `:root` |

The look is light and friendly: Fredoka and Nunito fonts, indigo, noodle-yellow and pink for topics.

**Gotchas learned in session 2:**
- **Screenshots:** the in-app browser pane is only about 450 px wide. For real desktop screenshots, `npm install puppeteer-core` in your scratchpad and drive the installed Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) headless at 1440×900. Wait for `/api/courses` before loading the page.
- **PDF scroller:** `.pdf-scroll` must keep `position: relative`, because page jumps use `offsetTop`. `jumpRef` re-aligns the target page while the pages above it finish rendering, and again on resize.
- **Shell heredocs:** long Bash heredocs with mixed quotes fail in this shell. Write patch scripts to a file and run them instead.
- **Clicking an office file in a test** launches it in its real Windows app on my screen.
