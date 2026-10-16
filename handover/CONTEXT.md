# Noodle: project context

Everything a new session needs to know about where this project stands. Read this before doing anything.

## The project
Hackathon entry, theme "something to help students". Noodle syncs a student's Moodle and turns it into a study workspace.

**Must-have features (the user's original list)**
1. All Moodle files and pages synced and downloaded automatically.
2. Built-in note taking, including annotating PDFs taken from Moodle.
3. An Obsidian-style graph view where everything is mapped, built automatically from Moodle files and notes.
4. AI over the files: filtering, and asking questions that are answered only from the files.

**Low priority**
- Timeline view: everything in chronological order.
- Friends: share chosen files, modules or notes with friends.

The user is a UCL student, so the real target is UCL Moodle (`https://moodle.ucl.ac.uk`, Moodle 4.5.15).

## What exists today
The repo is `C:\Users\iamta\Documents\noodle` (git, branch `main`, first commit `4a73b77`). It contains one rough, working script.

| File | What it is |
|---|---|
| `sync_check.py` | Single-file Moodle sync (Python, `requests` only). Proven against UCL. |
| `requirements.txt` | `requests` |
| `.gitignore` | Ignores `.noodle/` (token + manifest), `vault/` (course material), `__pycache__/` |

**Usage**
```
python sync_check.py --site https://moodle.ucl.ac.uk   # first run: log in, then sync
python sync_check.py --dry-run                          # list only, shows size estimate
python sync_check.py --course 62169                     # one course (repeatable)
python sync_check.py --max-files 20 --max-size 50       # limit count / skip files > 50 MB
python sync_check.py --token <TOKEN> | --relogin
```

**What the script does**
- **Login.** Probes the site, then either username/password (`login/token.php`) or browser SSO via `admin/tool/mobile/launch.php?...&confirmed=1`. The user copies the `moodlemobile://token=...` link and pastes it. The token is saved in `.noodle/config.json`.
- **Sync per course** (`CourseSync` class), into `vault/<course shortname>/`:
  - `<NN section>/<file>`: resource files. Folders and other modules go under `<module name>/<filepath>/`.
  - `<NN section>/<page name>.html`: page HTML fetched via `mod_page_get_pages_by_courses`, not the file URL.
  - `<NN section>/_Section overview.html`: section summary plus labels, in page order.
  - `<NN section>/<assignment>/_Brief.html`: dates, description, intro/activity text and a Moodle link, plus attachments.
  - `Announcements/<YYYY-MM-DD subject>.html`: news-forum posts, with attachments in a folder of the same name.
  - `_dates.json`: opens/due/close dates of every activity, for the timeline.
- **Incremental.** `.noodle/manifest.json` is keyed by file URL (path, timemodified, filesize). Text the script generates is rewritten only when it changed. A second run downloads nothing.
- **Network and output.** `OSTrustAdapter` makes `requests` trust the Windows certificate store as well as certifi (see Environment). Downloads are sequential with a 0.2 s pause. The token is masked in all output.

**Local state right now:** `vault/` holds about 2 GB: ELEC0134 (course id 62169) fully synced, plus six huge `.pptx` decks (about 350 MB each) from "ACC Engineering Sciences". The saved token in `.noodle/config.json` is valid. It stays valid until the user resets it in Moodle.

## What we learned about UCL Moodle (important)
- **Cloudflare sits in front of the site.** Its bot check (`cf-mitigated: challenge`) blocks `login/token.php` and the public-config endpoint for scripts. That makes password login from code impossible; only the browser SSO flow works. **Never try to bypass Cloudflare**: no cloudscraper, TLS/browser impersonation or stealth headless browsers.
- **The REST API works with the token.** `webservice/rest/server.php` is not challenged. 465 functions are available, including pages, labels, assignments, forums, calendar, resources, folders and books.
- **Most file downloads work, some are blocked.** `webservice/pluginfile.php` downloads mostly work, but Cloudflare blocks some at random: page `index.html` files, zips, `.ipynb` and `.mp4`. 18 ELEC0134 files are still blocked; they are retried every run and should be shown as "open in Moodle" links.
- **`mod_assign_get_assignments` fails** at UCL with `invalidresponse`, a server-side bug. The script uses `core_course_get_contents` → `module.dates` plus `mod_assign_get_submission_status` instead.
- **Activity dates come free** in `core_course_get_contents` (`module.dates`, with dataid `duedate`, `timeclose`, `cutoffdate`, ...). Trust these, not activity titles. ELEC0134's assignment is titled "Friday 16th January 2026", but its real due date is 2027-01-15 18:00.
- **Labels hold important text.** ELEC0134's "Assessment and Feedback" labels contain the whole assessment brief.
- **Scale.** Across all enrolled courses, the dry run found 3,143 files and 599 links. Module counts: label 1702, forum 210, assign 188, quiz 162, lti 143, choice 55, questionnaire 51, lesson 38, helixmedia 28, zoom 28 and others. Lecture recordings (Helix, Panopto, Zoom, LTI) are links only.

## Environment
- **Machine.** Windows 11, PowerShell (Git Bash also available), Python 3.11.4, `requests` 2.32.5, Node 22.15.0, npm 10.9.2. `uv` is not installed.
- **Avast HTTPS scanning re-signs TLS traffic.** Python's certifi bundle rejects it, so every HTTP client needs the OS trust store:
  - Python: the `OSTrustAdapter` pattern in `sync_check.py`, or the `truststore` package.
  - Node/npm: `--use-system-ca`, or `NODE_EXTRA_CA_CERTS`, if certificate errors appear.
- **Logins.** The user does all Moodle logins themselves. Claude never types their password. Claude may use the saved token for read-only API calls and downloads of the user's own courses.
- **Never commit** `.noodle/`, `vault/` or API keys. Course material is copyrighted.

## Direction suggested so far (not yet confirmed by the user)
The questions session should confirm or override all of this.
- **Form:** a local-first app. Python FastAPI backend (sync, text extraction, AI) plus a React (Vite) frontend on localhost, wrapped in Tauri or Electron only if time allows. Not a hosted site: hosting would mean storing tokens server-side, hosting gigabytes of files and redistributing copyrighted material.
- **Storage:** plain folders (the vault) plus SQLite for metadata, notes, annotations and links.
- **PDFs:** PyMuPDF for text with page numbers. `react-pdf-highlighter` (PDF.js) for annotation, with highlights stored as JSON keyed by file hash, page and position.
- **Notes:** BlockNote or TipTap with `[[wikilinks]]`.
- **Graph:** `react-force-graph-2d`. Nodes are course, section, file, note, annotation and concept. Edges, in order of effort:
  1. structure (from the API)
  2. explicit links in notes
  3. LLM-extracted concepts shared between files (the "wow" part)
  4. embedding similarity, top-k only
- **AI:** Claude API.
  - Claude Haiku 5.5 (`claude-haiku-5-5`) tags and extracts concepts once per file, at sync time.
  - Filtering uses metadata plus embedding search, with no LLM call per filter.
  - Q&A is RAG with Citations enabled, on Claude Opus 5.5 (`claude-opus-5-5`, the default) or Sonnet 5.5. Each chunk is sent as a document titled "file — p.N", so citations jump to the right page.
  - Embeddings run locally with fastembed/bge-small, or through Voyage AI (Claude has no embeddings API).
  - Load the `claude-api` skill before writing any Claude API code.
- **Timeline:** built from `_dates.json`.
- **Friends:** needs a small backend such as Supabase. Share notes and annotations, not files, matched by file hash.
- **Demo moment:** ask a question → cited answer → click the citation → the PDF opens at the highlighted page → add a note → it appears in the graph.

## Unknowns the user hasn't answered yet
- Hackathon dates and time left, team size and skills, judging criteria, demo format.
- Platform choice, final scope and cut line, AI budget and API key.
- Which courses to demo, how notes are stored, and whether to include the friends and timeline features.
