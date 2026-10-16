import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, File as FileIcon, Globe, History, Megaphone, Network, NotebookPen,
  Presentation, Sparkles, X,
} from "lucide-react";
import NotePanel from "./NotePanel.jsx";
import PdfViewer from "./PdfViewer.jsx";
import Logo from "./Logo.jsx";
import { KIND_ICON, groupSections } from "./Sidebar.jsx";
import { api, TAGS, tagColor } from "../api.js";

export function FileViewer({ file, open, setOpen, highlights, onHighlight, compact = false, actions = null, onBack = null }) {
  const [pos, setPos] = useState({ current: 1, num: 0 });
  const jump = (n) => setOpen({ id: file.id, page: n, nonce: Date.now() });
  const go = (e) => {
    const n = Math.round(+e.currentTarget.value);
    if (n >= 1) jump(Math.min(n, pos.num));
    else e.currentTarget.value = pos.current;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <div className="bar">
        {onBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back to the library" title="Back to the library">
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="tagdot" style={{ background: tagColor(file.tag) }} title={file.tag} />
        <div className="title">
          <h1 title={file.name}>{file.name}</h1>
          {!compact && <p title={`${file.section} · ${file.tag}`}>{file.section} · {file.tag}</p>}
        </div>
        {file.viewer === "pdf" && pos.num > 0 && (
          <div className="pager">
            <button className="icon-btn" onClick={() => jump(Math.max(1, pos.current - 1))} disabled={pos.current <= 1} aria-label="Previous page">
              <ChevronLeft size={18} />
            </button>
            <input
              key={pos.current}
              defaultValue={pos.current}
              inputMode="numeric"
              aria-label={`Page number, of ${pos.num}`}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.key === "Enter" && go(e)}
              onBlur={(e) => +e.currentTarget.value !== pos.current && go(e)}
            />
            <span>of {pos.num}</span>
            <button className="icon-btn" onClick={() => jump(Math.min(pos.num, pos.current + 1))} disabled={pos.current >= pos.num} aria-label="Next page">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        {actions}
        {!compact && file.app_name && (
          <button
            className="btn"
            onClick={() => api(`/files/${file.slides_id || file.id}/open`, { method: "POST" })}
            title={`Open the original in ${file.app_name}`}
            aria-label={`Open in ${file.app_name}`}
          >
            <Presentation size={14} /> <span className="lbl">{file.app_name}</span>
          </button>
        )}
        {!compact && file.moodle_url && (
          <a className="btn" href={file.moodle_url} target="_blank" rel="noreferrer" title="Open this file's page on Moodle" aria-label="Open in Moodle">
            <ExternalLink size={14} /> <span className="lbl">Moodle</span>
          </a>
        )}
      </div>
      <div className="viewer-wrap">
        {file.viewer === "pdf" ? (
          <PdfViewer
            file={file}
            page={open?.id === file.id ? open.page : 1}
            nonce={open?.id === file.id ? open.nonce : 0}
            highlights={highlights}
            onHighlight={onHighlight}
            onPage={(current, num) => setPos({ current, num })}
          />
        ) : (
          <iframe
            className="page-frame"
            title={file.name}
            src={`/api/files/${file.id}/html`}
            // Scripts stay off (no allow-scripts, plus the backend's script-src 'none'). allow-same-origin is
            // needed because some browsers block every request from an opaque-origin frame: the page came up blank.
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        )}
      </div>
    </div>
  );
}

export function EmptyLibrary({ course, onNavigate }) {
  return (
    <div className="empty">
      <div>
        <Logo size={72} />
        <h2>Your {course?.shortname.split("_")[0] || "course"}, all in one bowl</h2>
        <p>
          {course
            ? `${course.files} files and ${course.pages} pages synced from Moodle. Pick a file on the left, search by meaning, or ask a question.`
            : "Sync a course to get started."}
        </p>
        {course && onNavigate && (
          <div className="empty-actions">
            <button className="btn" onClick={() => onNavigate("ask")}>
              <Sparkles size={15} /> Ask a question
            </button>
            <button className="btn" onClick={() => onNavigate("graph")}>
              <Network size={15} /> See the course map
            </button>
            <button className="btn" onClick={() => onNavigate("timeline")}>
              <CalendarDays size={15} /> Check deadlines
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const isOverview = (f) => /\/_Section overview\.html$/.test(f.path);

function syncedAgo(ts) {
  if (!ts) return "";
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  if (min < 1) return "synced just now";
  if (min < 60) return `synced ${min} min ago`;
  if (min < 48 * 60) return `synced ${Math.round(min / 60)} h ago`;
  return `synced ${new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** What a card says under the file name: how it opens and how long it is. */
function fileMeta(f) {
  if (f.status === "skipped") return "Over 100 MB · open in Moodle";
  if (f.status !== "ok") return "Moodle blocked the download";
  if (f.viewer === "pdf") return `${f.pages || "?"} ${f.pages === 1 ? "page" : "pages"}${f.app_name ? ` · ${f.app_name} too` : ""}`;
  if (f.viewer === "page") return "Moodle page";
  if (f.app_name) return `Opens in ${f.app_name}`;
  return (f.ext || "file").toUpperCase();
}

function FileCard({ file, page, onOpen }) {
  const Icon = KIND_ICON[file.kind] || FileIcon;
  const off = file.status !== "ok";
  return (
    <button className={`lib-card ${off ? "off" : ""}`} style={{ "--c": tagColor(file.tag) }} onClick={() => onOpen(file, page)} title={file.name}>
      <span className="lib-icon">
        <Icon size={18} />
      </span>
      <span className="lib-text">
        <span className="lib-name">{file.name}</span>
        <span className="lib-meta">
          {off ? (
            <>
              <ExternalLink size={11} /> {fileMeta(file)}
            </>
          ) : page > 1 ? (
            `${file.section} · p.${page}`
          ) : (
            <>
              <i /> {file.tag} · {fileMeta(file)}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function readRecent(courseId, byId) {
  try {
    const list = JSON.parse(localStorage.getItem("noodle:recent") || "[]");
    return list.filter((r) => r.course === courseId && byId[r.file]).slice(0, 4);
  } catch {
    return [];
  }
}

/** The library with no file open: the whole course, section by section, as a page you can browse. */
export function LibraryHome({ course, files, onOpenFile, onNavigate }) {
  const [tags, setTags] = useState(new Set());
  const byId = useMemo(() => Object.fromEntries(files.map((f) => [f.id, f])), [files]);
  const recent = useMemo(() => readRecent(course.id, byId), [course.id, byId]);
  const sections = useMemo(() => groupSections(files, tags), [files, tags]);
  const counts = useMemo(() => {
    const c = {};
    files.forEach((f) => (c[f.tag] = (c[f.tag] || 0) + 1));
    return c;
  }, [files]);
  const pages = files.reduce((n, f) => n + (f.viewer === "pdf" ? f.pages || 0 : 0), 0);
  const toggleTag = (t) =>
    setTags((s) => {
      const n = new Set(s);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  return (
    <div className="preview-page">
      <div className="bar">
        <div className="title">
          <h1>{course.shortname.split("_")[0]} library</h1>
          <p title={course.fullname}>
            {files.length} files · {pages} PDF pages{course.synced_at ? ` · ${syncedAgo(course.synced_at)}` : ""}
          </p>
        </div>
        <div className="bar-actions">
          <button className="btn" onClick={() => onNavigate("ask")} aria-label="Ask a question">
            <Sparkles size={14} /> <span className="lbl">Ask</span>
          </button>
          <button className="btn" onClick={() => onNavigate("graph")} aria-label="See the course map">
            <Network size={14} /> <span className="lbl">Course map</span>
          </button>
        </div>
      </div>
      <div className="preview-body lib-body">
        {recent.length > 0 && (
          <section className="lib-section">
            <h2 className="lib-head">
              <History size={16} /> <span className="name">Pick up where you left off</span>
            </h2>
            <div className="lib-grid">
              {recent.map((r) => (
                <FileCard key={r.file} file={byId[r.file]} page={r.page} onOpen={onOpenFile} />
              ))}
            </div>
          </section>
        )}
        <div className="chips lib-chips">
          {TAGS.filter((t) => counts[t]).map((t) => (
            <button key={t} className={`chip ${tags.has(t) ? "on" : ""}`} style={{ "--c": tagColor(t) }} onClick={() => toggleTag(t)} aria-pressed={tags.has(t)}>
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
        {sections.map((s) => {
          const overview = s.files.find(isOverview);
          const rest = s.files.filter((f) => f !== overview);
          return (
            <section key={s.key} className="lib-section">
              <h2 className="lib-head">
                {s.key === "999" && <Megaphone size={16} className="news-icon" />}
                <span className="name">{s.name}</span>
                <span className="count">{s.files.length}</span>
                {overview && (
                  <button className="lib-overview" onClick={() => onOpenFile(overview)} title={`Read the ${s.name} overview`}>
                    <Globe size={13} /> Overview
                  </button>
                )}
              </h2>
              {rest.length > 0 ? (
                <div className="lib-grid">
                  {rest.map((f) => (
                    <FileCard key={f.id} file={f} onOpen={onOpenFile} />
                  ))}
                </div>
              ) : (
                <p className="muted small">Just the overview page this week.</p>
              )}
            </section>
          );
        })}
        {sections.length === 0 && <p className="muted">No files with those tags.</p>}
      </div>
    </div>
  );
}

/** The library's main area: a file (with its highlights and note beside it), a note on its own, or the course to browse. */
export function LibraryView({ course, files = [], file, open, setOpen, sideNote, setSideNote, mainNote, onOpenFile, onOpenNote, onNotesChanged, onNavigate, onClose }) {
  const [highlights, setHighlights] = useState([]);
  const [noteKey, setNoteKey] = useState(0);

  useEffect(() => {
    setHighlights([]);
    if (file?.viewer === "pdf") api(`/highlights?file=${file.id}`).then(setHighlights);
  }, [file?.id]);

  const onHighlight = async (sel) => {
    const res = await api("/highlights", { method: "POST", body: { file_id: file.id, page: sel.page, rects: sel.rects, text: sel.text } });
    setHighlights((h) => [...h, res.highlight]);
    setSideNote(res.note_path);
    setNoteKey((k) => k + 1);
    onNotesChanged();
  };

  const toggleNote = async () => {
    if (sideNote) return setSideNote(null);
    const res = await api(`/files/${file.id}/note?create=true`);
    setSideNote(res.path);
    onNotesChanged();
  };

  if (!file && mainNote) {
    return <NotePanel key={mainNote} path={mainNote} course={course} onOpenFile={onOpenFile} onOpenNote={onOpenNote} />;
  }
  if (!file) {
    return course && files.length ? (
      <LibraryHome course={course} files={files} onOpenFile={onOpenFile} onNavigate={onNavigate} />
    ) : (
      <EmptyLibrary course={course} onNavigate={onNavigate} />
    );
  }
  return (
    <div className="split">
      <FileViewer
        file={file}
        open={open}
        setOpen={setOpen}
        onBack={onClose}
        highlights={highlights}
        onHighlight={file.viewer === "pdf" ? onHighlight : undefined}
        actions={
          <button
            className={`btn ${sideNote ? "yellow" : ""}`}
            onClick={toggleNote}
            aria-pressed={!!sideNote}
            aria-label="Notes"
            title={sideNote ? "Hide this file's note" : "Open this file's note beside it"}
          >
            <NotebookPen size={14} /> <span className="lbl">Notes</span>
          </button>
        }
      />
      {sideNote && (
        <div className="note-side">
          <button className="icon-btn side-close" onClick={() => setSideNote(null)} aria-label="Close note">
            <X size={18} />
          </button>
          <NotePanel key={sideNote} path={sideNote} course={course} refreshKey={noteKey} onOpenFile={onOpenFile} onOpenNote={onOpenNote} />
        </div>
      )}
    </div>
  );
}
