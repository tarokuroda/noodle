import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, CalendarDays, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronRight, ExternalLink, FileText, Film, Globe, LoaderCircle, Megaphone, Network,
  Presentation, RefreshCw, Search, Users, X, File as FileIcon, NotebookPen,
} from "lucide-react";
import Logo from "./Logo.jsx";
import ClaudeIcon from "./ClaudeIcon.jsx";
import { api, REAL_FRIENDS, TAGS, tagColor } from "../api.js";

export const NAV = [
  { id: "library", label: "Library", icon: BookOpen },
  { id: "ask", label: "Ask", icon: ClaudeIcon },
  { id: "graph", label: "Graph", icon: Network },
  { id: "timeline", label: "Timeline", icon: CalendarDays },
  { id: "friends", label: "Friends", icon: Users, preview: !REAL_FRIENDS },
];

export const KIND_ICON = { pdf: FileText, page: Globe, office: Presentation, media: Film, other: FileIcon, note: NotebookPen };

function Snippet({ text, name }) {
  // the index stores each page as "<file name>\n<text>", so a snippet can open with the name we already show
  let s = text || "";
  if (name && s.replace(/<<|>>/g, "").startsWith(name)) {
    let skip = name.length;
    for (let i = 0; i < skip && i < s.length; i++) if (s.startsWith("<<", i) || s.startsWith(">>", i)) (skip += 2), i++;
    s = s.slice(skip).replace(/^(\s*>>)?\s*/, "");
  }
  const parts = s.split(/(<<.*?>>)/g);
  return parts.map((p, i) => (p.startsWith("<<") ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>));
}

const matchedBy = (m) =>
  m.includes("meaning") && !m.includes("keyword") ? "matched by meaning" : m.includes("meaning") ? "words + meaning" : "matching words";

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

/** Files (in course order) -> [{ key, name, files }], one per Moodle section, keeping only the ticked tags. */
export function groupSections(files, tags) {
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
  // announcements live in section 999, the bottom of the course; pin them to the top, newest first
  const news = out.findIndex((x) => x.key === "999");
  if (news > 0) {
    const [a] = out.splice(news, 1);
    a.files = [...a.files].sort((x, y) => y.name.localeCompare(x.name));
    out.unshift(a);
  }
  return out;
}

const MIN_W = 240;
const MAX_W = 560;
const clampW = (w) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));

// drag the sidebar's right edge to resize it; arrow keys nudge it, double-click goes back to the default
function ResizeHandle({ width, onResize }) {
  const start = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const aside = e.currentTarget.parentElement;
    const left = aside.getBoundingClientRect().left;
    const move = (ev) => onResize(clampW(ev.clientX - left));
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 40 : 16;
    const cur = width || e.currentTarget.parentElement.offsetWidth;
    if (e.key === "ArrowLeft") onResize(clampW(cur - step));
    else if (e.key === "ArrowRight") onResize(clampW(cur + step));
    else if (e.key === "Home") onResize(null);
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_W}
      aria-valuemax={MAX_W}
      aria-valuenow={width || undefined}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onDoubleClick={() => onResize(null)}
      onKeyDown={onKey}
    />
  );
}

