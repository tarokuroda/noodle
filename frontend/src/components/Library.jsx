import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, NotebookPen, X } from "lucide-react";
import NotePanel from "./NotePanel.jsx";
import PdfViewer from "./PdfViewer.jsx";
import Logo from "./Logo.jsx";
import { api, tagColor } from "../api.js";

export function FileViewer({ file, open, setOpen, highlights, onHighlight, compact = false, actions = null }) {
  const [pos, setPos] = useState({ current: 1, num: 0 });
  const jump = (n) => setOpen({ id: file.id, page: n, nonce: Date.now() });
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <div className="bar">
        <span className="tagdot" style={{ width: 10, height: 10, borderRadius: 99, background: tagColor(file.tag), flex: "none" }} />
        <div className="title">
          <h1 title={file.name}>{file.name}</h1>
          {!compact && <p>{file.section} · {file.tag}</p>}
        </div>
        {file.kind === "pdf" && pos.num > 0 && (
          <div className="pager">
            <button className="icon-btn" onClick={() => jump(Math.max(1, pos.current - 1))} aria-label="Previous page">
              <ChevronLeft size={18} />
            </button>
            <input
              key={pos.current}
              defaultValue={pos.current}
              aria-label="Page number"
              onKeyDown={(e) => e.key === "Enter" && jump(+e.currentTarget.value || 1)}
            />
            <span>of {pos.num}</span>
            <button className="icon-btn" onClick={() => jump(Math.min(pos.num, pos.current + 1))} aria-label="Next page">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        {actions}
        {!compact && file.moodle_url && (
          <a className="btn" href={file.moodle_url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Moodle
          </a>
        )}
      </div>
      <div className="viewer-wrap">
        {file.kind === "pdf" ? (
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
            sandbox="allow-popups allow-popups-to-escape-sandbox"
          />
        )}
      </div>
    </div>
  );
}

export function EmptyLibrary({ course }) {
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
      </div>
    </div>
  );
}

/** The library's main area: a file (with its highlights and note beside it) or a note on its own. */
export function LibraryView({ course, file, open, setOpen, sideNote, setSideNote, mainNote, onOpenFile, onOpenNote, onNotesChanged }) {
  const [highlights, setHighlights] = useState([]);
  const [noteKey, setNoteKey] = useState(0);

  useEffect(() => {
    setHighlights([]);
    if (file?.kind === "pdf") api(`/highlights?file=${file.id}`).then(setHighlights);
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
  if (!file) return <EmptyLibrary course={course} />;
  return (
    <div className="split">
      <FileViewer
        file={file}
        open={open}
        setOpen={setOpen}
        highlights={highlights}
        onHighlight={file.kind === "pdf" ? onHighlight : undefined}
        actions={
          <button className={`btn ${sideNote ? "yellow" : ""}`} onClick={toggleNote}>
            <NotebookPen size={14} /> Notes
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
