# Noodle: requirements

Written from the requirements interview on Fri 16 Oct 2026 (about 12:25–12:50). **This file is the source of truth for the build session.** Where it disagrees with `CONTEXT.md` ("direction suggested so far") or `2-plan-and-implement-session.md`, this file wins. In particular, the demo and test course is **MECH0024, not ELEC0134**, and there is **no Claude API code** in this build.

## 1. Summary
Noodle is a local web app that syncs a student's Moodle courses (tested on UCL) into a tidy folder on their laptop with one Sync button. It turns those files into a study workspace: a PDF and page viewer with highlights that become Markdown notes, `[[wikilinks]]`, auto-tags and search, and an Obsidian-style graph of files, notes and topics. An "Ask" panel answers questions only from the student's own files, with citations that open the PDF at the right page (in this hackathon build, the answers and topics are pre-generated; see section 7).

## 2. Constraints
| | |
|---|---|
| **Deadline** | Submission **Fri 16 Oct 2026, 18:30**. **Code freeze 17:15**, then 75 min to record, caption, write the README and submit. About 4.5 hours of building from ~12:45. |
| **Team** | 2 people, not much coding. **Claude Code writes all the code.** The teammate is not involved in the build, so the user also records the video. |
| **Platform** | Windows 11 laptop, local web app at `localhost` in the browser. Python 3.11.4, Node 22.15.0, npm 10.9.2. Avast re-signs TLS, so every HTTP client must use the Windows trust store (see `CONTEXT.md`). |
| **Budget** | **$0. No Anthropic API key**, and the user chose not to get one. No live Claude API calls and no Claude API code. |
| **Submission** | A recorded video of up to **5 minutes** (screen recording + on-screen captions, no voice) and a **public GitHub repo**. |
| **Judging** | Impact for students, Design/UX, Use of AI. (Technical difficulty is *not* scored, so polish beats engineering depth.) |
| **Legal** | Course material is copyrighted. Never commit or publish `vault/`, `.noodle/`, the demo data, or `.env`. Never try to get around Cloudflare. The user does every Moodle login. |

## 3. Decisions
"You:" marks the user's own words from the interview.