export default function Sidebar({ width, onResize, view, setView, course, files, notes = [], openId, openNote, onOpen, onOpenNote, onNewNote, courses = [], setCourseId, onSync, profile }) {
  const [tags, setTags] = useState(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(new Set(["notes"]));
  const [naming, setNaming] = useState(false);
  const searchBox = useRef(null);

  useEffect(() => {
    if (!query.trim() || !course) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let live = true;
    const t = setTimeout(() => {
      api(`/search?course=${course.id}&q=${encodeURIComponent(query)}`)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]))
        .finally(() => live && setSearching(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, course]);

  // "/" jumps to search from anywhere that isn't a text field
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor")) return;
      e.preventDefault();
      searchBox.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sections = useMemo(() => groupSections(files, tags), [files, tags]);

  // filtering by tag opens every section that still has files
  useEffect(() => {
    if (tags.size) setExpanded((s) => new Set([...s, ...sections.map((x) => x.key)]));
  }, [tags]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const treeKeys = [...(notes.length > 0 || onNewNote ? ["notes"] : []), ...sections.map((s) => s.key)];
  const anyOpen = treeKeys.some((k) => expanded.has(k));
  const toggleAll = () => setExpanded(anyOpen ? new Set() : new Set(treeKeys));

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
      {onResize && <ResizeHandle width={width} onResize={onResize} />}
      <div className="brand">
        <Logo />
        <span className="brand-name">Noodle</span>
        {profile && <span className="badge profile" title="A second person on this laptop (NOODLE_PROFILE)">{profile}</span>}
      </div>
      <nav className="nav" aria-label="Noodle">
        {NAV.map(({ id, label, icon: Icon, preview }) => (
          <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}>
            <Icon size={18} /> <span className="nav-label">{label}</span>
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
              ref={searchBox}
              type="search"
              placeholder="Search your files…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              aria-label="Search your files"
              title="Search by words or meaning (press / to jump here)"
            />
            {query && (
              <button className="search-clear" onClick={() => (setQuery(""), searchBox.current?.focus())} aria-label="Clear search">
                {searching ? <LoaderCircle size={15} className="spin" /> : <X size={15} />}
              </button>
            )}
          </div>
          {!results && (
            <div className="chips">

              {TAGS.filter((t) => counts[t]).map((t) => (
                <button
                  key={t}
                  className={`chip ${tags.has(t) ? "on" : ""}`}
                  style={{ "--c": tagColor(t) }}
                  onClick={() => toggleTag(t)}
                  aria-pressed={tags.has(t)}
                >
                  <span className="dot" />
                  {t}
                  <span className="muted">{counts[t]}</span>
                </button>
              ))}
              {tags.size > 0 && (
                <button className="chips-clear" onClick={() => setTags(new Set())}>
                  Show all
                </button>
              )}
            </div>
          )}
          {!results && treeKeys.length > 1 && (
            <div className="tree-tools">
              <button className="tree-toggle" onClick={toggleAll} aria-expanded={anyOpen}>
                {anyOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                {anyOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>
          )}
          <div className="tree">
            {results ? (
              <div className="results" aria-live="polite">
                {results.length > 0 && (
                  <div className="results-head">
                    {results.length} {results.length === 1 ? "match" : "matches"} in {course.shortname.split("_")[0]}
                  </div>
                )}
                {results.length === 0 && !searching && (
                  <p className="muted small results-empty">Nothing matches “{query}” in your files. Try fewer or different words.</p>
                )}
                {results.map((r) => {
                  const Icon = KIND_ICON[r.kind] || FileIcon;
                  return (
                    <button key={r.file_id} className="result" onClick={() => onOpen(files.find((f) => f.id === r.file_id), r.page)}>
                      <div className="rname"><Icon size={14} /> {r.name}</div>
                      <div className="rmeta">
                        {r.viewer === "pdf" ? `p.${r.page} · ` : ""}
                        {matchedBy(r.matched)}
                      </div>
                      <div className="rsnip"><Snippet text={r.snippet} name={r.name} /></div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                {(notes.length > 0 || onNewNote) && (
                  <div>
                    <button className="section-btn" onClick={() => toggle("notes")} aria-expanded={expanded.has("notes")}>
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
                            <button className="file new-note-btn" onClick={() => setNaming(true)}>
                              <NotebookPen size={15} /> <span className="fname">New note…</span>
                            </button>
                          ))}
                      </>
                    )}
                  </div>
                )}
                {sections.map((s) => {
                  const open = expanded.has(s.key);
                  return (
                    <div key={s.key}>
                      <button className="section-btn" onClick={() => toggle(s.key)} title={s.name} aria-expanded={open}>
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {s.key === "999" && <Megaphone size={14} className="news-icon" />}
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
