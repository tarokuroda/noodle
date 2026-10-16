import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, FileSearch, FileText, Globe, LoaderCircle, X } from "lucide-react";
import { api } from "../api.js";
import Logo from "./Logo.jsx";
import { FileViewer } from "./Library.jsx";

const STEP_MS = 420;
const short = (name) => name.replace(/\.(pdf|pptx?|docx?)$/i, "");

function useTypewriter(text, animate, start) {
  const [n, setN] = useState(animate ? 0 : Infinity);
  useEffect(() => {
    if (!start || n >= text.length) return;
    const t = setTimeout(() => setN((k) => k + 9), 24);
    return () => clearTimeout(t);
  }, [start, n, text]);
  return text.slice(0, n);
}

function Retrieved({ hits, course, revealed, pending, onOpen }) {
  const searching = pending || revealed < hits.length;
  return (
    <div className="retrieved">
      <div className="retrieved-head">
        {searching ? <LoaderCircle size={15} className="spin" /> : <FileSearch size={15} />}
        {searching ? `Searching your ${course} files…` : `Read ${hits.length} page${hits.length === 1 ? "" : "s"} from your ${course} files`}
      </div>
      <div className="retrieved-list">
        {hits.slice(0, revealed).map((h) => (
          <button
            key={`${h.file_id}-${h.page}`}
            className="retrieved-chip"
            onClick={() => onOpen(h.file_id, h.page)}
            title={h.viewer === "pdf" ? `Open ${h.name} at page ${h.page}` : `Open ${h.name}`}
          >
            {h.viewer === "pdf" ? <FileText size={12} /> : <Globe size={12} />}
            {short(h.name)}
            {h.viewer === "pdf" && <b>p.{h.page}</b>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Answer({ msg, fresh, onCite, onAsk, onDone }) {
  const [revealed, setRevealed] = useState(fresh ? 0 : msg.retrieved.length);
  const searching = msg.pending || revealed < msg.retrieved.length;
  useEffect(() => {
    if (!fresh || msg.pending) return;
    let k = 0;
    const t = setInterval(() => {
      k += 1;
      setRevealed(k);
      if (k >= msg.retrieved.length) clearInterval(t);
    }, STEP_MS);
    return () => clearInterval(t);
  }, [fresh, msg]);

  const md = (msg.answer || "").replace(/\[(\d+)\]/g, "[$1](#cite-$1)");
  const typed = useTypewriter(md, fresh, !searching && msg.kind === "answer");
  const done = !searching && typed.length >= md.length;
  useEffect(() => {
    if (fresh && done) onDone?.();
  }, [fresh, done]);
  const cite = (n) => {
    const c = msg.citations.find((x) => x.n === n);
    if (c) onCite(c.file_id, c.page);
  };

  return (
    <div className="answer" aria-busy={searching}>
      <Retrieved hits={msg.retrieved} course={msg.course} revealed={revealed} pending={msg.pending} onOpen={onCite} />
      {!searching && msg.kind === "answer" && (
        <>
          <div className="answer-body">
            <ReactMarkdown
              components={{
                a: ({ href, children }) =>
                  href?.startsWith("#cite-") ? (
                    <button className="cite-num" onClick={() => cite(+href.slice(6))} title={msg.citations.find((x) => x.n === +href.slice(6))?.label}>
                      {children}
                    </button>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer">{children}</a>
                  ),
              }}
            >
              {typed}
            </ReactMarkdown>
          </div>
          {done && (
            <div className="sources">
              <span className="sources-label">Sources</span>
              {msg.citations.map((c) => (
                <button key={c.n} className="source-chip" onClick={() => onCite(c.file_id, c.page)}>
                  <span className="source-n">{c.n}</span> {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {!searching && msg.kind === "not_found" && (
        <div className="answer-body">
          <p className="not-found">I couldn't find this in your {msg.course} files.</p>
          <p className="muted small">These are the closest pages I found, but none of them answers the question:</p>
          <div className="sources">
            {msg.closest.map((h) => (
              <button key={`${h.file_id}-${h.page}`} className="source-chip plain" onClick={() => onCite(h.file_id, h.page)}>
                {short(h.name)} {h.viewer === "pdf" && `— p.${h.page}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {!searching && msg.kind === "unknown" && (
        <div className="answer-body">
          {msg.suggestions?.length ? (
            <>
              <p>I don't have an answer ready for that one in this demo. Try one of these questions about {msg.course}:</p>
              <div className="suggestions">
                {msg.suggestions.map((s) => (
                  <button key={s.q} className="suggestion" onClick={() => onAsk(s.q)}>{s.q}</button>
                ))}
              </div>
            </>
          ) : (
            <p>
              I don't have an answer ready for that one in this demo.
              {msg.retrieved.length > 0 && " The pages above are the closest matches in your files: open one to read it."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Ask({ course, files, thread, setThread }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [side, setSide] = useState(null); // { id, page, nonce }
  const scroller = useRef(null);
  const content = useRef(null);
  const stick = useRef(true); // follow the answer as it types, unless you've scrolled up to read
  const name = course?.shortname.split("_")[0] || "course";

  useEffect(() => {
    api("/ask/suggestions").then(setSuggestions).catch(() => {});
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const el = scroller.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content.current);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy || !course) return;
    const id = Date.now();
    setQ("");
    setBusy(true);
    stick.current = true;
    // show the question straight away; the answer replaces this placeholder when it arrives
    setThread((t) => [...t, { id, q: question, course: name, retrieved: [], pending: true }]);
    let res;
    try {
      res = await api("/ask", { method: "POST", body: { q: question, course: course.id } });
    } catch {
      res = { q: question, kind: "unknown", course: name, retrieved: [], suggestions };
    }
    setThread((t) => t.map((m) => (m.id === id ? { ...res, id } : m)));
    setBusy(false);
  };

  const sideFile = side && files.find((f) => f.id === side.id);
  const ready = suggestions.filter((s) => s.kind === "answer");

  return (
    <div className="ask-wrap">
      <div className="ask">
        <div className="bar">
          <div className="title">
            <h1>Ask {name}</h1>
            <p>Answers come only from your synced files, with the pages they came from.</p>
          </div>
        </div>
        <div className="thread" ref={scroller} onScroll={onScroll}>
          <div ref={content}>
            {thread.length === 0 && (
              <div className="ask-empty">
                <Logo size={56} />
                <h2>What do you want to understand?</h2>
                <p className="muted">Ask about anything in your {name} lectures, worksheets and briefs.</p>
                {ready.length > 0 && (
                  <div className="suggestions">
                    {ready.map((s) => (
                      <button key={s.q} className="suggestion" onClick={() => ask(s.q)}>{s.q}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {thread.map((m, i) => (
              <div key={m.id} className="turn">
                <div className="question">{m.q}</div>
                <Answer
                  msg={m}
                  fresh={i === thread.length - 1 && !m.seen}
                  onCite={(id, page) => setSide({ id, page, nonce: Date.now() })}
                  onAsk={ask}
                  onDone={() => setThread((t) => t.map((x) => (x.id === m.id ? { ...x, seen: true } : x)))}
                />
              </div>
            ))}
          </div>
        </div>
        <form
          className="ask-input"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask a question about ${name}…`} aria-label="Your question" autoFocus />
          <button className="send" disabled={!q.trim() || busy} aria-label="Ask">
            {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={18} />}
          </button>
        </form>
      </div>
      {sideFile && (
        <div className="side-panel">
          <button className="icon-btn side-close" onClick={() => setSide(null)} aria-label="Close">
            <X size={18} />
          </button>
          <FileViewer file={sideFile} open={side} setOpen={setSide} compact />
        </div>
      )}
    </div>
  );
}