| Topic | Decision | Why |
|---|---|---|
| "Wow" moment | Two: **cited answer → PDF opens at the cited page**, and **the auto-built course graph**. | You: "cited answer pdf and course graph". Hits "Use of AI" and "Design/UX". |
| MVP cut | **All four must-haves, thin**: sync, notes + PDF highlights, graph, AI filtering + Q&A. | Your choice over the leaner cut without highlights. |
| Timeline, Friends | **Faked**: two in-app preview pages with sample data and a "Preview" badge, shown briefly at the end of the video. | Low priority; shows the vision without the build cost. |
| Teammate | Not involved in the build. | You: "nothing". |
| Platform | **Local web app on localhost.** No Tauri/Electron, no Obsidian plugin. | Fastest to build; looks like a real app in a video. |
| Look and feel | **Light and friendly**: white, rounded, playful noodle accents. No dark mode. | Your choice; it should feel like a student app. |
| Name | **Noodle** is final. | Moodle + noodle. |
| Moodle scope | **Any Moodle site URL, tested on UCL only.** | The login already takes any site; say "works with any Moodle" in the pitch. |
| Sync trigger | **Sync button with a progress bar** and an "X new files" result. No background schedule. | Simple and visible in the video. |
| Which courses | **Pick from a list** after login; only ticked courses sync. | Avoids pulling all ~3,100 files. |
| Login UX | **In-app login screen**: "Open Moodle login" button, 3 numbered steps, a box to paste the `moodlemobile://` link. Reuse the saved token when it is valid. | Acceptable to you with clear steps; it's the only flow Cloudflare allows. |
| Big and blocked files | **Skip files over 100 MB.** Skipped and Cloudflare-blocked files still appear in the file list, greyed out, with an **"Open in Moodle"** button. | Nothing silently disappears; no Cloudflare workarounds. |
| Viewer file types | **PDFs** open in the viewer with highlights. **Moodle pages** (the synced `.html`) show as readable text. Slides and Word docs open in the default Windows app. No conversion to PDF. | ELEC0134-style courses are mostly PDFs and pages; MECH0024 is "mostly PDFs". |
| Note storage | **One Markdown file per note**, Obsidian-compatible. | You could open the same folder in Obsidian later. |
| Wikilinks | **`[[links]]` to files and notes, with an autocomplete popup** when typing `[[`. Links become graph edges. | Your choice. |
| Highlights | Select text in a PDF → **highlight is saved and added as a quote to that file's note, with a `p.N` link** back to the page. You can type a comment under it. | Your choice; turns reading into notes. |
| Graph nodes | **Files** (coloured by tag), **notes**, **AI topics**. Sections are a colour or filter, not a node. Highlights are not nodes. | Your choice; keeps the graph readable. |
| Graph edges | Course structure + **your `[[links]]`** + **shared AI topics** (3–8 topics per file). No "similar files" edges. | Your choice. |
| Hairball control | **Prune and filter**: only topics shared by 2+ files, one course at a time, toggles per file type, hover dims everything else. | Your choice. |
| Graph click | **Opens in a side panel** next to the graph. A file or note opens there; a topic shows the files that cover it plus a one-line summary. | Your choice. |
| AI provider | **No live AI in this build.** "Fake only, no API code." AI output (topics, tags, topic summaries, Q&A answers with citations) is **pre-generated by the build Claude Code session** reading the real MECH0024 files, saved as data the app loads. | You have no API key and chose to fake the AI for the video. |
| Fake honesty | **The README says plainly** that the video runs on pre-generated AI output, and that live mode would need an API key. Nothing extra on screen. | The repo is public, so judges can see it anyway. |
| Strictness | When the answer isn't in the files: **"I couldn't find this in your MECH0024 files"** plus the closest files. Every claim has a citation. | Your choice: no guessing. |
| Filtering | **Both**: auto-tag chips (lecture, tutorial, past paper, assignment, reading, other) and a search box. | Your choice. |
| Search | **Real and local**: keyword search plus a small free on-laptop embedding model for "by meaning". Keyword-only if the model won't install. | Works with no API key; this part of the AI is genuinely live. |
| Model choice | You picked "switchable" (Opus 5.5 default, Sonnet 5.5 option) **before** deciding to fake the AI. **Superseded: no model setting is built.** Recorded in section 7 for a future live mode. | No API code in this build. |
| Sending files to the API | **OK** with sending your course material to Anthropic's API (for a future live mode). | Your answer; moot for this build. |
| Tech stack | **Python FastAPI backend + React (Vite) frontend + SQLite.** Repo layout is Claude's call. | Reuses the proven `sync_check.py`; React gives a polished UI. |
| Testing | **A few backend smoke tests + a click-through of the demo path** after each milestone. | Time. |
| Git | **Commit to `main` after each working milestone.** No branches or PRs. | Always a working version to fall back to. |
| GitHub | **The build session creates the public repo at the end** with `gh`, after checking you're logged in and **asking you first**, then pushes `main`. | You chose this. |
| Demo data in the repo | **Keep it private** (gitignored like `vault/`). | It quotes UCL lecture material. |
| Demo course | **MECH0024 only.** Not synced yet. "Mostly PDFs." ELEC0134 is **not used**, for the demo or for development. | Your choice. |
| Demo questions | **Claude Code picks 3** from the MECH0024 files (one of them deliberately *not* answerable from the files); you approve them. | Your choice. |
| Video | **Screen recording + captions**, recorded **as short clips on pre-synced data**, re-taking any clip that fails. | Your choice; never depend on live Moodle while recording. |

## 4. Features

### Must (the demo depends on these)
**M1. Login and token reuse**
- With the saved token in `.noodle/config.json`, the app opens straight to the library.
- With no or an invalid token, a login screen shows the "Open Moodle login" button, 3 numbered steps and a paste box; pasting the `moodlemobile://` link logs in and shows the course list.
- The token never appears in full anywhere in the UI or logs.

