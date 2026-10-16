import { useEffect, useMemo, useState } from "react";
import {
  BookOpen, CalendarDays, ChevronDown, ChevronRight, ExternalLink, FileText, Film, Globe, Network,
  Presentation, RefreshCw, Search, Sparkles, Users, File as FileIcon, NotebookPen,
} from "lucide-react";
import Logo from "./Logo.jsx";
import { api, TAGS, tagColor } from "../api.js";

const NAV = [
  { id: "library", label: "Library", icon: BookOpen },
  { id: "ask", label: "Ask", icon: Sparkles },
  { id: "graph", label: "Graph", icon: Network },
  { id: "timeline", label: "Timeline", icon: CalendarDays, preview: true },
  { id: "friends", label: "Friends", icon: Users, preview: true },
];

export const KIND_ICON = { pdf: FileText, page: Globe, office: Presentation, media: Film, other: FileIcon, note: NotebookPen };

function Snippet({ text }) {
  const parts = (text || "").split(/(<<.*?>>)/g);
  return parts.map((p, i) => (p.startsWith("<<") ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>));
}

export function FileRow({ file, active, onOpen, indent = true }) {
  const Icon = KIND_ICON[file.kind] || FileIcon;
  const off = file.status !== "ok";
  return (
    <button
      className={`file ${active ? "active" : ""} ${off ? "off" : ""}`}
      style={indent ? undefined : { paddingLeft: 8 }}
      onClick={() => onOpen(file)}
      title={off ? `${file.name}: ${file.status === "skipped" ? "over 100 MB, not downloaded" : "Moodle blocked the download"}` : file.name}
    >
      <Icon size={15} />
      <span className="fname">{file.name}</span>
      {off ? (
        <span className="moodle-btn"><ExternalLink size={11} /> Open in Moodle</span>
      ) : (
        <span className="tagdot" style={{ background: tagColor(file.tag) }} title={file.tag} />
      )}
    </button>
  );
}

export default function Sidebar({ view, setView, course, files, notes = [], openId, openNote, onOpen, onOpenNote, onNewNote, courses = [], setCourseId, onSync }) {
  const [tags, setTags] = useState(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(new Set(["notes"]));
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    if (!query.trim() || !course) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api(`/search?course=${course.id}&q=${encodeURIComponent(query)}`).then(setResults).catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query, course]);

  const sections = useMemo(() => {
    const out = [];
    const byKey = {};
    for (const f of files) {
      if (tags.size && !tags.has(f.tag)) continue;
      const key = `${f.section_num}`;
      if (!byKey[key]) {
        byKey[key] = { key, name: f.section, files: [] };
        out.push(byKey[key]);
      }
      byKey[key].files.push(f);
    }
    return out;
  }, [files, tags]);

  // keep the open file's section expanded
  useEffect(() => {
    const f = files.find((x) => x.id === openId);
    if (f) setExpanded((s) => new Set(s).add(`${f.section_num}`));
  }, [openId, files]);

  const toggle = (key) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const toggleTag = (t) =>
    setTags((s) => {
      const n = new Set(s);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const counts = useMemo(() => {
    const c = {};
    files.forEach((f) => (c[f.tag] = (c[f.tag] || 0) + 1));
    return c;
  }, [files]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <span className="brand-name">Noodle</span>
      </div>
      <nav className="nav">
        {NAV.map(({ id, label, icon: Icon, preview }) => (
          <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
            <Icon size={18} /> {label}
            {preview && <span className="badge">Preview</span>}
          </button>
        ))}
      </nav>

      {course && (
        <>
          <div className="course-head">
            <div>
              {courses.length > 1 ? (
                <select value={course.id} onChange={(e) => setCourseId(+e.target.value)} aria-label="Course">
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.shortname.split("_")[0]}</option>
                  ))}
                </select>
              ) : (
                <h2>{course.shortname.split("_")[0]}</h2>
              )}
              <p title={course.fullname}>{course.fullname.replace(/^[A-Z]{4}\d{4}:\s*/, "")}</p>
            </div>
            <button className={`btn sync-btn ${view === "courses" ? "primary" : ""}`} onClick={onSync} title="Choose courses and sync">
              <RefreshCw size={14} /> Sync
            </button>
          </div>
          <div className="search">
            <Search size={16} />
            <input
              placeholder="Search your files…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search your files"
            />
          </div>
          {!results && (
            <div className="chips">
              {TAGS.filter((t) => counts[t]).map((t) => (
                <button
                  key={t}
                  className={`chip ${tags.has(t) ? "on" : ""}`}
                  style={tags.has(t) ? { color: tagColor(t) } : undefined}
                  onClick={() => toggleTag(t)}
                  aria-pressed={tags.has(t)}
                >
                  <span className="dot" style={{ background: tagColor(t) }} />
                  <span style={{ color: "var(--ink)" }}>{t}</span>
                  <span className="muted">{counts[t]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="tree">
            {results ? (
              <div className="results">
                {results.length === 0 && <p className="muted small" style={{ padding: "8px 10px" }}>Nothing matches “{query}” in your files.</p>}
                {results.map((r) => {
                  const Icon = KIND_ICON[r.kind] || FileIcon;
                  return (
                    <button key={r.file_id} className="result" onClick={() => onOpen(files.find((f) => f.id === r.file_id), r.page)}>
                      <div className="rname"><Icon size={14} /> {r.name}</div>
                      <div className="rmeta">
                        {r.kind === "pdf" ? `p.${r.page} · ` : ""}
                        {r.matched.includes("meaning") && !r.matched.includes("keyword") ? "matched by meaning" : r.matched.includes("meaning") ? "words + meaning" : "matching words"}
                      </div>
                      <div className="rsnip"><Snippet text={r.snippet} /></div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                {(notes.length > 0 || onNewNote) && (
                  <div>
                    <button className="section-btn" onClick={() => toggle("notes")}>
                      {expanded.has("notes") ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="name">My notes</span>
                      <span className="count">{notes.length}</span>
                    </button>
                    {expanded.has("notes") && (
                      <>
                        {notes.map((n) => (
                          <button key={n.path} className={`file ${openNote === n.path ? "active" : ""}`} onClick={() => onOpenNote(n.path)}>
                            <NotebookPen size={15} />
                            <span className="fname">{n.title}</span>
                          </button>
                        ))}
                        {onNewNote &&
                          (naming ? (
                            <form
                              className="new-note"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const title = e.currentTarget.elements.title.value.trim();
                                setNaming(false);
                                if (title) onNewNote(title);
                              }}
                            >
                              <NotebookPen size={15} />
                              <input name="title" autoFocus placeholder="Name your note" onBlur={() => setNaming(false)} aria-label="New note name" />
                            </form>
                          ) : (
                            <button className="file muted" onClick={() => setNaming(true)}>
                              <NotebookPen size={15} /> <span className="fname">New note…</span>
                            </button>
                          ))}
                      </>
                    )}
                  </div>
                )}
                {sections.map((s) => {
                  const open = tags.size > 0 || expanded.has(s.key);
                  return (
                    <div key={s.key}>
                      <button className="section-btn" onClick={() => toggle(s.key)} title={s.name}>
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="name">{s.name}</span>
                        <span className="count">{s.files.length}</span>
                      </button>
                      {open && s.files.map((f) => <FileRow key={f.id} file={f} active={f.id === openId} onOpen={onOpen} />)}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
