import { useEffect, useMemo, useState } from "react";
import { BellRing, CalendarCheck, CheckCircle2, CircleDashed, ExternalLink, FileText, PencilLine, RefreshCw, WifiOff } from "lucide-react";
import { api, tagColor } from "../api.js";

const DAY = 86400;
const date = (ts) => new Date(ts * 1000);
const dayKey = (ts) => date(ts).toLocaleDateString("en-CA");
const fmtDay = (ts) => date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtWeekday = (ts) => date(ts).toLocaleDateString("en-GB", { weekday: "short" });
const fmtMonth = (ts) => date(ts).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const fmtTime = (ts) => date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const startOfDay = (ts) => {
  const d = date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
};

function relative(ts, today) {
  const days = Math.round((startOfDay(ts) - today) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const n = Math.abs(days);
  const span = n < 14 ? `${n} days` : n < 60 ? `${Math.round(n / 7)} weeks` : `${Math.round(n / 30)} months`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}

function updated(data, now) {
  if (!data?.fetched_at) return "Not fetched from Moodle yet";
  const min = Math.round((now - data.fetched_at) / 60);
  const when = min < 1 ? "just now" : min < 60 ? `${min} min ago` : `at ${fmtTime(data.fetched_at)} ${fmtDay(data.fetched_at)}`;
  return data.offline ? `Offline: showing what Noodle saved ${when}` : `Updated from Moodle ${when}`;
}

const COURSE_COLORS = ["#4f5bd5", "#2fa36b", "#d6336c", "#f08c00", "#8e4ec6", "#1c7ed6", "#0ca678"];
const courseColor = (code) => COURSE_COLORS[[...(code || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COURSE_COLORS.length];

function CourseChip({ code }) {
  if (!code) return null;
  return (
    <span className="course-chip" style={{ "--c": courseColor(code) }}>
      <i />
      {code}
    </span>
  );
}

function Status({ item }) {
  if (item.overdue) return <span className="pill late">Overdue</span>;
  if (!item.status) return null;
  const Icon = { done: CheckCircle2, draft: PencilLine, todo: CircleDashed }[item.status.state] || CircleDashed;
  return (
    <span className={`pill ${item.status.state}`}>
      <Icon size={12} /> {item.status.text}
    </span>
  );
}

function Item({ it, today, now, onOpenFile }) {
  const timed = !it.allday;
  // a deadline in the next two days that isn't done yet
  const soon = it.kind === "deadline" && !it.overdue && it.ts >= now && it.ts - now < 2 * DAY && it.status?.state !== "done";
  return (
    <div className={`tl-item ${it.kind} ${it.overdue ? "late" : ""} ${soon ? "soon" : ""}`}>
      <div className="tl-date">
        {fmtDay(it.ts)}
        <span>{fmtWeekday(it.ts)}</span>
      </div>
      <div className="tl-dot" />
      <div className="tl-card">
        {it.kind === "week" ? (
          <>
            <div className="tl-head">
              <b>{it.title.replace(/\s*\(.*?\)\s*:?/, ": ").replace(/:\s*:/, ":")}</b>
              <CourseChip code={it.course} />
            </div>
            <div className="tl-files">
              {it.files.map((f) => (
                <button key={f.id} className="tl-file" onClick={() => onOpenFile(f.id)}>
                  <i style={{ background: tagColor(f.tag) }} />
                  {f.name.replace(/\.(pdf|pptx?|docx?)$/i, "")}
                </button>
              ))}
              {it.files.length === 0 && <span className="muted small">No lectures this week</span>}
            </div>
          </>
        ) : it.kind === "announcement" ? (
          <div className="tl-head">
            <button className="tl-link" onClick={() => onOpenFile(it.file_id)}>
              <BellRing size={14} /> {it.title}
            </button>
            <CourseChip code={it.course} />
          </div>
        ) : (
          <>
            <div className="tl-head">
              <b>{it.title}</b>
              <CourseChip code={it.course} />
            </div>
            <div className="tl-meta">
              <span>
                {it.label ? `${it.label} ` : ""}
                {timed ? fmtTime(it.ts) : ""} · <span className={soon ? "when-soon" : ""}>{relative(it.ts, today)}</span>
              </span>
              <Status item={it} />
              <span className="tl-actions">
                {it.file_id && (
                  <button className="tl-open" onClick={() => onOpenFile(it.file_id)}>
                    <FileText size={13} /> Open in Noodle
                  </button>
                )}
                {it.url && (
                  <a href={it.url} target="_blank" rel="noreferrer">
                    Moodle <ExternalLink size={12} />
                  </a>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Months({ items, today, now, onOpenFile }) {
  const months = [];
  for (const it of items) {
    const key = fmtMonth(it.ts);
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, items: [] });
    months[months.length - 1].items.push(it);
  }
  return months.map((m) => (
    <section key={m.key}>
      <h2 className="month">{m.key}</h2>
      {m.items.map((it) => <Item key={it.id} it={it} today={today} now={now} onOpenFile={onOpenFile} />)}
    </section>
  ));
}

export default function Timeline({ onOpenFile }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("upcoming");
  const [course, setCourse] = useState("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api("/timeline?cached=1").then((d) => live && setData(d)).catch(() => {});
    setBusy(true);
    api("/timeline")
      .then((d) => live && setData(d))
      .catch(() => {})
      .finally(() => live && setBusy(false));
    return () => (live = false);
  }, []);

  const refresh = () => {
    setBusy(true);
    api("/timeline/refresh", { method: "POST" })
      .then(setData)
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const now = data?.now || Date.now() / 1000;
  const today = startOfDay(now);
  const { overdue, upcoming, past, counts } = useMemo(() => {
    const all = data?.items || [];
    const inTab = (i) => (tab === "upcoming" ? i.ts >= today || i.overdue : i.ts < today && !i.overdue);
    const counts = {};
    all.filter(inTab).forEach((i) => i.course && (counts[i.course] = (counts[i.course] || 0) + 1));
    const items = all.filter((i) => course === "all" || i.course === course);
    return {
      overdue: items.filter((i) => i.overdue && i.ts < today),
      upcoming: items.filter((i) => i.ts >= today),
      past: items.filter((i) => i.ts < today && !i.overdue).reverse(),
      counts,
    };
  }, [data, tab, course, today]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const later = upcoming.filter((i) => i.ts >= today + DAY);
  const todays = upcoming.filter((i) => i.ts < today + DAY);

  return (
    <div className="preview-page">
      <div className="bar">
        <div className="title">
          <h1>Timeline</h1>
          <p>
            {data?.offline && <WifiOff size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
            {updated(data, now)}
            {data?.error && <span className="tl-error"> · Moodle said: {data.error}</span>}
          </p>
        </div>
        <div className="seg" role="tablist">
          {["upcoming", "past"].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "upcoming" ? "Upcoming" : "Past"}
            </button>
          ))}
        </div>
        <button className="btn" onClick={refresh} disabled={busy} title="Check Moodle again" aria-label={busy ? "Checking Moodle" : "Refresh"}>
          <RefreshCw size={14} className={busy ? "spin" : ""} /> <span className="lbl">{busy ? "Checking…" : "Refresh"}</span>
        </button>
      </div>
      <div className="preview-body">
        {(total > 0 || course !== "all") && (
          <div className="chips tl-filter">
            <button className={`chip ${course === "all" ? "on" : ""}`} onClick={() => setCourse("all")} aria-pressed={course === "all"}>
              All courses <span className="muted">{total}</span>
            </button>
            {Object.keys(counts)
              .sort()
              .map((c) => (
                <button
                  key={c}
                  className={`chip ${course === c ? "on" : ""}`}
                  style={{ "--c": courseColor(c) }}
                  onClick={() => setCourse(c)}
                  aria-pressed={course === c}
                >
                  <span className="dot" />
                  {c} <span className="muted">{counts[c]}</span>
                </button>
              ))}
          </div>
        )}
        <div className="timeline">
          {!data && <p className="muted">Loading your timeline…</p>}
          {data && tab === "upcoming" && (
            <>
              {overdue.length > 0 && (
                <section>
                  <h2 className="month late">Overdue</h2>
                  {overdue.map((it) => <Item key={it.id} it={it} today={today} now={now} onOpenFile={onOpenFile} />)}
                </section>
              )}
              <div className="today-marker">
                <span>Today · {date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
              </div>
              {todays.map((it) => <Item key={it.id} it={it} today={today} now={now} onOpenFile={onOpenFile} />)}
              {todays.length === 0 && later.length > 0 && <p className="muted small tl-quiet">Nothing due today.</p>}
              <Months items={later} today={today} now={now} onOpenFile={onOpenFile} />
              {later.length === 0 && (
                <div className="tl-empty">
                  <CalendarCheck size={28} />
                  <h2>{todays.length ? "Nothing else coming up" : "Nothing due"}</h2>
                  <p>No upcoming deadlines or events{course !== "all" ? ` in ${course}` : ""}. Enjoy it.</p>
                  <button className="btn" onClick={() => setTab("past")}>
                    See past weeks and announcements
                  </button>
                </div>
              )}
            </>
          )}
          {data && tab === "past" && (
            <>
              <Months items={past} today={today} now={now} onOpenFile={onOpenFile} />
              {past.length === 0 && <p className="muted">Nothing in the past yet.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