**M2. Course picker and Sync**
- After login, a list of enrolled courses with checkboxes; ticking MECH0024 and pressing **Sync** shows a progress bar and ends with "N new files".
- Pressing Sync again downloads nothing and says so (incremental, via the existing manifest).
- Files over 100 MB and Cloudflare-blocked files appear greyed out in the file list; their **Open in Moodle** button opens the Moodle page in the browser.

**M3. Library and viewer (light, friendly look)**
- The sidebar shows course → sections → files, with tag colours; clicking a PDF opens it in the in-app viewer with page navigation.
- Clicking a Moodle page (`.html`, section overview, assignment brief) shows it as readable text inside Noodle.
- Clicking a `.pptx` or `.docx` opens it in its default Windows app.

**M4. PDF highlights become notes**
- Selecting text in a PDF and choosing **Highlight** saves it; the highlight is still there after reloading the app.
- The quote is appended to that file's note as a quote with a `p.N` link, and you can type a comment under it.
- Clicking the `p.N` link opens the PDF at page N.

**M5. Markdown notes with wikilinks**
- Creating a note writes a `.md` file into the notes folder; edits are saved to that file.
- Typing `[[` shows an autocomplete list of files and notes; picking one inserts the link.
- Clicking a `[[link]]` opens the linked file or note.

**M6. Course graph**
- The MECH0024 graph shows files (coloured by tag), notes, and topics shared by 2+ files; hovering a node dims everything not connected to it.
- Clicking a file or note opens it in a side panel; clicking a topic lists its files and a one-line summary.
- A note created during the demo, with a `[[link]]` to a file, appears in the graph connected to that file.

**M7. Ask, with citations (pre-generated answers)**
- Typing one of the 3 approved demo questions shows its answer with citation chips like "Lecture 3 — p.12"; clicking a chip opens that PDF at that page.
- The "not in your files" demo question returns "I couldn't find this in your MECH0024 files" plus the closest files.
- Any other question shows a friendly message with the 3 demo questions as clickable chips (no crash, no blank screen).

**M8. Filtering and search**
- Tag chips (lecture, tutorial, past paper, assignment, reading, other) filter the file list.
- The search box returns matching files and pages, ranked, within about a second, including for a query that uses different words from the file (if the meaning model installed; otherwise keyword matches).

**M9. Timeline and Friends preview pages**
- The sidebar has **Timeline** and **Friends**; each opens a realistic page with sample data and a visible "Preview" badge.
- Neither page errors or breaks navigation.

### Should (only if the Musts are done before ~16:30)
- Timeline preview filled from MECH0024's real `_dates.json` instead of sample data.
- Remember the ticked courses and the last open file between launches.
- Smooth touches: loading skeletons, empty states, a small Noodle logo/mascot.

