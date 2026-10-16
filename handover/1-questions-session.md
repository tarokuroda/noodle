# Prompt for session 1: requirements interview

Paste everything below the line into a new Claude Code session opened in `C:\Users\iamta\Documents\noodle`.

---

You're picking up my hackathon project, Noodle (Moodle sync + notes + graph + AI for students). First read `handover/CONTEXT.md` and skim `sync_check.py`, so you know what's built and what we learned about UCL Moodle.

**Your only job in this session is to interview me and write down the answers.** Don't write app code, don't plan the implementation, and don't run the sync.

## How to interview me
- Use the AskUserQuestion tool. Ask in rounds of at most 4 questions, grouped by topic, and go topic by topic.
- Give concrete options. Put your recommended option first, marked "(Recommended)", based on what `handover/CONTEXT.md` suggests and what fits a hackathon.
- Adapt as you go: skip questions my earlier answers already settle, and ask follow-ups when an answer opens something up.
- Don't re-ask what CONTEXT.md already establishes as fact (e.g. the Cloudflare limits). Do ask me to confirm the "direction suggested so far", since none of it is decided yet.
- Keep each question short and plain. I'm a student, not necessarily a web developer.

## Topics to cover
1. **Hackathon logistics:** dates and time left, team size and each member's skills, judging criteria, demo format (live, video, slides) and length, submission requirements.
2. **Scope and priorities:** confirm the must-haves, decide the MVP cut line, and pick the single "wow" feature for the demo. Do the timeline and friends features make it in, get faked for the demo, or get dropped?
3. **Platform and UX:** local web app on localhost vs desktop app (Tauri/Electron) vs Obsidian plugin. Look and feel. Is the name "Noodle" final? UCL-only, or any Moodle?
4. **Sync:** manual "Sync" button vs background schedule. All courses vs chosen ones (e.g. only this year's). File size cap. How to show the files Cloudflare blocks. Whether the paste-the-`moodlemobile://`-link login is acceptable inside the app.
5. **Notes and annotation:** PDFs only, or slides and Word docs too (convert them to PDF?). Notes stored as Markdown files in the vault (Obsidian-style) or in a database. Wikilinks. How highlights become notes.
6. **Graph:** which nodes and edges matter to me, whether to use LLM concept extraction, how to keep it from becoming a hairball, and what clicking a node does.
7. **AI:** confirm the Claude API, whether I have an API key and a budget, and model choices. Local vs API embeddings. Answers strictly from my files with citations. What "filtering" means to me (auto-tags such as lecture / tutorial / past paper / assignment, semantic search, both?). Am I OK sending course material to the API?
8. **Tech stack and practices:** confirm Python FastAPI + React/Vite + SQLite, or what my team knows instead. Repo layout. How much testing. Commit and branch habits.
9. **Demo:** which courses to show (ELEC0134 is already synced), the demo script, and a backup plan (pre-synced data, recorded video).

## When the interview is done
Write `handover/REQUIREMENTS.md` with these sections:
1. **Summary:** the product in three sentences.
2. **Constraints:** time, team, platform, budget.
3. **Decisions:** a table of topic → decision → why (my words where possible).
4. **Features:** Must / Should / Could / Won't for the hackathon. Each Must gets 1–3 acceptance criteria I could check by hand.
5. **MVP and demo script:** the exact click-through I'll show the judges.
6. **Tech stack and data storage:** what lives where (vault files, SQLite, notes, annotations, embeddings).
7. **AI usage:** models, when each is called, and a rough cost estimate.
8. **Risks and mitigations:** include the Cloudflare-blocked files and the login UX.
9. **Open questions:** anything I couldn't answer yet.

Then show me a short summary of the decisions and ask me to confirm or correct them. Once I confirm, commit the `handover/` folder (CONTEXT.md, the two prompt files and REQUIREMENTS.md) with a clear message. Commit nothing else: never `.noodle/` or `vault/`.
