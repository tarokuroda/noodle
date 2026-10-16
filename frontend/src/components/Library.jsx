import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import PdfViewer from "./PdfViewer.jsx";
import Logo from "./Logo.jsx";
import { tagColor } from "../api.js";

export function FileViewer({ file, open, setOpen, highlights, onHighlight, compact = false }) {
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
