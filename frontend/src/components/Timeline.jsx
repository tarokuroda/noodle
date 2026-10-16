import { useEffect, useMemo, useState } from "react";
import { BellRing, CalendarClock, ExternalLink } from "lucide-react";
import { api, tagColor } from "../api.js";

const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtMonth = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export default function Timeline({ course, onOpenFile }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (course) api(`/timeline?course=${course.id}`).then(setItems).catch(() => setItems([]));
  }, [course]);

  const months = useMemo(() => {
    const out = [];
    for (const it of items || []) {
      const key = it.date.slice(0, 7);
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label: fmtMonth(it.date), items: [] });
      out[out.length - 1].items.push(it);
    }
    return out;
  }, [items]);

  const deadlines = (items || []).filter((i) => i.kind === "deadline");

  return (
    <div className="preview-page">
      <div className="bar">
        <div className="title">
          <h1>
            Timeline <span className="badge">Preview</span>
          </h1>
          <p>Everything in {course?.shortname.split("_")[0]}, in the order it happens: weeks, deadlines and announcements.</p>
        </div>
      </div>
      <div className="preview-body">
        {deadlines.length > 0 && (
          <div className="deadline-strip">
            {deadlines.map((d) => (
              <a key={d.title + d.date} className="deadline-card" href={d.url} target="_blank" rel="noreferrer">
                <CalendarClock size={18} />
                <div>
                  <b>{d.title}</b>
                  <span>
                    {d.label} {fmtDay(d.date)} {d.date.slice(0, 4)}, {d.time}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
        <div className="timeline">
          {months.map((m) => (
            <section key={m.key}>
              <h2 className="month">{m.label}</h2>
              {m.items.map((it, i) => (
                <div key={i} className={`tl-item ${it.kind}`}>
                  <div className="tl-date">{fmtDay(it.date)}</div>
                  <div className="tl-dot" />
                  <div className="tl-card">
                    {it.kind === "week" && (
                      <>
                        <b>{it.title.replace(/\s*\(.*?\)\s*:?/, ": ").replace(/:\s*:/, ":")}</b>
                        <div className="tl-files">
                          {it.files.map((f) => (
                            <button key={f.id} className="tl-file" onClick={() => onOpenFile(f.id)}>
                              <i style={{ background: tagColor(f.tag) }} />
                              {f.name.replace(/\.(pdf|pptx|docx)$/i, "")}
                            </button>
                          ))}
                          {it.files.length === 0 && <span className="muted small">No lectures this week</span>}
                        </div>
                      </>
                    )}
                    {it.kind === "deadline" && (
                      <a href={it.url} target="_blank" rel="noreferrer">
                        <b>{it.title}</b> is due at {it.time} <ExternalLink size={12} />
                      </a>
                    )}
                    {it.kind === "date" && (
                      <span>
                        <b>{it.title}</b> {it.label.toLowerCase()} {it.time}
                      </span>
                    )}
                    {it.kind === "announcement" && (
                      <button className="tl-link" onClick={() => onOpenFile(it.file_id)}>
                        <BellRing size={14} /> {it.title}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {items && items.length === 0 && <p className="muted">No dates found in this course yet.</p>}
        </div>
      </div>
    </div>
  );
}