### Could
- "Explain this" button on a highlight (pre-generated for one demo highlight).
- Local graph mode (only what's around the open file).
- README screenshots and a GIF of the graph.

### Won't (this hackathon)
- Any Claude API code or live AI calls; a model-choice setting.
- Real Friends sharing (accounts, Supabase) and a real Timeline feature.
- Background or scheduled sync.
- Converting slides or Word docs to PDF, or annotating anything but PDFs.
- "Similar files" edges, highlights as graph nodes, an all-courses graph by default.
- Dark mode, a desktop wrapper (Tauri/Electron), an Obsidian plugin, hosting.
- ELEC0134 in the demo.
- Anything that works around Cloudflare's bot check.

## 5. MVP and demo script
**MVP** = M1–M9 working on MECH0024, pre-synced, with the pre-generated AI data in place.

**Video** (up to 5 min, screen recording + captions, recorded as separate clips on pre-synced data):

| Time | On screen | Caption idea |
|---|---|---|
| 0:00–0:20 | Title card, then a cluttered Moodle course page. | "Moodle hides your course behind a hundred clicks." |
| 0:20–0:50 | Noodle login screen (brief), course picker, tick **MECH0024**, press **Sync**, progress bar, "N new files". Point at a greyed "Open in Moodle" file. | "Log in once. Pick your modules. One click syncs everything to your laptop." |
| 0:50–1:20 | Library: sections and files; click the **Lecture** tag chip; type a search that uses different words from the slides and get the right lecture. | "Auto-tagged and searchable by meaning." |
| 1:20–2:10 | Open a lecture PDF, highlight a key definition, the quote lands in the note with a `p.N` link; type `[[` and link another lecture. | "Highlights become notes. Notes link like Obsidian." |
| 2:10–3:10 | **Ask** demo question 1 → answer with citation chips → click a chip → the PDF opens at that page. Then ask the "not in your files" question → "I couldn't find this in your MECH0024 files". | "Answers only from your files, with sources. No guessing." |
| 3:10–4:10 | **Graph**: the course mapped into files and topics; hover a topic, click it, side panel lists the lectures that cover it; spot the note made a minute ago, linked in. | "Your whole module, mapped automatically." |
| 4:10–4:40 | **Timeline** and **Friends** preview pages. | "Coming next: deadlines in one timeline, and sharing notes with friends." |
| 4:40–5:00 | Closing card: "Works with any Moodle. Local-first: your course files stay on your laptop." + GitHub link. | |

**After the code freeze (17:15):** record the clips (17:15–17:55), add captions and join the clips, for example in Clipchamp, which ships with Windows 11 (17:55–18:10), write the README and push the public repo (18:10–18:20), submit (by 18:30).

## 6. Tech stack and data storage
- **Backend:** Python 3.11, FastAPI + uvicorn. Reuse `sync_check.py` (the `Moodle` client, login flow, `OSTrustAdapter`, `CourseSync`) and keep every UCL workaround in `CONTEXT.md`. PyMuPDF extracts text per page. SQLite FTS5 for keyword search; a small local embedding model (e.g. fastembed + bge-small) for meaning search, with `truststore` for the model download behind Avast.
- **Frontend:** React + Vite. A PDF.js-based viewer with highlighting (e.g. `react-pdf-highlighter`), a Markdown note editor with `[[` autocomplete, and `react-force-graph-2d` for the graph. Exact libraries are the build session's call.
- **Repo layout:** the build session's call. The public repo holds code, a README and `.gitignore` only.

| What | Where | In git? |
|---|---|---|
| Synced Moodle files, pages, briefs, `_dates.json` | `vault/<course>/...` (existing layout from `sync_check.py`) | No |
| Notes (`.md`, Obsidian-compatible, `[[wikilinks]]`, highlight quotes with `p.N` links) | A notes folder inside `vault/` so Obsidian can open files and notes together (exact folder: build session's call) | No |
| Moodle token, sync manifest | `.noodle/config.json`, `.noodle/manifest.json` (existing) | No |
| File index (course, section, path, type, tag, size, status: downloaded / skipped / blocked, Moodle URL, hash) | SQLite in `.noodle/` | No |
| Page text + keyword index | SQLite FTS5 in `.noodle/` | No |
| Embeddings for meaning search | SQLite in `.noodle/` (vectors as blobs) | No |
| Highlights (file hash, page, position, quote text, note path) | SQLite in `.noodle/` | No |
| Pre-generated AI data: tags, topics per file, topic summaries, the 3 demo Q&As with citations | JSON in a gitignored folder such as `.noodle/demo/` | No |
| Secrets | `.env` (none needed this build) | No |

## 7. AI usage
**In this build: no live model calls, $0.**
| What | How it's made | When |
|---|---|---|
| Tags per file (lecture, tutorial, past paper, assignment, reading, other) | Pre-generated by the build Claude Code session from the MECH0024 files; filename rules as a fallback | Once, after MECH0024 is synced |
| Topics per file (3–8) and a one-line summary per topic | Pre-generated by the build Claude Code session | Once, after sync |
| Answers to the 3 demo questions, with citations (file + page) | Pre-generated by the build Claude Code session from the real PDFs, so citations open the real pages | Once; the user approves the questions |
| Search by meaning | **Real**: local embedding model on the laptop, plus keyword search | At sync (indexing) and on every search |

**Future live mode (not built; for the README's "what's next" and the pitch):**
- Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 in / $0.50 out per million tokens) tags each file and extracts topics once, at sync time. About $0.001 per file: roughly $0.05–0.10 for one course, about $3 for all ~3,100 files.
- Q&A with the Citations feature on Claude Opus 5.5 (`claude-opus-5-5`, $4 / $20 per million tokens), switchable to Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10). Each question sends ~10–12 retrieved page chunks (~10k tokens) as documents titled "file — p.N". About $0.07–0.10 per question on Opus 5.5, $0.03–0.05 on Sonnet 5.5; a student asking 100 questions a month would spend about $4–10.
- Prices are from the `claude-api` skill's model table (cached 2026-10-06).

## 8. Risks and mitigations
| Risk | Mitigation |
|---|---|
| **Not enough time** (4.5 h, all code written by Claude) | Build the demo path first, as vertical slices, committing each one. Shoulds only after the Musts. The 17:15 code freeze holds. If a Must is running late, cut it to its simplest visible form rather than drop it. |
| **MECH0024 isn't synced yet**; its size, file mix and course id are unknown | First build step: dry run, then sync MECH0024 with the 100 MB cap, before any UI work. If it turns out to have few PDFs or lots of blocked files, **stop and ask the user** (they chose MECH0024 only, so don't silently switch to ELEC0134). |
| **Cloudflare blocks some downloads** (page `index.html`, zips, `.ipynb`, `.mp4`) | Show them greyed out with **Open in Moodle**; retry on each sync. Never bypass the bot check. Avoid making a blocked file part of the demo path. |
| **Login UX is clunky** (copy a `moodlemobile://` link and paste it) | Clear 3-step screen with an "Open Moodle login" button. The saved token is reused, so it's a one-time step. In the video, show the screen for a second and use the saved token. |
| **Faked AI vs. "Use of AI" judging** | The output is real (generated from the actual files by Claude), the citations open real pages, search is genuinely live, and the README discloses it. The pitch frames live mode as one API key away. |
| Demo mode only knows 3 questions | Type them exactly as scripted. Any other question shows the 3 as chips instead of failing. |
| PDF highlighting library trouble (React version, PDF.js worker in Vite) | Fallback: a plain PDF.js viewer with text selection → "add quote to note", even if the highlight overlay isn't persistent. |
| Graph becomes a hairball or slow | One course only, topics shared by 2+ files, a cap on topics per file, toggles per file type. |
| Embedding model won't download behind Avast | Use `truststore`; if it still fails, keyword search only (already the fallback). |
| npm certificate errors behind Avast | `--use-system-ca` or `NODE_EXTRA_CA_CERTS`. |
| Copyrighted material leaks into the public repo | `.gitignore` covers `vault/`, `.noodle/`, the demo data and `.env`; check `git status` before every commit and before the first push. |
| Creating the public GitHub repo fails (`gh` not logged in) | Check `gh auth status` early in the build; the user logs in themselves. Ask before creating the repo. |
| Recording goes wrong close to the deadline | Pre-synced data, short clips, re-take only the broken clip. |

## 9. Open questions
- **MECH0024**: course id, size and how many files Cloudflare blocks. The build session finds out with a dry run.
- **The 3 demo questions**: Claude proposes them after reading the MECH0024 files; the user approves them.
- **GitHub**: is `gh` installed and logged in, and what should the repo be called (default: `noodle`)?
- **Hackathon name and submission link** for the README: not given.
- **Video tools**: what the user records and edits with (suggested: Windows Snipping Tool screen recording + Clipchamp).
- **Other synced courses** (ELEC0134, ACC Engineering Sciences) already in `vault/`: hide them in the app for the video, or remove them from the library? Default: only show the courses ticked in the picker.
- **`sync_check.py`**: keep it as a CLI or fold it into the backend. The build session decides.
