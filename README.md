# Noodle

Moodle hides your course behind a hundred clicks. Noodle syncs it to your laptop with one button and turns it into a study workspace: read and highlight your lecture PDFs, take linked notes, see the whole module as a map, and ask questions that are answered only from your own files, with the page each answer came from.

Built for a student hackathon ("something to help students") and tested on UCL Moodle. It works with any Moodle site that allows the official Moodle app.

Noodle is built and tested on Windows. There's a Mac launcher too, but it hasn't been tried on a Mac yet: see [Get started (Mac)](#get-started-mac).

## What it does

- **One-click sync.** Log in through Moodle's own page, tick your courses, press **Sync**. Files, Moodle pages, section text, assignment briefs, announcements and deadlines land in a tidy folder on your laptop. A second sync only fetches what changed. Files over 100 MB, and the few that Moodle's bot protection blocks, stay listed with an **Open in Moodle** button.
- **Library.** Course → weeks → files, colour-coded by type (lecture, tutorial, past paper, assignment, reading). Filter with chips, or search by words **and by meaning**: "why do rockets need a wider exit" finds the Lecture 7 slide on why exit nozzles have that shape.
- **Read and highlight.** PDFs, slide decks and Word files open in the app. Select text and press **Highlight**: the quote goes into that file's note with a `p.N` link back to the page. Moodle pages open as clean, readable text. Every deck still has an **Open in PowerPoint** button.
- **Slides become PDFs.** At sync time Noodle asks PowerPoint (or Word) on your laptop to save each `.pptx` and `.docx` as a PDF, so slides are searchable, highlightable and citable like any lecture PDF (see below).
- **Linked notes.** Plain Markdown files, Obsidian-compatible. Type `[[` to link a lecture or another note. Open the same folder in Obsidian whenever you like.
- **Course graph.** Every file, note and topic in the module on one map. Files are linked by the topics they share and by your notes; hover to focus, click a topic to see its summary and the files that cover it.
- **Ask.** Answers come only from your files, with citation chips like "Lecture 7 — p.36" that open the PDF at that page. If the answer isn't in your files, Noodle says so and shows the closest pages instead of guessing.
- **Timeline.** Every deadline and event from all your Moodle courses in one list, with a **Today** marker, an Upcoming/Past switch and a course filter. Assignments show whether you've submitted. Each item opens its brief in Noodle when it's synced, otherwise its Moodle page. Past weeks, announcements and deadlines of your synced courses fill the Past side.
- **Friends.** Share a note, or all your notes for a course, with classmates. Their highlights show up in pink on your own copy of the slides, and their note lands next to yours, links and all. Only notes and highlights travel, never course files.

## How the AI works in this build

Be clear about this before watching the video:

- **Search by meaning is live.** A small embedding model (`BAAI/bge-small-en-v1.5`, via fastembed) runs on the laptop and indexes every page at sync time. Keyword search uses SQLite FTS5. No API key, no cost.
- **Tags, topics and the Ask answers in the video are pre-generated.** We had no API key for the hackathon, so Claude (in Claude Code) read the real course files once and wrote the file tags, the topics per file, a one-line summary per topic, and the answers to three demo questions with their page citations. The app loads that data from `.noodle/demo/`. The pages retrieved under each answer are found live by the local search. Any other question gets a friendly message listing the demo questions.
- **Live mode is one API key away** (not built yet):
  - Claude Haiku 5.5 would tag each file and extract its topics once, at sync time: about $0.001 per file, so roughly $0.05–0.10 for one course.
  - Ask would send the ~10 best-matching pages to Claude Opus 5.5 (or Sonnet 5.5) with the Citations feature turned on, each page titled "file — p.N", so every claim links to a real page. About $0.07–0.10 per question on Opus 5.5, $0.03–0.05 on Sonnet 5.5.

## Get started (Windows)

You don't need to install anything first.

1. **Download Noodle.** [Download the ZIP](https://github.com/tarokuroda/noodle/archive/refs/heads/main.zip), open your Downloads folder, right-click `noodle-main.zip` and choose **Extract All…**, then **Extract**.
2. **Start it.** In the extracted folder, double-click **Start Noodle**. If Windows asks whether to run it, choose **Run** (or **More info → Run anyway**).
3. **Wait a few minutes, once.** A black window sets Noodle up. The first time, it downloads what it needs (about 300 MB, and Noodle takes about 700 MB of disk). After that, Noodle starts in seconds, and there's a **Noodle** icon on your desktop to start it.
4. **Log in to Moodle.** Noodle opens in your browser. Enter your Moodle site (UCL is filled in), press **Open Moodle login** and sign in as usual. Moodle then shows a page with a "launch the app" link: right-click it, choose **Copy link address**, paste it into Noodle and press **Log in**. Noodle never sees your password.
5. **Sync.** Tick your courses and press **Sync**. Your files show up in the Library as they arrive.

Keep the black window open while you use Noodle. Close it to stop Noodle. Double-clicking **Start Noodle** while it's already running just opens it again.

Everything Noodle sets up stays inside its folder (Python and its packages in `.venv\`, helper tools in `.noodle\tools\`). Nothing is installed system-wide. To uninstall, delete the folder and the desktop icon.

**If something goes wrong,** the black window says what failed. Most failures are a dropped internet connection: run **Start Noodle** again and it carries on where it stopped.

### For developers

`Start Noodle.bat` runs `start.ps1`, which you can also run directly. It uses `uv` (your own if it's on PATH, otherwise a copy in `.noodle\tools\`) to create `.venv` and install `requirements.txt`. It builds the web app with your Node 18+ if you have one, otherwise with a portable Node in `.noodle\tools\`. Each step reruns only when its inputs change: `requirements.txt` for the packages, `frontend/src` and the package files for the build. The token from login is saved in `.noodle/config.json`.

To run the backend and the Vite dev server separately:

```powershell
.venv\Scripts\python -m uvicorn noodle.app:app --app-dir backend --port 8765
npm --prefix frontend run dev        # http://localhost:5173, proxies /api to the backend
.venv\Scripts\python -m pytest backend/tests -q    # backend smoke tests
```

Prefer the command line? `.venv\Scripts\python sync_check.py --course <id>` runs the same sync and index (`--dry-run` lists what would download, `--help` shows the rest).

### Timeline

Noodle reads your calendar with read-only Moodle functions, one after another: the deadlines that need you (`core_calendar_get_action_events_by_timesort`), every other event in the same window (`core_calendar_get_calendar_events`), and the submission status of assignments due in the next six months. It looks 30 days back and a year ahead, caches the result in `.noodle/timeline.json` for 10 minutes, refreshes after every Sync, and keeps showing the last saved copy when you're offline.

### Friends

Sharing runs through a folder that you and your friends all sync, such as a UCL OneDrive folder you share with classmates (they add it with **Add shortcut to My files**). No accounts and no server.

- **Set up.** On the Friends page, pick your name and the shared folder. Noodle writes your card to `people/<your code>.json` there; anyone else who sets up Noodle with the same folder appears under **In this folder**, and you **Add** each other.
- **Share.** Press **Share** on a note (or **Share notes** on the Friends page), tick friends and notes. Noodle writes one file to `shares/`: the notes' Markdown, and for each of your highlights the quote, page, position and the file's content hash and name. Nothing else goes in: no course files, and never your Moodle token.
- **Receive.** Shares from friends you've added appear under **Shared with you**. **Add to my notes** copies the note into your Notes folder as "… (from Maya)" and puts each highlight on your own copy of the file, found by content hash, else by its place in the course, else by name.
- **Privacy.** Anyone with access to the folder can read what's shared in it, so share the folder only with friends. Each laptop writes only its own files there, so the cloud drive never has two people editing one file.
- **Try it on one laptop.** Run a second Noodle as another person with its own database, notes and friends list (kept in `.noodle/profiles/friend/`):

  ```powershell
  .\start.ps1 -NoodleProfile friend -Port 8766 -NoBuild
  ```

### Slides and Word files

- **Conversion.** After a sync, each new or changed `.pptx`/`.ppt`/`.docx`/`.doc` is converted to PDF by the Office already on your laptop, through COM (`pywin32`). Each file is converted in its own child process with a 5-minute timeout, so a stuck Office dialog can't hang the sync, and Noodle never closes a PowerPoint window you had open.
- **Cache.** The PDFs are cached in `.noodle/converted/<sha1 of the file>.pdf`, so a deck is converted once and again only when it changes. A file that fails gets a `.failed` marker next to it; delete the marker to try again.
- **Fallback.** Without Office, or if a deck won't convert, Noodle reads the slide text with `python-pptx`, one page per slide. Search and Ask still find it, and it opens as readable text.
- **Twins.** When a deck sits next to a same-name PDF (the lecturer uploaded both), the library shows the PDF once and gives it an **Open in PowerPoint** button for the deck. The deck isn't converted or indexed twice.

**Antivirus HTTPS scanning** (e.g. Avast) re-signs TLS traffic. Noodle's HTTP clients trust the Windows certificate store, so this works out of the box. If `npm install` fails with certificate errors, run it with `NODE_OPTIONS=--use-system-ca`.

## Get started (Mac)

**Not tested on a Mac yet.** Nobody has run Noodle on a Mac so far. The Mac launcher does the same steps as the Windows one, but expect rough edges. If you try it, please tell us what happened (a screenshot of the Terminal window helps).

1. **Download Noodle.** [Download the ZIP](https://github.com/tarokuroda/noodle/archive/refs/heads/main.zip). Safari unzips it into your Downloads folder as `noodle-main`. If yours stays a `.zip`, double-click it.
2. **Start it.** In the `noodle-main` folder, double-click **Start Noodle** (`Start Noodle.command`). A Terminal window opens.
   - **macOS blocks it the first time**, because Noodle doesn't come from the App Store or a registered developer. If you see *"Apple could not verify 'Start Noodle.command' is free of malware"*, click **Done**. Then open **System Settings → Privacy & Security**, scroll down to the message about "Start Noodle.command", click **Open Anyway** and enter your Mac password. On macOS 14 (Sonoma) or earlier, you can instead right-click (or Control-click) **Start Noodle**, choose **Open**, then **Open** again. You only do this once.
   - If macOS asks whether Terminal may access your Downloads or Desktop folder, click **Allow**.
   - Still won't open? Open **Terminal** (in Applications → Utilities), type `bash` followed by a space, drag **Start Noodle** into the Terminal window and press Return.
3. **Wait a few minutes, once.** The Terminal window sets Noodle up. The first time, it downloads what it needs (about 300 MB, and Noodle takes about 700 MB of disk). After that, Noodle starts in seconds, and there's a **Noodle** link on your desktop to start it.
4. **Log in to Moodle.** Noodle opens in your browser. Enter your Moodle site, press **Open Moodle login** and sign in as usual. On the page with the "Click here to launch the app" link, click it. When your browser asks whether to open it in Noodle, choose **Allow** or **Open**. If nothing happens (for example because the Moodle app is installed and opens these links instead), right-click the link, choose **Copy Link**, paste it into Noodle and press **Log in**.
5. **Sync.** Tick your courses and press **Sync**.

Keep the Terminal window open while you use Noodle. Close it (or press Ctrl+C in it) to stop Noodle. Double-clicking **Start Noodle** while it's already running just opens it again.

Everything Noodle sets up stays inside its folder (Python and its packages in `.venv/`, helper tools in `.noodle/tools/`). Outside the folder there's only the desktop link, and macOS's record of the small `.noodle/Noodle.app` that lets Moodle's "launch the app" link reach Noodle. To uninstall, double-click **Uninstall Noodle** (it removes those two), then drag the folder to the Bin.

**Known gaps on a Mac.** Converting slides and Word files to PDF and the **Open in PowerPoint** button use Windows-only code, so expect them to fail until they're adapted.

### For developers (Mac)

`Start Noodle.command` is a bash script (for the bash 3.2 that ships with macOS) that mirrors `start.ps1`. It uses your `uv` if it's on PATH, otherwise downloads one for Apple silicon or Intel into `.noodle/tools/`, creates `.venv` and installs `requirements.txt`. It builds the web app with your Node 18+, otherwise with a portable Node in `.noodle/tools/`. It reruns each step only when its inputs change, with the same stamp files as on Windows. It doesn't register the login link handler itself: the server builds and registers `.noodle/Noodle.app` as it starts (`backend/noodle/app_link_mac.py`), unless another app already opens `moodlemobile://` links. `Uninstall Noodle.command` runs `Start Noodle.command --uninstall`, which runs `python -m noodle.app_link_mac --uninstall` and removes the desktop link.

```bash
./"Start Noodle.command" --profile friend --port 8766 --no-build   # a second Noodle, to try Friends on one laptop
.venv/bin/python -m uvicorn noodle.app:app --app-dir backend --port 8765
.venv/bin/python -m pytest backend/tests -q
```

## How it's built

| Part | What |
|---|---|
| `backend/noodle/moodle.py`, `sync.py` | Moodle web-service client and course sync. Page HTML comes from the API, assignment dates from the course contents plus submission status, labels become a section overview. Requests are sequential with a pause. |
| `backend/noodle/convert.py` | Slides and Word files to PDF through Office COM, cached by hash, with a `python-pptx` text fallback. |
| `backend/noodle/index.py`, `search.py` | PyMuPDF text per page, SQLite FTS5, local embeddings, hybrid ranking (reciprocal rank fusion). |
| `backend/noodle/timeline.py` | Calendar events, submission status and the synced courses' weeks, cached for offline use. |
| `backend/noodle/friends.py` | Friends: profile cards and share bundles in a shared folder, highlight matching by content hash. |
| `backend/noodle/notes.py`, `graph.py` | Markdown notes with `[[wikilinks]]`, highlight quotes, and the course graph. |
| `backend/noodle/app.py` | FastAPI routes; also serves the built web app. |
| `frontend/` | React + Vite: `react-pdf` viewer with a custom highlight layer, `react-force-graph-2d`, CodeMirror with `[[` autocomplete. |

Everything private stays out of git: `vault/` (your course files and notes), `.noodle/` (token, sync manifest, search index, converted slides, pre-generated demo data, test profiles) and `.env`.

## Ground rules we kept

- Noodle never tries to get around Moodle's bot protection. Files it blocks are shown as **Open in Moodle** links.
- You do every Moodle login yourself, in your own browser.
- Course material is copyrighted, so none of it is in this repository, including the pre-generated demo answers that quote it.

## Limitations

- Tested on UCL Moodle only.
- The graph shows one course at a time.
- Converting slides needs Microsoft Office on Windows. Without it, slides are searchable as text but can't be highlighted.
- Files over 100 MB (like a 494 MB wind-tunnel deck) aren't downloaded, so they aren't converted either.
- Friends shares notes and highlights through a synced folder, so a share arrives only as fast as the drive syncs, and everyone with access to the folder can read it.
- The Timeline covers the courses on your Moodle dashboard (plus the ones you sync), not courses you've hidden there.
