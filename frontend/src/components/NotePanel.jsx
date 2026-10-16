import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { Check, FileText, NotebookPen, Pencil } from "lucide-react";
import { api } from "../api.js";

const WIKILINK = /\[\[([^[\]|#]+)(?:#([^[\]|]*))?(?:\|([^[\]]*))?\]\]/g;

function toMarkdown(text) {
  return text.replace(WIKILINK, (_, target, anchor, alias) => {
    const label = alias || target.replace(/\.(pdf|html)$/i, "").split("/").pop();
    return `[${label.replace(/[[\]]/g, "")}](wl:${encodeURIComponent(target)}${anchor ? "#" + encodeURIComponent(anchor) : ""})`;
  });
}

const editorTheme = EditorView.theme({
  "&": { fontSize: "15px", background: "transparent" },
  ".cm-content": { fontFamily: "Nunito, sans-serif", padding: "18px 0", caretColor: "#4f5bd5" },
  ".cm-line": { padding: "0 24px", lineHeight: "1.65" },
  "&.cm-focused": { outline: "none" },
  ".cm-tooltip-autocomplete": { borderRadius: "12px", border: "1px solid #e3e6ef", boxShadow: "0 8px 24px rgba(30,34,53,.12)", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "6px 12px !important", fontFamily: "Nunito, sans-serif" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "#eceefc !important", color: "#1e2235 !important" },
  ".cm-completionDetail": { color: "#8b93a7", marginLeft: "8px", fontStyle: "normal" },
});

export default function NotePanel({ path, course, onOpenFile, onOpenNote, refreshKey }) {
  const [note, setNote] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(true);
  const targets = useRef([]);
  const timer = useRef(null);
  const latest = useRef("");

  useEffect(() => {
    api(`/note?path=${encodeURIComponent(path)}`).then((n) => {
      setNote(n);
      latest.current = n.content;
    });
  }, [path, refreshKey]);

  useEffect(() => {
    if (course) api(`/linktargets?course=${course.id}`).then((t) => (targets.current = t));
  }, [course, path]);

  const save = (content) =>
    api("/note", { method: "PUT", body: { path, content } }).then(() => setSaved(true));

  const onChange = (value) => {
    latest.current = value;
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(value), 500);
  };

  const finish = () => {
    clearTimeout(timer.current);
    save(latest.current);
    setNote((n) => ({ ...n, content: latest.current }));
    setEditing(false);
  };

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      editorTheme,
      autocompletion({
        activateOnTyping: true,
        override: [
          (ctx) => {
            const m = ctx.matchBefore(/\[\[[^\]\n]*/);
            if (!m) return null;
            const q = m.text.slice(2).toLowerCase();
            const rank = { pdf: 0, office: 0, note: 1, page: 2 };
            const options = targets.current
              .filter((t) => !q || t.name.toLowerCase().includes(q) || t.link.toLowerCase().includes(q))
              .sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3))
              .slice(0, 40)
              .map((t) => ({
                label: t.name,
                detail: t.type === "note" ? "note" : t.kind === "pdf" ? "PDF" : t.kind === "page" ? "Moodle page" : t.kind === "office" ? "slides" : "file",
                apply: (view, _c, from, to) => {
                  const after = view.state.sliceDoc(to, to + 2);
                  const end = to + (after === "]]" ? 2 : after.startsWith("]") ? 1 : 0);
                  const insert = `${t.link}]]`;
                  view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length } });
                },
              }));
            return { from: m.from + 2, options, filter: false };
          },
        ],
      }),
    ],
    []
  );

  const follow = async (href) => {
    const [target, anchor] = href.slice(3).split("#").map(decodeURIComponent);
    try {
      const hit = await api(`/resolve?course=${course.id}&target=${encodeURIComponent(target)}`);
      const page = +(anchor || "").match(/page=(\d+)/)?.[1] || 1;
      if (hit.type === "file") onOpenFile?.(hit.id, page);
      else onOpenNote?.(hit.path);
    } catch {
      /* unresolved link: nothing to open */
    }
  };

  if (!note) return <div className="note-panel" />;
  return (
    <div className="note-panel">
      <div className="bar">
        <NotebookPen size={18} color="#b7860b" />
        <div className="title">
          <h1>{note.title}</h1>
          <p>{editing ? (saved ? "Saved to your notes folder" : "Saving…") : "Markdown note · opens in Obsidian too"}</p>
        </div>
        {editing ? (
          <button className="btn yellow" onClick={finish}>
            <Check size={15} /> Done
          </button>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>
      <div className="note-body">
        {editing ? (
          <CodeMirror
            value={latest.current}
            onChange={onChange}
            extensions={extensions}
            autoFocus
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
            onCreateEditor={(view) => {
              const end = view.state.doc.length;
              view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
            }}
          />
        ) : (
          <div className="note-read" onDoubleClick={() => setEditing(true)}>
            <ReactMarkdown
              urlTransform={(u) => u}
              components={{
                a: ({ href, children }) =>
                  href?.startsWith("wl:") ? (
                    <button className={`wikilink ${/page%3D|page=/.test(href) ? "page" : ""}`} onClick={() => follow(href)}>
                      {!/page%3D|page=/.test(href) && <FileText size={12} />}
                      {children}
                    </button>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer">{children}</a>
                  ),
              }}
            >
              {toMarkdown(note.content)}
            </ReactMarkdown>
            <button className="note-add" onClick={() => setEditing(true)}>
              Click to write…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
