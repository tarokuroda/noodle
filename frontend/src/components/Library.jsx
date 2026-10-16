import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Network, NotebookPen, Presentation, Sparkles, X } from "lucide-react";
import NotePanel from "./NotePanel.jsx";
import PdfViewer from "./PdfViewer.jsx";
import Logo from "./Logo.jsx";
import { api, tagColor } from "../api.js";

export function FileViewer({ file, open, setOpen, highlights, onHighlight, compact = false, actions = null }) {
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

/** The library's main area: a file (with its highlights and note beside it) or a note on its own. */
export function LibraryView({ course, file, open, setOpen, sideNote, setSideNote, mainNote, onOpenFile, onOpenNote, onNotesChanged, onNavigate }) {
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
  if (!file) return <EmptyLibrary course={course} onNavigate={onNavigate} />;
  return (
    <div className="split">
      <FileViewer
        file={file}
        open={open}
        setOpen={setOpen}
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
