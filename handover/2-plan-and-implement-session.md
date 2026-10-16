# Prompt for session 2: plan and implement

Use this after session 1 has written and committed `handover/REQUIREMENTS.md`. Start a new Claude Code session in `C:\Users\iamta\Documents\noodle`, switch it to **plan mode**, and paste everything below the line.

---

You're building my hackathon project, Noodle. Before planning, read these in full:
- `handover/REQUIREMENTS.md`: what I decided in the interview session. **This is the source of truth.**
- `handover/CONTEXT.md`: project state, what we learned about UCL Moodle, and environment quirks.
- `sync_check.py`: the working Moodle sync. It's proven against UCL, so reuse its logic rather than rewriting it from scratch.

## Planning (plan mode)
Plan the MVP exactly as REQUIREMENTS.md defines it. The plan must include:
1. **Architecture and repo layout** for the stack in REQUIREMENTS.md.
2. **Reusing `sync_check.py`.** Move its Moodle client, login flow, `OSTrustAdapter` and `CourseSync` into the backend. Keep every UCL workaround: page HTML via the API, assignment dates from `module.dates` plus submission status, Cloudflare-blocked files shown as links. Decide whether `sync_check.py` stays as a CLI or is replaced.
3. **Milestones in build order.** Each one is a vertical slice I can see working and demo. Put the riskiest or most important "wow" feature early, and leave Should/Could features for the end.
4. **For each milestone:** the files to create or change, how you'll verify it (commands, tests, what I should see), and what it unlocks next.
5. **Risks and fallbacks**, especially the AI cost, the PDF annotation library and graph performance on ~3,000 files.

Only ask me about things REQUIREMENTS.md leaves open; don't re-ask settled decisions. Then present the plan for approval.

## Implementing (after I approve)
- Work milestone by milestone and keep the task list updated.
- After each milestone, run its verification, show me what works, and **commit** with a message describing the milestone.
- Stop and ask me if a milestone turns out to be much bigger than planned, or if a decision in REQUIREMENTS.md doesn't hold up.
- For live tests, use the saved token in `.noodle/config.json` and the already-synced course ELEC0134 (course id 62169) in `vault/`. Avoid re-downloading the big files.

## Rules
- **Never try to get around Cloudflare's bot check.** No cloudscraper, TLS or browser impersonation, or stealth headless browsers. Blocked files become "open in Moodle" links.
- **Never type my Moodle password; I do every login myself.** You may use the saved token for read-only API calls and downloads of my own courses. Keep requests sequential and gentle.
- **Never commit** `.noodle/`, `vault/`, `.env` or API keys. Course material is copyrighted. Keep secrets in a gitignored `.env`.
- **Windows 11 with Avast HTTPS scanning.** Every HTTP client needs the Windows certificate store: the `OSTrustAdapter` pattern or the `truststore` package in Python, and `--use-system-ca` or `NODE_EXTRA_CA_CERTS` for Node/npm if you see certificate errors. Python is 3.11.4 and Node is 22.15.0.
- **Skills.** Load the `claude-api` skill before writing any Claude API code. Consider the `frontend-design` skill for the UI.
